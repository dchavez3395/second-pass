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
