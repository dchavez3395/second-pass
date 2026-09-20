#!/usr/bin/env node
/**
 * Second Pass — phase 04, checks a rule cannot make.
 *
 * axe can tell you an image has no alt attribute. It cannot tell you the alt
 * says "chart" when the chart says revenue fell by half. This runs the checks
 * that need judgement — on the content diagnose.mjs captured — and raises
 * candidate findings for a person to confirm or throw out:
 *
 *   alt-text      1.1.1  does the alt say what the image says? (vision model,
 *                        shown the image and its alt and context; plus
 *                        deterministic catches: filenames, "image", too long)
 *   link-purpose  2.4.4  can the link's purpose be worked out from its text,
 *                        or its text plus the sentence/list item around it?
 *                        ("read more", "click here", "view game" x5)
 *   headings      1.3.1  skipped levels, empty headings;
 *                 2.4.6  headings that do not describe their section
 *
 * Nothing here counts. Every raised finding lands in the review page tagged
 * "AI found" and is confirmed or ignored by the reviewer; the log then reports
 * how many issues the model raised beyond axe and how many survived a person.
 * That number is what "automated tools miss X%" means, measured.
 *
 * Usage:
 *   node checks.mjs                     every site, every check
 *   node checks.mjs --site umanitoba.ca
 *   node checks.mjs --check alt-text    one of alt-text | link-purpose | headings
 *   node checks.mjs --model qwen3-vl:8b
 *   node checks.mjs --limit-images 30   per site (default 30)
 *   node checks.mjs --redo              re-run sites already checked
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { loadSiteRecords, loadFindings, ROOT, SHOTS, CROPS, slugId } from './lib/findings.mjs';
import { askJson, ollamaReady } from './lib/ollama.mjs';

function argStr(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);
const MODEL = argStr('model', 'qwen3-vl:8b');
const SITE = argStr('site', '');
const CHECK = argStr('check', '');
const LIMIT_IMAGES = Number(argStr('limit-images', '30'));
const OUT = path.join(ROOT, 'checks.jsonl');
const RUNS = path.join(ROOT, 'checks-runs.jsonl');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
if (!existsSync(CROPS)) mkdirSync(CROPS, { recursive: true });

const CRITERIA = { 'alt-text': '1.1.1', 'link-purpose': '2.4.4', 'heading-order': '1.3.1', 'heading-text': '2.4.6' };
const HELP = {
  'alt-text': 'Image alternative text must convey what the image conveys',
  'link-purpose': 'Link text must make the link\'s purpose clear, alone or with its context',
  'heading-order': 'Headings must follow a logical outline without skipped levels',
  'heading-text': 'Headings must describe the section they introduce',
};

const GENERIC_LINK = /^(read more|learn more|more|click here|here|view more|see more|more info|details|link|view|go|continue|this|view game|view all|find out more|download|apply|register|watch)\.?$/i;
const GENERIC_ALT = /^((white|black|blue|red|green|grey|gray|dark|light|small|large|new|old|main)\s+)?(image|photo|picture|logo|icon|graphic|banner|img|untitled|placeholder|thumbnail|hero|header|background|image description|alt text|alt|description)\.?$/i;
const LABEL_ALT = /\b(file photo|stock photo|stock image|screenshot|placeholder|lorem ipsum|hero ?image|banner ?image|image ?\d+|photo ?\d+|untitled)\b/i;
const FILENAME_ALT = /(\.(jpe?g|png|gif|webp|svg|bmp|tiff?)$)|(^(img|dsc|dcim|image|photo|pic|screenshot|untitled)[-_ ]?\d+)|(^(?=.*\d)(?=.*[_-])[a-z0-9_-]{6,}$)/i;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- image bytes: the real file when we can get it, else the screenshot crop -----

async function fetchImage(src, base) {
  try {
    const url = new URL(src, base).href;
    if (!/^https?:/.test(url)) return null;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4e6 || buf.length < 200) return null;
    return { buf, type };
  } catch {
    return null;
  }
}

const shots = new Map();
function cropFromShot(site, box, pad = 0) {
  const file = path.join(SHOTS, `${site}.full.png`);
  if (!existsSync(file)) return null;
  if (!shots.has(site)) shots.set(site, PNG.sync.read(readFileSync(file)));
  const png = shots.get(site);
  const x0 = clamp(Math.floor(box.x - pad), 0, png.width - 1), y0 = clamp(Math.floor(box.y - pad), 0, png.height - 1);
  const x1 = clamp(Math.ceil(box.x + box.w + pad), x0 + 1, png.width), y1 = clamp(Math.ceil(box.y + box.h + pad), y0 + 1, png.height);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  PNG.bitblt(png, out, x0, y0, out.width, out.height, 0, 0);
  return { buf: PNG.sync.write(out), type: 'image/png' };
}

// ---- the checks -----------------------------------------------------------------

async function checkAltText(rec, site, raise) {
  const imgs = (rec.content.images || [])
    .filter((i) => !i.ariaHidden && i.box.w >= 24 && i.box.h >= 24)
    .filter((i) => i.alt !== null || i.ariaLabel) // missing alt is axe's job (image-alt); this is about quality
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .slice(0, LIMIT_IMAGES);
  let checked = 0, n = 0;
  for (const img of imgs) {
    const alt = img.alt !== null ? img.alt : img.ariaLabel;
    const base = { site, check: 'alt-text', target: img.target, html: img.html, box: img.box, alt, src: img.src, inLink: img.inLink, linkText: img.linkText };
    // Deterministic catches first; no model needed.
    if (alt && FILENAME_ALT.test(alt.trim()) && !/\s/.test(alt.trim())) { raise({ ...base, problem: 'filename', reason: `The alt text "${alt}" looks like a file name, not a description.`, suggestion: '', confidence: 0.95, model: null }); n++; continue; }
    if (alt && GENERIC_ALT.test(alt.trim())) { raise({ ...base, problem: 'generic', reason: `"${alt}" names the kind of thing it is${/^(white|black|blue|red|green|grey|gray|dark|light)/i.test(alt.trim()) ? ' and its colour' : ''}, not what it shows or whose it is.`, suggestion: '', confidence: 0.95, model: null }); n++; continue; }
    if (alt && LABEL_ALT.test(alt)) { raise({ ...base, problem: 'internal-label', reason: `"${alt}" reads like an internal label for the file, not a description a blind user could use.`, suggestion: '', confidence: 0.9, model: null }); n++; continue; }
    if (alt && alt.length > 250) { raise({ ...base, problem: 'too-long', reason: `${alt.length} characters of alt text; screen readers read this in one breath and users cannot skip within it. Long descriptions belong in text or a caption.`, suggestion: '', confidence: 0.8, model: null }); n++; continue; }
    if (alt === '' && img.inLink && !img.linkText) { raise({ ...base, problem: 'link-has-no-name', reason: 'The image is marked decorative (alt="") but it is the only content of a link, so the link has no name.', suggestion: '', confidence: 0.9, model: null }); n++; continue; }
    if (alt === '' && (img.box.w < 120 || img.box.h < 60)) continue; // small decorative image; take it at its word

    const image = (await fetchImage(img.src, rec.url)) || cropFromShot(site, img.box);
    if (!image) continue;
    checked++;
    const ctx = [
      img.inLink ? `The image is inside a link${img.linkText ? ` whose visible text is "${img.linkText}"` : ' with no other text'}${img.linkHref ? ` (href ${img.linkHref.slice(0, 80)})` : ''}.` : '',
      img.caption ? `Caption: "${img.caption}".` : '',
      img.nearText ? `Text near it: "${img.nearText}".` : '',
    ].filter(Boolean).join(' ');
    const prompt = `You are assisting a human accessibility auditor reviewing WCAG 1.1.1 (Non-text Content). The auditor decides; give a careful first opinion.

This image appears on ${rec.url}. Its alternative text is: ${alt === '' ? '(empty — the author marked it decorative)' : JSON.stringify(alt)}. ${ctx}

Look at the image. Decide whether the alt text does its job for someone who cannot see the image. Most alt text on real sites is acceptable; raise an issue only when a blind user would be misled or would miss information that matters:
- Decorative image (adds nothing a blind user needs): empty alt is correct; a short descriptive alt is harmless — "ok".
- Informative image (chart, diagram, text in the image, a product, a map): the alt must convey THAT information, not the picture's appearance. "Chart" fails; "Revenue fell from $4M to $2M, 2023–2025" passes.
- Image that is a link's ONLY content: the alt must name the destination. "Home" on a logo that links home passes.
- Image inside a link that ALSO has visible text: the alt may name the same thing, or be empty — both pass. Do not flag these for "destination missing".
- Text inside the image must appear in the alt, unless the same text is right next to it on the page.
- Photos of people or places on news/marketing pages: a plain description ("Students in a hallway") passes.
- Alt text that is an internal label ("CAL file photo", "hero image 2", "DSC_0413") or only a colour and a type ("White Logo", "blue icon") FAILS — it tells the user nothing about what is shown or whose it is.

Respond with JSON only: {"verdict": "ok"|"issue", "problem": "none"|"appearance-not-meaning"|"missing-text-in-image"|"wrong"|"informative-marked-decorative"|"link-destination-missing"|"redundant"|"other", "reason": "<one sentence, specific to this image>", "suggestion": "<better alt text, or empty if ok>", "confidence": 0.0-1.0}`;
    try {
      const { out, ms, raw } = await askJson({ model: MODEL, content: prompt, images: [image.buf.toString('base64')], maxTokens: 500, prefill: '{"verdict": "' });
      if (has('debug')) console.log('      [alt raw]', raw.slice(0, 200).replace(/\s+/g, ' '));
      if (out && out.verdict === 'issue' && out.problem !== 'none') {
        const crop = `${slugId(`${site}|model|alt-text|${img.target}`)}.png`;
        if (image.type === 'image/png') writeFileSync(path.join(CROPS, crop), image.buf);
        raise({ ...base, problem: String(out.problem || 'other'), reason: String(out.reason || '').slice(0, 400), suggestion: String(out.suggestion || '').slice(0, 300), confidence: Number(out.confidence) || null, model: MODEL, ms, crop: image.type === 'image/png' ? crop : null });
        n++;
      }
    } catch (err) {
      console.log(`      alt-text error: ${String(err).slice(0, 120)}`);
    }
  }
  return { images: imgs.length, checkedByModel: checked, raised: n };
}

async function checkLinks(rec, site, raise) {
  const links = (rec.content.links || []).map((l) => ({ ...l, name: (l.ariaLabel || l.text || l.imgAlt || l.title || '').trim() })).filter((l) => l.name);
  const byName = {};
  for (const l of links) (byName[l.name.toLowerCase()] ||= new Set()).add(l.href);
  let n = 0;
  const bare = (l) => {
    // Nothing a screen reader could use: no enclosing sentence/list item/cell, or one that only repeats the link text.
    const kind = l.contextKind || 'none';
    const ctx = (l.context || '').replace(/^heading:\s*/i, '').trim().toLowerCase();
    if (kind === 'none') return true;
    if (kind === 'heading-only') return true;
    return ctx.replace(l.name.toLowerCase(), '').replace(/[^a-z0-9]+/g, '').length < 3;
  };
  const generic = links.filter((l) => GENERIC_LINK.test(l.name) || l.name.length <= 2);
  for (const l of generic.filter(bare)) {
    raise({ site, check: 'link-purpose', target: l.target, html: l.html, box: l.box, text: l.name, href: l.href, context: l.context, problem: 'generic-no-context', reason: `"${l.name}" says nothing about the destination${l.contextKind === 'heading-only' ? `, and the only nearby context is the heading "${(l.context || '').replace(/^heading:\s*/i, '')}"` : ', and there is no sentence, list item or cell around it to supply the purpose'}.`, suggestion: '', confidence: 0.9, model: null });
    n++;
  }
  const candidates = links.filter((l) => !(GENERIC_LINK.test(l.name) && bare(l)) && (GENERIC_LINK.test(l.name) || l.name.length <= 2 || GENERIC_ALT.test(l.name))).slice(0, 40);
  if (!candidates.length) return { links: links.length, candidates: 0, raised: n };
  const list = candidates.map((l, i) => `${i + 1}. text: ${JSON.stringify(l.name)} | href: ${l.href.slice(0, 80)} | around it: ${JSON.stringify(l.context.slice(0, 120))}`).join('\n');
  const prompt = `You are assisting a human accessibility auditor reviewing WCAG 2.4.4 (Link Purpose, In Context) on ${rec.url}. The auditor decides; give a careful first opinion.

2.4.4 passes if a link's purpose can be worked out from the link text ALONE, or from the link text together with its programmatically determined context — the same sentence, paragraph, list item or table cell, or the heading directly before it. It fails when neither the text nor that immediate context says where the link goes or what it does. Context kinds below: "li"/"p"/"td" etc. = the enclosing unit's text; "block" = the short block it sits in, with the nearest heading; "heading-only" = no sentence, list item or cell surrounds the link, only the nearest heading before it — if that heading is unrelated to the link's destination, the link FAILS. Several links with the same text going to different places are fine only if each one's context makes the destination clear.

Links to check (text | destination | context):
${list}

For each numbered link answer whether it FAILS 2.4.4. Be strict about "click here" and "read more" with no title in the same sentence or list item; be lenient when the context contains the destination's name.
Respond with JSON only, an array with one object per link, in order: [{"n": 1, "fails": true|false, "reason": "<one short sentence>"}, ...]`;
  try {
    const { out, ms, raw } = await askJson({ model: MODEL, content: prompt, maxTokens: 1800 }, 'array');
    if (has('debug')) console.log('      [links raw]', raw.slice(0, 300).replace(/\s+/g, ' '));
    if (Array.isArray(out)) {
      for (const o of out) {
        const l = candidates[Number(o.n) - 1];
        if (!l || !o.fails) continue;
        raise({ site, check: 'link-purpose', target: l.target, html: l.html, box: l.box, text: l.name, href: l.href, context: l.context, problem: GENERIC_LINK.test(l.name) ? 'generic-text' : 'ambiguous', reason: String(o.reason || '').slice(0, 300), suggestion: '', confidence: null, model: MODEL, ms });
        n++;
      }
    }
  } catch (err) {
    console.log(`      link-purpose error: ${String(err).slice(0, 120)}`);
  }
  return { links: links.length, candidates: candidates.length + generic.filter(bare).length, raised: n };
}

