#!/usr/bin/env node
/**
 * Second Pass — phase 03, the model layer.
 *
 * axe hands over findings it could not resolve. Before a person sees them,
 * two things happen here, and both are recorded so they can be checked:
 *
 *   1. Measurement. For colour-contrast findings, the element is cut out of the
 *      real screenshot and the contrast ratio is computed from pixels: the
 *      dominant colour is the background, the most-contrasting colour with real
 *      coverage is the text. This is what axe could not do when a background
 *      image, pseudo-element or overlap was in the way. No model involved.
 *
 *   2. Proposal. A local vision model (Ollama) is shown the crop with the
 *      element boxed, the markup, axe's reason for stopping, the computed styles
 *      and the measurement, and asked for a verdict and a reason as JSON.
 *
 * Neither result counts. The review page keeps the model's verdict hidden until
 * the person has decided, then reveals it and logs the agreement. The corpus
 * that comes out is human decisions plus a record of where the model was right,
 * wrong, and confidently wrong.
 *
 * Usage:
 *   node propose.mjs                       every undecided-by-model incomplete finding
 *   node propose.mjs --site assiniboine.net
 *   node propose.mjs --rule color-contrast
 *   node propose.mjs --limit 20
 *   node propose.mjs --model gemma3:12b     default qwen3-vl:8b
 *   node propose.mjs --measure-only         skip the model, just crop and measure
 *   node propose.mjs --redo                 re-run findings that already have a proposal
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  loadFindings,
  loadProposals,
  contrastThreshold,
  slugId,
  SHOTS,
  CROPS,
  PROPOSALS,
} from './lib/findings.mjs';

function argStr(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const MODEL = argStr('model', 'qwen3-vl:8b');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const SITE = argStr('site', '');
const RULE = argStr('rule', '');
const LIMIT = Number(argStr('limit', '0'));
const PAD = 28; // px of context around the element in the crop

if (!existsSync(CROPS)) mkdirSync(CROPS, { recursive: true });

// ---- pixels ---------------------------------------------------------------

const shots = new Map();
function loadShot(name) {
  if (!shots.has(name)) shots.set(name, PNG.sync.read(readFileSync(path.join(SHOTS, name))));
  return shots.get(name);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function crop(png, box) {
  const x0 = clamp(Math.floor(box.x - PAD), 0, png.width - 1);
  const y0 = clamp(Math.floor(box.y - PAD), 0, png.height - 1);
  const x1 = clamp(Math.ceil(box.x + box.w + PAD), x0 + 1, png.width);
  const y1 = clamp(Math.ceil(box.y + box.h + PAD), y0 + 1, png.height);
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  PNG.bitblt(png, out, x0, y0, out.width, out.height, 0, 0);
  // Box the element in red so the model knows which thing it is looking at.
  const bx0 = clamp(Math.round(box.x) - x0 - 2, 0, out.width - 1);
  const by0 = clamp(Math.round(box.y) - y0 - 2, 0, out.height - 1);
  const bx1 = clamp(Math.round(box.x + box.w) - x0 + 2, 0, out.width - 1);
  const by1 = clamp(Math.round(box.y + box.h) - y0 + 2, 0, out.height - 1);
  const dot = (x, y) => {
    const i = (y * out.width + x) * 4;
    out.data[i] = 255; out.data[i + 1] = 45; out.data[i + 2] = 85; out.data[i + 3] = 255;
  };
  for (let x = bx0; x <= bx1; x++) { dot(x, by0); dot(x, by1); if (by0 + 1 < out.height) dot(x, by0 + 1); if (by1 - 1 >= 0) dot(x, by1 - 1); }
  for (let y = by0; y <= by1; y++) { dot(bx0, y); dot(bx1, y); if (bx0 + 1 < out.width) dot(bx0 + 1, y); if (bx1 - 1 >= 0) dot(bx1 - 1, y); }
  return { out, offset: { x: x0, y: y0 } };
}

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Contrast from pixels inside the element's own box. Colours are bucketed
 * (8 levels per channel); the biggest bucket is the background; the text is
 * the bucket with at least 0.5% coverage that contrasts most with it.
 */
