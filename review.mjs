#!/usr/bin/env node
/**
 * Second Pass — phase 02, the review layer.
 *
 * diagnose.mjs leaves behind the findings axe could not resolve on its own.
 * This serves them one at a time to a person, with the evidence assembled:
 * the element and its markup, axe's own reason for hesitating, the WCAG
 * criterion, and the screenshot with the element boxed. The person decides.
 *
 * Every decision is appended to decisions.jsonl as it is made, and
 * review-log.md is regenerated from that file. Nothing here decides anything;
 * the log is only worth something because a human wrote every line of it.
 *
 * Usage:
 *   node review.mjs               http://localhost:8901
 *   node review.mjs --port 9000
 *
 * No dependencies beyond node itself.
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIAG = path.join(ROOT, 'diagnostics');
const SHOTS = path.join(DIAG, 'screens');
const DECISIONS = path.join(ROOT, 'decisions.jsonl');
const LOG = path.join(ROOT, 'review-log.md');

function argStr(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const PORT = Number(argStr('port', '8901'));

// ---- data -----------------------------------------------------------------

function loadFindings() {
  if (!existsSync(DIAG)) return [];
  const out = [];
  for (const f of readdirSync(DIAG).filter((n) => n.endsWith('.json')).sort()) {
    let rec;
    try {
      rec = JSON.parse(readFileSync(path.join(DIAG, f), 'utf8'));
    } catch {
      continue;
    }
    if (!rec.ok) continue;
    const site = new URL(rec.url).hostname.replace(/^www\./, '');
    const shot = existsSync(path.join(SHOTS, `${site}.full.png`))
      ? `${site}.full.png`
      : existsSync(path.join(SHOTS, `${site}.png`))
        ? `${site}.png`
        : null;
    const push = (kind, rule) => {
      const items = rule.items || rule.sample || [];
      items.forEach((n, i) => {
        out.push({
          id: `${site}|${kind}|${rule.id}|${i}`,
          site,
          url: rec.url,
          title: rec.title || '',
          kind, // 'incomplete' = axe could not decide; 'violation' = axe says fail
          rule: rule.id,
          help: rule.help,
          description: rule.description || '',
          helpUrl: rule.helpUrl || '',
          wcag: rule.wcag || [],
          tags: rule.tags || [],
          impact: n.impact || rule.impact || '',
          target: n.target,
          html: n.html,
          messages: n.messages || (i === 0 && rule.why ? [rule.why] : []),
          box: n.box || null,
          shot,
          viewport: rec.viewport || null,
          nodeIndex: i,
          nodeCount: items.length,
        });
      });
    };
    for (const r of rec.incomplete || []) push('incomplete', r);
    for (const r of rec.violations || []) push('violation', r);
  }
  return out;
}

function loadDecisions() {
  if (!existsSync(DECISIONS)) return {};
  const latest = {};
  for (const line of readFileSync(DECISIONS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.verdict === 'reopen') delete latest[d.id];
      else latest[d.id] = d;
    } catch {}
  }
  return latest;
}

const VERDICTS = { confirm: 'Confirmed', reject: 'Rejected', look: 'Needs a closer look' };

function writeLog(findings, decisions) {
  const decided = findings.filter((f) => decisions[f.id]);
  const count = (arr, v) => arr.filter((f) => decisions[f.id].verdict === v).length;

  let md = `# Second Pass — review log\n\n`;
  md += `Regenerated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`decisions.jsonl\`. `;
  md += `Every line below is a human decision on a finding an automated tool raised. `;
  md += `Where the tool flagged something it could not resolve ("incomplete"), the person resolved it. `;
  md += `Where the tool reported a failure, the person confirmed or rejected it.\n\n`;

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
    const settled = rej + count(arr, 'confirm');
    md += `| \`${rule}\` | ${[...new Set(arr.flatMap((f) => f.wcag))].join(', ')} | ${arr.length} | ${count(arr, 'confirm')} | ${rej} | ${count(arr, 'look')} | ${settled ? Math.round((100 * rej) / settled) + '%' : '—'} |\n`;
  }

  md += `\n## Decisions\n\n`;
  const bySite = {};
  for (const f of decided) (bySite[f.site] ||= []).push(f);
  for (const site of Object.keys(bySite).sort()) {
    md += `### ${site}\n\n`;
    md += `| Rule | WCAG | Element | axe said | Verdict | Reason |\n|---|---|---|---|---|---|\n`;
    for (const f of bySite[site]) {
      const d = decisions[f.id];
      const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| \`${f.rule}\` | ${f.wcag.join(', ')} | \`${cell(f.target).slice(0, 80)}\` | ${cell(f.messages[0]).slice(0, 120)} | **${VERDICTS[d.verdict] || d.verdict}** | ${cell(d.reason)} |\n`;
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

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && u.pathname === '/') {
    return send(res, 200, readFileSync(path.join(ROOT, 'review.html')), MIME['.html']);
  }

  if (req.method === 'GET' && u.pathname === '/api/queue') {
    const findings = loadFindings();
    const decisions = loadDecisions();
    return send(res, 200, JSON.stringify({ findings, decisions }));
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
      writeLog(loadFindings(), loadDecisions());
      return send(res, 200, JSON.stringify(rec));
    });
    return;
  }

  if (req.method === 'GET' && u.pathname.startsWith('/screens/')) {
    const file = path.join(SHOTS, path.basename(u.pathname));
    if (!existsSync(file)) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME['.png'], 'Content-Length': statSync(file).size });
    return res.end(readFileSync(file));
  }

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, '127.0.0.1', () => {
  const n = loadFindings();
  const d = Object.keys(loadDecisions()).length;
  console.log(`Second Pass review — http://localhost:${PORT}`);
  console.log(`${n.length} findings across ${new Set(n.map((f) => f.site)).size} sites, ${d} decided.`);
  console.log(`Decisions append to decisions.jsonl; review-log.md is regenerated on every one.`);
});