async function checkHeadings(rec, site, raise) {
  const hs = (rec.content.headings || []).filter((h) => h.level > 0);
  let n = 0;
  // Deterministic: empty headings and skipped levels (1.3.1 — the outline is the structure).
  let prev = 0;
  for (const h of hs) {
    if (!h.text) { raise({ site, check: 'heading-order', target: h.target, html: h.html, box: h.box, text: '', problem: 'empty', reason: `An empty <h${h.level}> is announced as a heading with nothing in it.`, suggestion: '', confidence: 0.95, model: null }); n++; }
    else if (prev && h.level > prev + 1) { raise({ site, check: 'heading-order', target: h.target, html: h.html, box: h.box, text: h.text, problem: 'skipped-level', reason: `Jumps from h${prev} to h${h.level}; screen-reader users navigating by heading lose the structure.`, suggestion: '', confidence: 0.85, model: null }); n++; }
    if (h.text) prev = h.level;
  }
  // Model: are the headings descriptive of their sections? (2.4.6)
  const visible = hs.filter((h) => h.text && h.visible).slice(0, 60);
  if (visible.length) {
    const outline = visible.map((h, i) => `${i + 1}. ${'  '.repeat(Math.max(0, h.level - 1))}h${h.level}: ${JSON.stringify(h.text.slice(0, 100))}`).join('\n');
    const prompt = `You are assisting a human accessibility auditor reviewing WCAG 2.4.6 (Headings and Labels) on ${rec.url}, page title ${JSON.stringify(rec.content.title || '')}. The auditor decides; give a careful first opinion.

2.4.6 asks only that a heading tells a screen-reader user skimming the outline what the section is about. Be conservative: almost every real heading passes. FAIL only these: a heading that is a placeholder or filler ("Untitled", "Heading", "Section", "Lorem ipsum", "Title goes here"); a heading that is only punctuation, a number or a bare date with nothing else; a heading that is clearly the wrong element (a full sentence of body text or a button label like "Submit" marked as a heading). PASS everything else, including: short clear labels ("News", "Events", "Contact", "Follow us"); questions ("When is my garbage day?"); article titles and slogans ("Our City, Our Stories"); region labels ("Main navigation", "Footer menu", "Breadcrumb"), which are a deliberate screen-reader pattern; and headings that repeat elsewhere on the page — repetition is not a 2.4.6 failure. When in doubt, pass.

Heading outline:
${outline}

Respond with JSON only: an array with one object per heading, in order: [{"n": 1, "fails": true|false, "reason": "<short>"}, ...]`;
    try {
      const { out, ms, raw } = await askJson({ model: MODEL, content: prompt, maxTokens: 1600 }, 'array');
      if (has('debug')) console.log('      [headings raw]', raw.slice(0, 300).replace(/\s+/g, ' '));
      if (Array.isArray(out)) {
        for (const o of out) {
          const h = visible[Number(o.n) - 1];
          if (!h || !o.fails) continue;
          raise({ site, check: 'heading-text', target: h.target, html: h.html, box: h.box, text: h.text, problem: 'not-descriptive', reason: String(o.reason || '').slice(0, 300), suggestion: '', confidence: null, model: MODEL, ms });
          n++;
        }
      }
    } catch (err) {
      console.log(`      headings error: ${String(err).slice(0, 120)}`);
    }
  }
  return { headings: hs.length, raised: n };
}

