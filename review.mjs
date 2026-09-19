#!/usr/bin/env node
/**
 * Second Pass — phase 02, the review layer.
 *
 * diagnose.mjs leaves behind the findings axe could not resolve on its own.
 * This serves them one at a time to a person, with the evidence assembled:
 * the element and its markup, axe's own reason for hesitating, the WCAG
 * criterion, the screenshot with the element boxed, and — where propose.mjs
 * has run — the contrast measured from pixels. The person decides.
 *
 * The model's proposal is withheld until the decision is saved, then revealed
 * and compared. Blind first, so the corpus is the person's judgment and not
 * the person agreeing with a machine.
 *
 * Every decision is appended to decisions.jsonl as it is made, and
 * review-log.md is regenerated from that file.
 *
 * Usage:
 *   node review.mjs               http://localhost:8901
 *   node review.mjs --port 9000
 *
 * No dependencies beyond node itself.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  SHOTS,
  CROPS,
  DECISIONS,
  loadFindings,
  loadDecisions,
  loadProposals,
} from './lib/findings.mjs';

const LOG = path.join(ROOT, 'review-log.md');

function argStr(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const PORT = Number(argStr('port', '8901'));

const VERDICTS = { confirm: 'Confirmed', reject: 'Rejected', look: 'Needs a closer look' };
// Model verdicts map onto the human's: fail ~ confirm, pass ~ reject, cannot_tell ~ look.
const MODEL_TO_HUMAN = { fail: 'confirm', pass: 'reject', cannot_tell: 'look' };

/** Strip the model's verdict; keep the measurement, which is evidence rather than judgment. */
function evidenceOnly(p) {
  if (!p) return null;
  const { verdict, confidence, reason, ...rest } = p;
  return rest;
}

// ---- log ------------------------------------------------------------------

function writeLog(findings, decisions, proposals) {
  const decided = findings.filter((f) => decisions[f.id]);
  const count = (arr, v) => arr.filter((f) => decisions[f.id].verdict === v).length;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

  let md = `# Second Pass — review log\n\n`;
  md += `Regenerated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`decisions.jsonl\`. `;
  md += `Every line below is a human decision on a finding an automated tool raised. `;
  md += `Where the tool flagged something it could not resolve ("incomplete"), the person resolved it. `;
  md += `Where the tool reported a failure, the person confirmed or rejected it. `;
  md += `The model's proposal was hidden until each decision was saved.\n\n`;

  md += `## Totals\n\n`;
  md += `| | Findings | Reviewed | Confirmed | Rejected | Closer look |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const kind of ['incomplete', 'violation']) {
    const all = findings.filter((f) => f.kind === kind);
    const dec = decided.filter((f) => f.kind === kind);
    md += `| ${kind === 'incomplete' ? 'axe could not decide' : 'axe reported a failure'} | ${all.length} | ${dec.length} | ${count(dec, 'confirm')} | ${count(dec, 'reject')} | ${count(dec, 'look')} |\n`;
  }

  md += `\n## By rule\n\n`;
  md += `The rejection rate per rule is the number that matters: it is how often the tool's flag did not survive a person looking at it.\n\n`;
  md += `| Rule | WCAG | Reviewed | Confirmed | Rejected | Closer look | Rejection rate |\n|---|---|---:|---:|---:|---:|---:|\n`;
  const byRule = {};
  for (const f of decided) (byRule[f.rule] ||= []).push(f);
  for (const rule of Object.keys(byRule).sort()) {
    const arr = byRule[rule];
    const rej = count(arr, 'reject');
    md += `| \`${rule}\` | ${[...new Set(arr.flatMap((f) => f.wcag))].join(', ')} | ${arr.length} | ${count(arr, 'confirm')} | ${rej} | ${count(arr, 'look')} | ${pct(rej, rej + count(arr, 'confirm'))} |\n`;
  }

  // Model vs human — only over findings that have both.
  const both = decided.filter((f) => proposals[f.id] && proposals[f.id].verdict);
  md += `\n## Model vs. person\n\n`;
  if (!both.length) {
    md += `_No findings have both a model proposal and a human decision yet. Run \`node propose.mjs\` first._\n`;
  } else {
    const agree = both.filter((f) => MODEL_TO_HUMAN[proposals[f.id].verdict] === decisions[f.id].verdict);
    const settled = both.filter((f) => decisions[f.id].verdict !== 'look');
    const fp = settled.filter((f) => proposals[f.id].verdict === 'fail' && decisions[f.id].verdict === 'reject');
    const fn = settled.filter((f) => proposals[f.id].verdict === 'pass' && decisions[f.id].verdict === 'confirm');
    const confidentWrong = both.filter(
      (f) => (proposals[f.id].confidence ?? 0) >= 0.8 && MODEL_TO_HUMAN[proposals[f.id].verdict] !== decisions[f.id].verdict && decisions[f.id].verdict !== 'look'
    );
    const models = [...new Set(both.map((f) => proposals[f.id].model))].join(', ');
    md += `Model: \`${models}\`, local via Ollama, shown the element crop, markup, axe's reason, computed styles and the pixel measurement. `;
    md += `The person decided first, blind.\n\n`;
    md += `| | Count |\n|---|---:|\n`;
    md += `| Findings with both a proposal and a decision | ${both.length} |\n`;
    md += `| Model agreed with the person | ${agree.length} (${pct(agree.length, both.length)}) |\n`;
    md += `| Model said fail, person rejected (false alarm) | ${fp.length} (${pct(fp.length, settled.length)} of settled) |\n`;
    md += `| Model said pass, person confirmed (missed failure) | ${fn.length} (${pct(fn.length, settled.length)} of settled) |\n`;
    md += `| Wrong at 0.8+ confidence | ${confidentWrong.length} |\n\n`;

    md += `| Rule | Both | Agreed | False alarms | Missed |\n|---|---:|---:|---:|---:|\n`;
    const rules = [...new Set(both.map((f) => f.rule))].sort();
    for (const rule of rules) {
      const arr = both.filter((f) => f.rule === rule);
      md += `| \`${rule}\` | ${arr.length} | ${arr.filter((f) => agree.includes(f)).length} | ${arr.filter((f) => fp.includes(f)).length} | ${arr.filter((f) => fn.includes(f)).length} |\n`;
    }

    const dis = both.filter((f) => !agree.includes(f));
    if (dis.length) {
      md += `\n### Where they disagreed\n\n| Site | Rule | Element | Model said | Person said |\n|---|---|---|---|---|\n`;
      for (const f of dis) {
        const p = proposals[f.id], d = decisions[f.id];
        md += `| ${f.site} | \`${f.rule}\` | \`${cell(f.target).slice(0, 60)}\` | **${p.verdict}** (${p.confidence ?? '?'}) — ${cell(p.reason).slice(0, 140)} | **${VERDICTS[d.verdict]}** — ${cell(d.reason).slice(0, 140)} |\n`;
      }
    }
  }

  md += `\n## Decisions\n\n`;
  const bySite = {};
  for (const f of decided) (bySite[f.site] ||= []).push(f);
  for (const site of Object.keys(bySite).sort()) {
    md += `### ${site}\n\n`;
    md += `| Rule | WCAG | Element | axe said | Measured | Verdict | Reason |\n|---|---|---|---|---|---|---|\n`;
    for (const f of bySite[site]) {
      const d = decisions[f.id];
      const m = proposals[f.id] && proposals[f.id].measured;
      const meas = m && m.ok && m.fg ? `${m.ratio}:1 / ${m.threshold}` : '';
      md += `| \`${f.rule}\` | ${f.wcag.join(', ')} | \`${cell(f.target).slice(0, 80)}\` | ${cell(f.messages[0]).slice(0, 120)} | ${meas} | **${VERDICTS[d.verdict] || d.verdict}** | ${cell(d.reason)} |\n`;
    }
    md += `\n`;
  }
  if (!decided.length) md += `_No decisions yet._\n`;
  writeFileSync(LOG, md);
}