function measure(png, box) {
  const x0 = clamp(Math.floor(box.x), 0, png.width - 1);
  const y0 = clamp(Math.floor(box.y), 0, png.height - 1);
  const x1 = clamp(Math.ceil(box.x + box.w), x0 + 1, png.width);
  const y1 = clamp(Math.ceil(box.y + box.h), y0 + 1, png.height);
  const buckets = new Map();
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
      total++;
    }
  }
  if (!total) return { ok: false, note: 'element has no pixels on the page' };
  const list = [...buckets.values()]
    .map((e) => ({ n: e.n, rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] }))
    .sort((a, b) => b.n - a.n);
  const bg = list[0];
  const floor = Math.max(12, total * 0.005);
  let fg = null, best = 1;
  for (const c of list.slice(1)) {
    if (c.n < floor) continue;
    const r = contrast(c.rgb, bg.rgb);
    if (r > best) { best = r; fg = c; }
  }
  const area = (x1 - x0) * (y1 - y0);
  const res = {
    ok: true,
    ratio: fg ? Number(best.toFixed(2)) : 1,
    bg: bg.rgb,
    fg: fg ? fg.rgb : null,
    bgShare: Number((bg.n / total).toFixed(3)),
    fgShare: fg ? Number((fg.n / total).toFixed(3)) : 0,
    sampled: total,
  };
  if (!fg) res.note = 'no distinct foreground colour found — element may be empty, hidden, or an image';
  else if (area > 300 * 200) res.note = 'large region — the dominant colours may not be the text and its background';
  else if (fg.n < total * 0.02) res.note = 'foreground coverage is thin — treat the ratio as approximate';
  return res;
}

// ---- model ----------------------------------------------------------------

function prompt(f, meas, threshold) {
  const b = f.box || {};
  const lines = [
    `You are assisting a human accessibility auditor. The auditor will make the final call; your job is a careful first opinion they can check.`,
    ``,
    `An automated checker (axe-core) raised this and could not resolve it on its own.`,
    `Rule: ${f.rule} — ${f.help}`,
    `WCAG: ${f.wcag.join(', ') || 'n/a'}`,
    `Why axe stopped: ${f.messages.join(' | ') || 'no reason given'}`,
    `Element HTML: ${f.html}`,
    `Visible text: ${JSON.stringify(b.text || '')}`,
    `Computed style: font-size ${b.fontSize ?? '?'}px, weight ${b.fontWeight ?? '?'}, color ${b.color ?? '?'}, background-color ${b.background ?? '?'} (transparent means the real background comes from something behind it)`,
  ];
  if (f.rule === 'color-contrast' || f.rule === 'link-in-text-block') {
    lines.push(`Required contrast for this text size: ${threshold}:1.`);
    if (meas && meas.ok && meas.fg) {
      lines.push(`Measured from the screenshot pixels inside the element: ${meas.ratio}:1 between rgb(${meas.fg}) and rgb(${meas.bg}).${meas.note ? ' Caveat: ' + meas.note + '.' : ''}`);
    } else if (meas) {
      lines.push(`Pixel measurement was not possible: ${meas.note}.`);
    }
  }
  lines.push(
    ``,
    `The image is a crop of the real page with the element outlined in red. Look at it.`,
    `Decide whether this is a real accessibility failure against the WCAG criterion:`,
    `- "fail": the element as rendered fails the criterion`,
    `- "pass": it meets the criterion; the checker's uncertainty was a false alarm`,
    `- "cannot_tell": a person must look at the live page (state changes, hidden content, image text, or the crop does not show enough)`,
    `Respond with JSON only, nothing before or after it: {"verdict": "pass"|"fail"|"cannot_tell", "confidence": 0.0-1.0, "reason": "<one sentence, under 40 words, specific to what you see>"}`
  );
  return lines.join('\n');
}

function parseVerdict(raw) {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const o = JSON.parse(m ? m[0] : text);
    if (['pass', 'fail', 'cannot_tell'].includes(o.verdict)) return o;
  } catch {}
  // Truncated or wrapped JSON: salvage the fields by regex rather than lose the call.
  const v = raw.match(/"verdict"\s*:\s*"(pass|fail|cannot_tell)"/);
  if (!v) return null;
  const c = raw.match(/"confidence"\s*:\s*([0-9.]+)/);
  const r = raw.match(/"reason"\s*:\s*"([^"]*)/);
  return { verdict: v[1], confidence: c ? Number(c[1]) : null, reason: r ? r[1] + (raw.includes(r[1] + '"') ? '' : ' […]') : '' };
}