// ---- main ---------------------------------------------------------------------------

async function main() {
  const err = await ollamaReady(MODEL);
  if (err) { console.error(err); process.exit(1); }
  const recs = loadSiteRecords();
  const full = Object.fromEntries(Object.keys(recs).map((s) => [s, JSON.parse(readFileSync(path.join(ROOT, 'diagnostics', `${s}.json`), 'utf8'))]));
  const done = new Set();
  if (existsSync(RUNS) && !has('redo')) for (const line of readFileSync(RUNS, 'utf8').split('\n')) { try { const r = JSON.parse(line); if (!CHECK || r.check === CHECK) done.add(`${r.site}|${r.check}`); } catch {} }
  if (has('redo')) {
    // Drop what the earlier run raised for these sites and checks, so stale ids do not linger.
    const checkOf = (c) => (c.check === 'heading-order' || c.check === 'heading-text' ? 'headings' : c.check);
    const keepRun = (r) => (SITE && r.site !== SITE) || (CHECK && r.check !== CHECK);
    const keepRow = (c) => (SITE && c.site !== SITE) || (CHECK && checkOf(c) !== CHECK);
    for (const [file, keep] of [[RUNS, keepRun], [OUT, keepRow]]) {
      if (!existsSync(file)) continue;
      const kept = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).filter((l) => { try { return keep(JSON.parse(l)); } catch { return false; } });
      writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '');
    }
  }
  const axeFlagged = new Set(loadFindings().filter((f) => f.kind !== 'model').map((f) => `${f.site}|${f.target}`));

  let sites = Object.keys(full).filter((s) => full[s].content).sort();
  if (SITE) sites = sites.filter((s) => s === SITE);
  console.log(`Checks — ${sites.length} sites, model ${MODEL}, checks ${CHECK || 'alt-text, link-purpose, headings'}\n`);

  for (const site of sites) {
    const rec = full[site];
    let counter = 0;
    const raise = (f) => {
      if (axeFlagged.has(`${site}|${f.target}`) && f.check !== 'alt-text') return; // axe already has this element; let its finding stand
      const id = `${site}|model|${f.check}|${counter++}`;
      if (!f.crop && f.box && f.box.w > 0 && f.box.h > 0) {
        // A crop with a little context so the reviewer sees the element where it sits.
        const c = cropFromShot(site, f.box, 24);
        if (c) { f.crop = `${slugId(id)}.png`; writeFileSync(path.join(CROPS, f.crop), c.buf); }
      }
      appendFileSync(OUT, JSON.stringify({ id, kind: 'model', criterion: CRITERIA[f.check], help: HELP[f.check], at: new Date().toISOString(), ...f }) + '\n');
      const label = f.alt !== undefined ? `alt=${JSON.stringify(f.alt).slice(0, 40)}` : f.text !== undefined ? JSON.stringify(f.text).slice(0, 40) : f.target.slice(0, 40);
      console.log(`      ${f.check.padEnd(13)} ${f.problem.padEnd(22)} ${label}  ${f.model ? '' : '(rule)'}`);
    };
    const checks = [['alt-text', checkAltText], ['link-purpose', checkLinks], ['headings', checkHeadings]].filter(([name]) => !CHECK || CHECK === name);
    for (const [name, fn] of checks) {
      if (done.has(`${site}|${name}`)) continue;
      // Existing lines for this site+check are superseded on --redo by fresh ids; loaders keep latest by id.
      console.log(`  ${site}  ${name}`);
      const summary = await fn(rec, site, raise);
      appendFileSync(RUNS, JSON.stringify({ site, check: name, model: MODEL, at: new Date().toISOString(), ...summary }) + '\n');
      console.log(`      → ${JSON.stringify(summary)}`);
    }
  }
  console.log(`\nAppended to checks.jsonl; per-site counts in checks-runs.jsonl. Review them under "AI found".`);
}

main().catch((e) => { console.error(e); process.exit(1); });
