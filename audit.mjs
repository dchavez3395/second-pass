#!/usr/bin/env node
/**
 * Second Pass — phase 01 baseline.
 *
 * Runs axe-core against a list of sites and writes the raw results plus a
 * summary. This is the DETERMINISTIC layer only: it is the 36%-recall tool
 * the whole project exists to sit on top of. Treat its output as the floor,
 * never as the audit.
 *
 * Usage:
 *   node audit.mjs                     home page of every URL in urls.txt
 *   node audit.mjs --interior 2        also crawl up to 2 same-origin links
 *   node audit.mjs --concurrency 2     default 3
 *   node audit.mjs --limit 5           first 5 URLs only (use this first)
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const axeMod = require('@axe-core/playwright');
const AxeBuilder = axeMod.AxeBuilder || axeMod.default || axeMod;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}
const INTERIOR = arg('interior', 0);
const CONCURRENCY = arg('concurrency', 3);
const LIMIT = arg('limit', Infinity);

const OUT = path.join(process.cwd(), 'results');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const urls = readFileSync('urls.txt', 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'))
  .slice(0, LIMIT);

const slug = (u) => new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');

async function interiorLinks(page, origin, n) {
  if (!n) return [];
  try {
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
    const seen = new Set();
    const out = [];
    for (const h of hrefs) {
      try {
        const u = new URL(h);
        if (u.origin !== origin) continue;
        if (u.pathname === '/' || u.pathname === '') continue;
        if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
        const key = u.origin + u.pathname;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= n) break;
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

async function auditPage(context, url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500); // let deferred/JS content settle
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const violations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      tags: v.tags.filter((t) => t.startsWith('wcag')),
      nodes: v.nodes.length,
      sample: v.nodes.slice(0, 2).map((n) => ({
        target: n.target.join(' '),
        html: (n.html || '').slice(0, 220),
      })),
    }));
    return {
      url,
      status: resp ? resp.status() : null,
      title: await page.title().catch(() => ''),
      violationTypes: violations.length,
      violationInstances: violations.reduce((a, v) => a + v.nodes, 0),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      violations,
      ok: true,
    };
  } catch (err) {
    return { url, ok: false, error: String(err).split('\n')[0].slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function auditSite(browser, root) {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const pages = [];
  const home = await auditPage(context, root);
  pages.push(home);

  if (home.ok && INTERIOR) {
    const p = await context.newPage();
    try {
      await p.goto(root, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const links = await interiorLinks(p, new URL(root).origin, INTERIOR);
      await p.close();
      for (const l of links) pages.push(await auditPage(context, l));
    } catch {
      await p.close().catch(() => {});
    }
  }

  await context.close();
  const rec = { site: root, auditedAt: new Date().toISOString(), pages };
  writeFileSync(path.join(OUT, `${slug(root)}.json`), JSON.stringify(rec, null, 2));
  return rec;
}

async function main() {
  console.log(`Second Pass baseline — ${urls.length} sites, interior=${INTERIOR}, concurrency=${CONCURRENCY}\n`);
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const records = [];
  const queue = [...urls];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const root = queue.shift();
        const rec = await auditSite(browser, root);
        records.push(rec);
        const home = rec.pages[0];
        if (home.ok) {
          console.log(
            `  OK    ${String(home.violationInstances).padStart(4)} issues  ${String(
              home.violationTypes
            ).padStart(2)} types   ${root}`
          );
        } else {
          console.log(`  FAIL                        ${root}   ${home.error}`);
        }
      }
    })
  );
  await browser.close();

  // ---- summary -----------------------------------------------------------
  const okRecs = records.filter((r) => r.pages[0].ok);
  const failed = records.filter((r) => !r.pages[0].ok);
  const allPages = okRecs.flatMap((r) => r.pages).filter((p) => p.ok);

  const byRule = new Map();
  for (const p of allPages)
    for (const v of p.violations) {
      const e = byRule.get(v.id) || { id: v.id, help: v.help, pages: 0, instances: 0 };
      e.pages += 1;
      e.instances += v.nodes;
      byRule.set(v.id, e);
    }
  const ranked = [...byRule.values()].sort((a, b) => b.pages - a.pages);

  const totalInstances = allPages.reduce((a, p) => a + p.violationInstances, 0);
  const withAny = allPages.filter((p) => p.violationInstances > 0).length;
  const avg = allPages.length ? (totalInstances / allPages.length).toFixed(1) : '0';
  const pctFailing = allPages.length ? ((withAny / allPages.length) * 100).toFixed(1) : '0';

  let md = `# Manitoba public sector — axe-core baseline\n\n`;
  md += `Run ${new Date().toISOString().slice(0, 10)}. ${okRecs.length} sites reached, ${failed.length} unreachable, ${allPages.length} pages scanned.\n\n`;
  md += `Tags: ${TAGS.join(', ')}. Chromium at 1366x900.\n\n`;
  md += `## Headline\n\n`;
  md += `- Pages with at least one detected WCAG failure: **${pctFailing}%** (${withAny} of ${allPages.length})\n`;
  md += `- Detected failures per page, mean: **${avg}**\n`;
  md += `- Total detected failure instances: **${totalInstances}**\n\n`;
  md += `> WebAIM Million 2026 for comparison: 95.9% of home pages with detected failures, 56.1 per page.\n\n`;
  md += `## Most common rules\n\n| Rule | Description | Pages | Instances |\n|---|---|---:|---:|\n`;
  for (const r of ranked.slice(0, 20))
    md += `| \`${r.id}\` | ${r.help} | ${r.pages} | ${r.instances} |\n`;

  md += `\n## Per site\n\n| Site | Pages | Types | Instances |\n|---|---:|---:|---:|\n`;
  for (const r of okRecs.sort(
    (a, b) => b.pages[0].violationInstances - a.pages[0].violationInstances
  )) {
    const inst = r.pages.filter((p) => p.ok).reduce((a, p) => a + p.violationInstances, 0);
    const types = new Set(r.pages.filter((p) => p.ok).flatMap((p) => p.violations.map((v) => v.id)));
    md += `| ${new URL(r.site).hostname} | ${r.pages.filter((p) => p.ok).length} | ${types.size} | ${inst} |\n`;
  }

  if (failed.length) {
    md += `\n## Unreachable\n\n`;
    for (const r of failed) md += `- ${r.site} — ${r.pages[0].error}\n`;
  }

  md += `\n---\n\n**Method note.** These are axe-core detections only. Published benchmarks put rule-based\n`;
  md += `tooling near 0.36 recall against expert audit, so the real failure count is materially\n`;
  md += `higher than anything here. Nothing in this file has been reviewed by a human yet.\n`;

  writeFileSync('summary.md', md);

  const csv = ['site,pages,violation_types,violation_instances']
    .concat(
      okRecs.map((r) => {
        const ps = r.pages.filter((p) => p.ok);
        const types = new Set(ps.flatMap((p) => p.violations.map((v) => v.id)));
        return `${new URL(r.site).hostname},${ps.length},${types.size},${ps.reduce(
          (a, p) => a + p.violationInstances,
          0
        )}`;
      })
    )
    .join('\n');
  writeFileSync('summary.csv', csv);

  console.log(`\n${pctFailing}% of pages had a detected failure. Mean ${avg} per page.`);
  console.log(`Wrote summary.md, summary.csv and ${records.length} files in results/`);
  if (failed.length) console.log(`${failed.length} sites unreachable — check the URLs in summary.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
