#!/usr/bin/env node
/**
 * Second Pass — phase 02, the review layer.
 *
 * A page per site laid out the way an auditor's worksheet is: WCAG 2.2 criteria
 * down the side, a status and notes for each, and under each criterion the
 * evidence the pipeline gathered for it — axe's failures, the findings axe could
 * not resolve, the pixel measurements — grouped by cause so one decision covers
 * one cause. The screenshot is the workspace: every finding is a box on it, and
 * an eyedropper measures any two points the way the worksheet says to.
 *
 * The model's proposals stay hidden for a group until the person has decided
 * that group. Blind first, so the corpus is the person's judgment.
 *
 * Records, all append-only JSONL with latest-wins:
 *   decisions.jsonl  one line per finding (group decisions write one per member)
 *   criteria.jsonl   status + notes per site and criterion
 *   tasks.jsonl      logged issues, the worksheet's Task List
 *
 * Usage:
 *   node review.mjs               http://localhost:8901
 *   node review.mjs --port 9000
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, appendFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  ROOT,
  SHOTS,
  CROPS,
  DECISIONS,
  CRITERIA_FILE,
  TASKS_FILE,
  WCAG,
  allCriteria,
  loadFindings,
  loadDecisions,
  loadProposals,
  loadCriteria,
  loadTasks,
  groupFindings,
  loadSiteRecords,
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

function writeLog() {
  const findings = loadFindings();
  const decisions = loadDecisions();
  const proposals = loadProposals();
  const criteria = loadCriteria();
  const tasks = loadTasks();
  const decided = findings.filter((f) => decisions[f.id]);
  const count = (arr, v) => arr.filter((f) => decisions[f.id].verdict === v).length;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const critName = (id) => { const c = allCriteria().find((x) => x.id === id); return c ? `${c.id} ${c.name}` : id; };

  let md = `# Second Pass — review log\n\n`;
  md += `Regenerated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`decisions.jsonl\`, \`criteria.jsonl\` and \`tasks.jsonl\`. `;
  md += `Every line is a human decision. Findings axe could not resolve were resolved by the person; failures axe reported were confirmed or rejected; `;
  md += `each WCAG criterion was given a status the way an audit worksheet does. The model's proposals were hidden until each decision was saved.\n\n`;

  md += `## Totals\n\n`;
  md += `| | Findings | Reviewed | Confirmed | Rejected | Closer look |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const kind of ['incomplete', 'violation']) {
    const all = findings.filter((f) => f.kind === kind);
    const dec = decided.filter((f) => f.kind === kind);
    md += `| ${kind === 'incomplete' ? 'axe could not decide' : 'axe reported a failure'} | ${all.length} | ${dec.length} | ${count(dec, 'confirm')} | ${count(dec, 'reject')} | ${count(dec, 'look')} |\n`;
  }

  md += `\n## By rule\n\n`;
  md += `The rejection rate per rule is how often the tool's flag did not survive a person looking at it.\n\n`;
  md += `| Rule | WCAG | Reviewed | Confirmed | Rejected | Closer look | Rejection rate |\n|---|---|---:|---:|---:|---:|---:|\n`;
  const byRule = {};
  for (const f of decided) (byRule[f.rule] ||= []).push(f);
  for (const rule of Object.keys(byRule).sort()) {
    const arr = byRule[rule];
    const rej = count(arr, 'reject');
    md += `| \`${rule}\` | ${[...new Set(arr.flatMap((f) => f.wcag))].join(', ')} | ${arr.length} | ${count(arr, 'confirm')} | ${rej} | ${count(arr, 'look')} | ${pct(rej, rej + count(arr, 'confirm'))} |\n`;
  }

  const both = decided.filter((f) => proposals[f.id] && proposals[f.id].verdict);
  md += `\n## Model vs. person\n\n`;
  if (!both.length) {
    md += `_No findings have both a model proposal and a human decision yet._\n`;
  } else {
    const agree = both.filter((f) => MODEL_TO_HUMAN[proposals[f.id].verdict] === decisions[f.id].verdict);
    const settled = both.filter((f) => decisions[f.id].verdict !== 'look');
    const fp = settled.filter((f) => proposals[f.id].verdict === 'fail' && decisions[f.id].verdict === 'reject');
    const fn = settled.filter((f) => proposals[f.id].verdict === 'pass' && decisions[f.id].verdict === 'confirm');
    const confidentWrong = both.filter(
      (f) => (proposals[f.id].confidence ?? 0) >= 0.8 && MODEL_TO_HUMAN[proposals[f.id].verdict] !== decisions[f.id].verdict && decisions[f.id].verdict !== 'look'
    );
    const models = [...new Set(both.map((f) => proposals[f.id].model))].join(', ');
    md += `Model: \`${models}\`, local via Ollama, shown the element crop, markup, axe's reason, computed styles and the pixel measurement. The person decided first, blind.\n\n`;
    md += `| | Count |\n|---|---:|\n`;
    md += `| Findings with both a proposal and a decision | ${both.length} |\n`;
    md += `| Model agreed with the person | ${agree.length} (${pct(agree.length, both.length)}) |\n`;
    md += `| Model said fail, person rejected (false alarm) | ${fp.length} (${pct(fp.length, settled.length)} of settled) |\n`;
    md += `| Model said pass, person confirmed (missed failure) | ${fn.length} (${pct(fn.length, settled.length)} of settled) |\n`;
    md += `| Wrong at 0.8+ confidence | ${confidentWrong.length} |\n\n`;
    md += `| Rule | Both | Agreed | False alarms | Missed |\n|---|---:|---:|---:|---:|\n`;
    for (const rule of [...new Set(both.map((f) => f.rule))].sort()) {
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

  // Per-site worksheet: criterion statuses and logged issues.
  const sites = [...new Set([...Object.values(criteria).map((c) => c.site), ...Object.values(tasks).map((t) => t.site)])].sort();
  md += `\n## Worksheet\n\n`;
  if (!sites.length) md += `_No criterion statuses or issues recorded yet._\n`;
  for (const site of sites) {
    md += `### ${site}\n\n`;
    const cs = Object.values(criteria).filter((c) => c.site === site && c.status && c.status !== 'Not Evaluated');
    if (cs.length) {
      md += `| Criterion | Level | Status | Notes |\n|---|---|---|---|\n`;
      for (const c of cs.sort((a, b) => a.criterion.localeCompare(b.criterion, undefined, { numeric: true }))) {
        const def = allCriteria().find((x) => x.id === c.criterion) || {};
        md += `| ${critName(c.criterion)} | ${def.level || ''} | **${c.status}** | ${cell(c.notes)} |\n`;
      }
      md += `\n`;
    }
    const ts = Object.values(tasks).filter((t) => t.site === site);
    if (ts.length) {
      md += `**Issues logged**\n\n| Severity | Issue | Criterion | Status | Notes | Reference |\n|---|---|---|---|---|---|\n`;
      for (const t of ts.sort((a, b) => (b.severity || 0) - (a.severity || 0))) {
        md += `| ${t.severity} ${WCAG.severities[String(t.severity)] || ''} | ${cell(t.shortname)} | ${critName(t.criterion)} | ${t.status} | ${cell(t.notes)} | \`${cell(t.reference).slice(0, 80)}\` |\n`;
      }
      md += `\n`;
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

// ---- site payload ---------------------------------------------------------

function sitePayload(site) {
  const findings = loadFindings().filter((f) => f.site === site);
  if (!findings.length) return null;
  const decisions = loadDecisions();
  const all = loadProposals();
  const groups = groupFindings(findings, all);
  // A group's model verdicts are revealed once every member has a decision.
  const proposals = {};
  for (const g of groups) {
    const decided = g.ids.every((id) => decisions[id]);
    for (const id of g.ids) if (all[id]) proposals[id] = decided ? all[id] : evidenceOnly(all[id]);
  }
  const f0 = findings[0];
  const rec = loadSiteRecords()[site] || {};
  const criteria = {};
  for (const [k, v] of Object.entries(loadCriteria())) if (v.site === site) criteria[v.criterion] = v;
  const tasks = Object.values(loadTasks()).filter((t) => t.site === site);
  return {
    site,
    url: f0.url,
    title: f0.title,
    shot: f0.shot,
    viewport: f0.viewport,
    axe: rec.axe || null,
    verdict: rec.verdict || '',
    scannedAt: rec.scannedAt || '',
    wcag: { criteria: allCriteria(), statuses: WCAG.statuses, severities: WCAG.severities, taskStatuses: WCAG.taskStatuses },
    findings,
    groups,
    decisions: Object.fromEntries(findings.map((f) => [f.id, decisions[f.id]]).filter(([, d]) => d)),
    proposals,
    criteria,
    tasks,
  };
}

function sitesPayload() {
  const findings = loadFindings();
  const decisions = loadDecisions();
  const criteria = loadCriteria();
  const recs = loadSiteRecords();
  const sites = {};
  for (const f of findings) {
    const s = (sites[f.site] ||= { site: f.site, url: f.url, title: f.title, findings: 0, failures: 0, unsure: 0, decided: 0, confirmed: 0, criteriaDone: 0, axe: recs[f.site] ? recs[f.site].axe : null, verdict: recs[f.site] ? recs[f.site].verdict : '' });
    s.findings++;
    if (f.kind === 'violation') s.failures++; else s.unsure++;
    if (decisions[f.id]) { s.decided++; if (decisions[f.id].verdict === 'confirm') s.confirmed++; }
  }
  for (const c of Object.values(criteria)) if (sites[c.site] && c.status && c.status !== 'Not Evaluated') sites[c.site].criteriaDone++;
  return Object.values(sites).sort((a, b) => a.site.localeCompare(b.site));
}

// ---- server ---------------------------------------------------------------

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file, type) {
  if (!existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const site = u.searchParams.get('site') || '';

  if (req.method === 'GET' && u.pathname === '/') {
    return send(res, 200, readFileSync(path.join(ROOT, 'review.html')), MIME['.html']);
  }
  if (req.method === 'GET' && u.pathname === '/api/sites') {
    return send(res, 200, JSON.stringify(sitesPayload()));
  }
  if (req.method === 'GET' && u.pathname === '/api/site') {
    const p = sitePayload(site);
    return p ? send(res, 200, JSON.stringify(p)) : send(res, 404, '{"error":"no such site"}');
  }

  if (req.method === 'POST' && u.pathname === '/api/decision') {
    const d = await readJson(req);
    if (!d) return send(res, 400, '{"error":"bad json"}');
    const ids = Array.isArray(d.ids) ? d.ids : d.id ? [d.id] : [];
    if (!ids.length || !['confirm', 'reject', 'look', 'reopen'].includes(d.verdict)) {
      return send(res, 400, '{"error":"ids and verdict required"}');
    }
    if (d.verdict === 'reject' && !(d.reason || '').trim()) {
      return send(res, 400, '{"error":"a rejection needs a reason"}');
    }
    const findings = Object.fromEntries(loadFindings().map((f) => [f.id, f]));
    const at = new Date().toISOString();
    for (const id of ids) {
      const f = findings[id];
      if (!f) continue;
      const rec = { id, site: f.site, rule: f.rule, target: f.target, verdict: d.verdict, reason: (d.reason || '').trim(), at };
      if (d.group) rec.group = d.group;
      if (ids.length > 1) rec.via = 'group';
      appendFileSync(DECISIONS, JSON.stringify(rec) + '\n');
    }
    writeLog();
    return send(res, 200, JSON.stringify({ ok: true, n: ids.length }));
  }

  if (req.method === 'POST' && u.pathname === '/api/criterion') {
    const d = await readJson(req);
    if (!d || !d.site || !d.criterion) return send(res, 400, '{"error":"site and criterion required"}');
    if (d.status && !WCAG.statuses.includes(d.status)) return send(res, 400, '{"error":"unknown status"}');
    const rec = { site: d.site, criterion: d.criterion, status: d.status || 'Not Evaluated', notes: (d.notes || '').trim(), at: new Date().toISOString() };
    appendFileSync(CRITERIA_FILE, JSON.stringify(rec) + '\n');
    writeLog();
    return send(res, 200, JSON.stringify(rec));
  }

  if (req.method === 'POST' && u.pathname === '/api/task') {
    const d = await readJson(req);
    if (!d || !d.site) return send(res, 400, '{"error":"site required"}');
    const rec = {
      id: d.id || `${d.site}|${Date.now().toString(36)}`,
      site: d.site,
      criterion: d.criterion || '',
      severity: Number(d.severity) || 2,
      shortname: (d.shortname || '').trim(),
      notes: (d.notes || '').trim(),
      reference: (d.reference || '').trim(),
      status: WCAG.taskStatuses.includes(d.status) ? d.status : 'Not Started',
      group: d.group || null,
      at: new Date().toISOString(),
    };
    if (d.deleted) rec.deleted = true;
    appendFileSync(TASKS_FILE, JSON.stringify(rec) + '\n');
    writeLog();
    return send(res, 200, JSON.stringify(rec));
  }

  if (req.method === 'GET' && u.pathname === '/api/export') {
    // Fills the agency worksheet template for one site; see export.py.
    const out = path.join(ROOT, 'exports');
    if (!existsSync(out)) mkdirSync(out, { recursive: true });
    const pys = [process.env.SECOND_PASS_PYTHON, 'C:\\Users\\dchav\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe', 'python3', 'python'].filter(Boolean);
    let last = '';
    for (const py of pys) {
      const r = spawnSync(py, [path.join(ROOT, 'export.py'), site], { cwd: ROOT, encoding: 'utf8' });
      if (r.status === 0) {
        const file = r.stdout.trim().split('\n').pop();
        return serveFile(res, file, MIME['.xlsx']);
      }
      last = (r.stderr || r.error?.message || '').slice(0, 400);
    }
    return send(res, 500, JSON.stringify({ error: `export failed: ${last}` }));
  }

  if (req.method === 'GET' && u.pathname.startsWith('/screens/')) return serveFile(res, path.join(SHOTS, path.basename(u.pathname)), MIME['.png']);
  if (req.method === 'GET' && u.pathname.startsWith('/crops/')) return serveFile(res, path.join(CROPS, path.basename(u.pathname)), MIME['.png']);

  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, '127.0.0.1', () => {
  const n = loadFindings();
  const d = Object.keys(loadDecisions()).length;
  const p = Object.values(loadProposals()).filter((x) => x.verdict).length;
  console.log(`Second Pass review — http://localhost:${PORT}`);
  console.log(`${n.length} findings across ${new Set(n.map((f) => f.site)).size} sites, ${d} decided, ${p} with a model proposal.`);
});