async function callModel(content, image) {
  const body = {
    model: MODEL,
    stream: false,
    // No JSON mode: with qwen3-vl in Ollama it spends the budget thinking and returns nothing.
    // think:false plus a JSON-only instruction is fast; the object is pulled out of the text.
    think: false,
    options: { temperature: 0, num_predict: 700 },
    messages: [{ role: 'user', content, images: [image] }],
  };
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return { raw: (j.message.content || '').trim() || (j.message.thinking || '').trim(), ms: Math.round((j.total_duration || 0) / 1e6) };
}

async function ask(f, cropPng, meas, threshold) {
  const image = cropPng.toString('base64');
  let { raw, ms } = await callModel(prompt(f, meas, threshold), image);
  let out = parseVerdict(raw);
  if (!out) {
    // One retry with the instruction sharpened; the model occasionally narrates instead of answering.
    const nudge = '\n\nOutput the JSON object and nothing else. Do not think out loud. Keep "reason" under 40 words.';
    const again = await callModel(prompt(f, meas, threshold) + nudge, image);
    ms += again.ms;
    raw = again.raw;
    out = parseVerdict(raw);
  }
  if (!out) out = { verdict: 'cannot_tell', confidence: 0, reason: `model returned no usable answer: ${raw.slice(0, 120)}` };
  return {
    verdict: out.verdict,
    confidence: Number.isFinite(Number(out.confidence)) ? clamp(Number(out.confidence), 0, 1) : null,
    reason: String(out.reason || '').slice(0, 400),
    ms,
  };
}

// ---- main -----------------------------------------------------------------

async function main() {
  const done = loadProposals();
  let queue = loadFindings().filter((f) => f.kind === 'incomplete');
  if (SITE) queue = queue.filter((f) => f.site === SITE);
  if (RULE) queue = queue.filter((f) => f.rule === RULE);
  if (!has('redo')) queue = queue.filter((f) => !done[f.id]);
  if (LIMIT) queue = queue.slice(0, LIMIT);

  if (!has('measure-only')) {
    const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => null);
    if (!tags) {
      console.error(`Ollama is not answering at ${OLLAMA}. Start it, or use --measure-only.`);
      process.exit(1);
    }
    if (!tags.models.some((m) => m.name === MODEL || m.name === `${MODEL}:latest`)) {
      console.error(`Model ${MODEL} is not installed. Run: ollama pull ${MODEL}`);
      process.exit(1);
    }
  }

  console.log(`Proposals — ${queue.length} findings, model ${has('measure-only') ? '(none, measure only)' : MODEL}\n`);
  let n = 0;
  const tally = { pass: 0, fail: 0, cannot_tell: 0 };
  for (const f of queue) {
    n++;
    const rec = { id: f.id, site: f.site, rule: f.rule, model: has('measure-only') ? null : MODEL, at: new Date().toISOString() };
    try {
      if (!f.shot || !f.box || (f.box.w === 0 && f.box.h === 0)) {
        rec.skipped = 'no screenshot box for this element';
      } else {
        const png = loadShot(f.shot);
        const { out } = crop(png, f.box);
        const cropBuf = PNG.sync.write(out);
        writeFileSync(path.join(CROPS, `${slugId(f.id)}.png`), cropBuf);
        const threshold = contrastThreshold(f.box);
        if (f.rule === 'color-contrast' || f.rule === 'link-in-text-block') {
          rec.measured = { ...measure(png, f.box), threshold };
        }
        if (!has('measure-only')) {
          const a = await ask(f, cropBuf, rec.measured, threshold);
          Object.assign(rec, a);
          tally[a.verdict]++;
        }
      }
    } catch (err) {
      rec.error = String(err).slice(0, 200);
    }
    appendFileSync(PROPOSALS, JSON.stringify(rec) + '\n');
    const m = rec.measured && rec.measured.ok && rec.measured.fg ? `${String(rec.measured.ratio).padStart(5)}:1 vs ${rec.measured.threshold}` : '         ';
    const v = rec.skipped ? 'skip' : rec.error ? 'ERR ' : (rec.verdict || 'meas').padEnd(11);
    console.log(`  ${String(n).padStart(4)}/${queue.length}  ${v}  ${m}  ${f.site}  ${f.rule}  ${(f.box && f.box.text ? f.box.text : f.target).slice(0, 50)}`);
    if (rec.error) console.log(`${' '.repeat(12)}${rec.error}`);
  }
  if (!has('measure-only')) console.log(`\npass ${tally.pass}  fail ${tally.fail}  cannot_tell ${tally.cannot_tell}`);
  console.log(`Appended to proposals.jsonl; crops in diagnostics/crops/. The review page reveals these only after a decision.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
