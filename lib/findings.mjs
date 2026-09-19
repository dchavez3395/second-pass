/**
 * Shared loader: flattens diagnostics/*.json into one finding per node.
 * Used by review.mjs (the human layer) and propose.mjs (the model layer).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const DIAG = path.join(ROOT, 'diagnostics');
export const SHOTS = path.join(DIAG, 'screens');
export const CROPS = path.join(DIAG, 'crops');
export const DECISIONS = path.join(ROOT, 'decisions.jsonl');
export const PROPOSALS = path.join(ROOT, 'proposals.jsonl');

export const slugId = (id) => id.replace(/[^a-z0-9.-]+/gi, '_');

export function loadFindings() {
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
        const id = `${site}|${kind}|${rule.id}|${i}`;
        out.push({
          id,
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
          crop: existsSync(path.join(CROPS, `${slugId(id)}.png`)) ? `${slugId(id)}.png` : null,
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

/** Latest decision per finding; a 'reopen' clears it. */
export function loadDecisions() {
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

/** Latest model proposal per finding. */
export function loadProposals() {
  if (!existsSync(PROPOSALS)) return {};
  const latest = {};
  for (const line of readFileSync(PROPOSALS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      latest[p.id] = p;
    } catch {}
  }
  return latest;
}

/** WCAG 1.4.3 threshold for this element: 3:1 for large text, 4.5:1 otherwise. */
export function contrastThreshold(box) {
  if (!box || !box.fontSize) return 4.5;
  const bold = Number(box.fontWeight) >= 700 || box.fontWeight === 'bold';
  return box.fontSize >= 24 || (bold && box.fontSize >= 18.66) ? 3 : 4.5;
}

// ---- criteria, groups, and the auditor's own records ------------------------

import { readFileSync as _rf } from 'node:fs';
export const WCAG = JSON.parse(_rf(new URL('./wcag22.json', import.meta.url), 'utf8'));
export const CRITERIA_FILE = path.join(ROOT, 'criteria.jsonl');
export const TASKS_FILE = path.join(ROOT, 'tasks.jsonl');

const BEST_PRACTICE = { id: 'best-practice', name: 'Best practice (no WCAG criterion)', level: 'N/A', principle: '—', guideline: '— axe best-practice rules', link: '', guidance: [] };

/** The criterion a finding belongs to: the first WCAG tag axe gave the rule, else best practice. */
export function criterionOf(f) {
  return f.wcag && f.wcag.length ? f.wcag[0] : BEST_PRACTICE.id;
}

export function allCriteria() {
  return [...WCAG.criteria, BEST_PRACTICE];
}

/**
 * Findings that share a cause get one decision. The signature is what an
 * auditor would call "the same thing": same rule, same reason axe gave, and
 * for contrast the same text colour, background and size band.
 */
export function groupKey(f) {
  const msg = (f.messages[0] || '').slice(0, 60);
  const b = f.box || {};
  if (f.rule === 'color-contrast' || f.rule === 'link-in-text-block') {
    const size = b.fontSize ? (b.fontSize >= 24 ? 'large' : b.fontSize >= 18.66 && Number(b.fontWeight) >= 700 ? 'large-bold' : 'normal') : '?';
    return [f.site, f.kind, f.rule, b.color || '?', b.background || '?', size, msg].join('§');
  }
  const tag = (f.html.match(/^<([a-z0-9-]+)/i) || [, '?'])[1].toLowerCase();
  return [f.site, f.kind, f.rule, tag, msg].join('§');
}

export function groupFindings(findings, proposals = {}) {
  const groups = new Map();
  for (const f of findings) {
    const key = groupKey(f);
    if (!groups.has(key)) {
      const b = f.box || {};
      const parts = [];
      if (f.rule === 'color-contrast' || f.rule === 'link-in-text-block') {
        if (b.fontSize) parts.push(`${b.fontSize}px${Number(b.fontWeight) >= 600 ? ' bold' : ''}`);
        if (b.color) parts.push(`text ${b.color}`);
        parts.push(b.background && !/rgba\(0, 0, 0, 0\)/.test(b.background) ? `on ${b.background}` : 'on transparent');
      } else {
        parts.push(`<${(f.html.match(/^<([a-z0-9-]+)/i) || [, '?'])[1].toLowerCase()}>`);
      }
      groups.set(key, {
        id: key,
        site: f.site,
        kind: f.kind,
        rule: f.rule,
        help: f.help,
        helpUrl: f.helpUrl,
        wcag: f.wcag,
        criterion: criterionOf(f),
        impact: f.impact,
        label: parts.join(' · '),
        why: f.messages[0] || '',
        ids: [],
        measured: null,
      });
    }
    groups.get(key).ids.push(f.id);
  }
  for (const g of groups.values()) {
    const ms = g.ids.map((id) => proposals[id] && proposals[id].measured).filter((m) => m && m.ok && m.fg);
    if (ms.length) {
      const worst = Math.min(...ms.map((m) => m.ratio));
      const best = Math.max(...ms.map((m) => m.best || m.ratio));
      const threshold = ms[0].threshold;
      g.measured = { worst: Number(worst.toFixed(2)), best: Number(best.toFixed(2)), threshold, below: ms.filter((m) => m.ratio < m.threshold).length, n: ms.length };
    }
  }
  return [...groups.values()];
}

function latestBy(file, keyFn) {
  if (!existsSync(file)) return {};
  const latest = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      latest[keyFn(d)] = d;
    } catch {}
  }
  return latest;
}

/** Latest status + notes per site|criterion. */
export function loadCriteria() {
  return latestBy(CRITERIA_FILE, (d) => `${d.site}|${d.criterion}`);
}

/** Latest version of each logged issue, by its id. A `deleted: true` record hides it. */
export function loadTasks() {
  const t = latestBy(TASKS_FILE, (d) => d.id);
  for (const k of Object.keys(t)) if (t[k].deleted) delete t[k];
  return t;
}