// ---- server ---------------------------------------------------------------

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function servePng(res, dir, name) {
  const file = path.join(dir, path.basename(name));
  if (!existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': MIME['.png'], 'Content-Length': statSync(file).size });
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && u.pathname === '/') {
    return send(res, 200, readFileSync(path.join(ROOT, 'review.html')), MIME['.html']);
  }

  if (req.method === 'GET' && u.pathname === '/api/queue') {
    const findings = loadFindings();
    const decisions = loadDecisions();
    const all = loadProposals();
    // Undecided findings get the measurement only; the verdict is revealed after deciding.
    const proposals = {};
    for (const id of Object.keys(all)) proposals[id] = decisions[id] ? all[id] : evidenceOnly(all[id]);
    return send(res, 200, JSON.stringify({ findings, decisions, proposals }));
  }

  if (req.method === 'POST' && u.pathname === '/api/decision') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let d;
      try {
        d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, '{"error":"bad json"}');
      }
      if (!d.id || !['confirm', 'reject', 'look', 'reopen'].includes(d.verdict)) {
        return send(res, 400, '{"error":"id and verdict required"}');
      }
      if (d.verdict === 'reject' && !(d.reason || '').trim()) {
        return send(res, 400, '{"error":"a rejection needs a reason"}');
      }
      const rec = {
        id: d.id,
        site: d.site,
        rule: d.rule,
        target: d.target,
        verdict: d.verdict,
        reason: (d.reason || '').trim(),
        at: new Date().toISOString(),
      };
      appendFileSync(DECISIONS, JSON.stringify(rec) + '\n');
      const proposals = loadProposals();
      writeLog(loadFindings(), loadDecisions(), proposals);
      // Now that the decision is on disk, the model's view can be shown.
      return send(res, 200, JSON.stringify({ decision: rec, proposal: d.verdict === 'reopen' ? null : proposals[d.id] || null }));
    });
    return;
  }

  if (req.method === 'GET' && u.pathname.startsWith('/screens/')) return servePng(res, SHOTS, u.pathname);
  if (req.method === 'GET' && u.pathname.startsWith('/crops/')) return servePng(res, CROPS, u.pathname);

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, '127.0.0.1', () => {
  const n = loadFindings();
  const d = Object.keys(loadDecisions()).length;
  const p = Object.values(loadProposals()).filter((x) => x.verdict).length;
  console.log(`Second Pass review — http://localhost:${PORT}`);
  console.log(`${n.length} findings across ${new Set(n.map((f) => f.site)).size} sites, ${d} decided, ${p} with a model proposal.`);
  console.log(`Decisions append to decisions.jsonl; review-log.md is regenerated on every one.`);
});
