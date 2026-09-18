#!/usr/bin/env node
/**
 * Second Pass — phase 01b, the scan audit.
 *
 * The baseline run returned zero violations on six sites and a mean well below
 * the WebAIM benchmark. Both are more likely to be artifacts of how the scan ran
 * than facts about those sites. This script exists to tell the difference.
 *
 * For each URL it records what the baseline threw away:
 *   - whether the page actually rendered (element count, text length, title)
 *   - how much axe actually examined (nodes across passes, violations, incomplete)
 *   - which rules were INAPPLICABLE, i.e. axe had nothing to check
 *   - the full INCOMPLETE list, which is axe saying "a human has to decide this"
 *   - a screenshot, so a zero can be looked at rather than believed
 *
 * The incomplete list is the important output. Those are the findings a tool
 * cannot resolve on its own, and they are the queue the review layer works from.
 *
 * Usage:
 *   node diagnose.mjs                 every URL in diagnose-urls.txt
 *   node diagnose.mjs --file urls.txt use a different list
 *   node diagnose.mjs --wait 12000    settle time in ms (default 8000)
 *   node diagnose.mjs --report-only   rebuild scan-audit.md from diagnostics/ without scanning
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const axeMod = require('@axe-core/playwright');
const AxeBuilder = axeMod.AxeBuilder || axeMod.default || axeMod;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function argStr(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const SETTLE = Number(argStr('wait', '8000'));
const LIST = argStr('file', 'diagnose-urls.txt');
const NAV_TIMEOUT = 90000;

const OUT = path.join(process.cwd(), 'diagnostics');
const SHOTS = path.join(OUT, 'screens');
for (const d of [OUT, SHOTS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const urls = readFileSync(LIST, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));

const slug = (u) => new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');

function nodeCount(arr) {
  return arr.reduce((a, r) => a + r.nodes.length, 0);
}

async function diagnose(browser, url) {
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const rec = { url, ok: false };

  try {
    let resp = null;
    try {
      resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    } catch {
      // networkidle never settles on sites with polling or chat widgets.
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    }
    await page.waitForTimeout(SETTLE);

    rec.status = resp ? resp.status() : null;
    rec.title = await page.title().catch(() => '');
    rec.finalUrl = page.url();

    // Did the page actually render anything?
    const shape = await page.evaluate(() => ({
      elements: document.querySelectorAll('*').length,
      images: document.querySelectorAll('img').length,
      links: document.querySelectorAll('a').length,
      buttons: document.querySelectorAll('button, [role="button"]').length,
      inputs: document.querySelectorAll('input, select, textarea').length,
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      textLength: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().length,
      lang: document.documentElement.getAttribute('lang') || '',
      iframes: document.querySelectorAll('iframe').length,
    }));
    rec.shape = shape;

    await page
      .screenshot({ path: path.join(SHOTS, `${slug(url)}.png`), fullPage: false })
      .catch(() => {});
    await page
      .screenshot({ path: path.join(SHOTS, `${slug(url)}.full.png`), fullPage: true })
      .catch(() => {});
    rec.viewport = { width: 1366, height: 900 };
    rec.scannedAt = new Date().toISOString();

    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    rec.axe = {
      violationRules: r.violations.length,
      violationNodes: nodeCount(r.violations),
      passRules: r.passes.length,
      passNodes: nodeCount(r.passes),
      incompleteRules: r.incomplete.length,
      incompleteNodes: nodeCount(r.incomplete),
      inapplicableRules: r.inapplicable.length,
    };
    rec.axe.testedNodes = rec.axe.passNodes + rec.axe.violationNodes + rec.axe.incompleteNodes;

    // The human-review queue: axe could not decide these on its own.
    // Every node is kept, with axe's own reasoning per node and where the
    // element sits on the page, because the review layer works one node at a time.
    const msgs = (n) =>
      [...(n.any || []), ...(n.all || []), ...(n.none || [])]
        .map((c) => c.message)
        .filter(Boolean);
    const boxes = await page
      .evaluate((sels) => {
        const out = {};
        for (const sel of sels) {
          try {
            const el = document.querySelector(sel);
            if (!el) continue;
            const b = el.getBoundingClientRect();
            out[sel] = { x: b.x, y: b.y, w: b.width, h: b.height };
          } catch {}
        }
        return out;
      }, [...r.incomplete, ...r.violations].flatMap((v) => v.nodes.map((n) => n.target.join(' '))))
      .catch(() => ({}));
    const wcag = (tags) =>
      tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => `${t[4]}.${t[5]}.${t.slice(6)}`);
    const shapeNodes = (v) =>
      v.nodes.map((n) => ({
        target: n.target.join(' '),
        html: (n.html || '').slice(0, 600),
        impact: n.impact || v.impact,
        messages: msgs(n),
        box: boxes[n.target.join(' ')] || null,
      }));

    rec.incomplete = r.incomplete.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      tags: v.tags,
      wcag: wcag(v.tags),
      why: (v.nodes[0] && v.nodes[0].any && v.nodes[0].any[0] && v.nodes[0].any[0].message) || '',
      nodes: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => ({
        target: n.target.join(' '),
        html: (n.html || '').slice(0, 200),
      })),
      items: shapeNodes(v),
    }));

    rec.violations = r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      tags: v.tags,
      wcag: wcag(v.tags),
      nodes: v.nodes.length,
      items: shapeNodes(v),
    }));

    // Verdict. A zero is only meaningful if axe had something to look at.
    const a = rec.axe;
    if (shape.elements < 60 || shape.textLength < 200) {
      rec.verdict = 'PAGE DID NOT RENDER — scan is worthless, do not report this number';
    } else if (a.testedNodes < 40) {
      rec.verdict = 'BARELY TESTED — axe examined almost nothing, treat as unscanned';
    } else if (a.violationNodes === 0 && a.incompleteNodes > 0) {
      rec.verdict = 'CLEAN ON RULES, OPEN ON JUDGEMENT — the work is in the incomplete list';
    } else if (a.violationNodes === 0) {
      rec.verdict = 'CLEAN AT MACHINE LEVEL — still says nothing about meaning or structure';
    } else {
      rec.verdict = 'FAILURES DETECTED';
    }

    rec.ok = true;
  } catch (err) {
    rec.error = String(err).split('\n')[0].slice(0, 220);
    rec.verdict = 'UNREACHABLE';
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }

  writeFileSync(path.join(OUT, `${slug(url)}.json`), JSON.stringify(rec, null, 2));
  return rec;
}

async function main() {
  const recs = [];
  if (process.argv.includes('--report-only')) {
    for (const f of readdirSync(OUT).filter((n) => n.endsWith('.json')).sort()) {
      recs.push(JSON.parse(readFileSync(path.join(OUT, f), 'utf8')));
    }
    writeReport(recs);
    return;
  }

  console.log(`Scan audit — ${urls.length} sites, ${SETTLE}ms settle, networkidle\n`);
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );

  for (const u of urls) {
    const r = await diagnose(browser, u);
    recs.push(r);
    if (!r.ok) {
      console.log(`  ${'UNREACHABLE'.padEnd(13)} ${u}\n${' '.repeat(16)}${r.error}`);
    } else {
      const a = r.axe;
      console.log(
        `  ${String(a.violationNodes).padStart(4)} fail  ` +
          `${String(a.incompleteNodes).padStart(4)} review  ` +
          `${String(a.testedNodes).padStart(5)} tested  ` +
          `${String(r.shape.elements).padStart(5)} els   ${u}`
      );
      console.log(`${' '.repeat(16)}${r.verdict}`);
    }
  }
  await browser.close();
  writeReport(recs);
}

function writeReport(recs) {
  let md = `# Scan audit — did the baseline actually look at these pages?\n\n`;
  md += `Run ${new Date().toISOString().slice(0, 10)}. ${recs.length} sites, ${SETTLE}ms settle after networkidle.\n\n`;
  md += `The baseline run reported zero violations on several of these. This checks whether\n`;
  md += `that meant "clean" or meant "nothing was examined".\n\n`;
  md += `| Site | Verdict | Fails | Needs review | Nodes tested | Elements |\n|---|---|---:|---:|---:|---:|\n`;
  for (const r of recs) {
    if (!r.ok) {
      md += `| ${new URL(r.url).hostname} | UNREACHABLE | | | | |\n`;
      continue;
    }
    md += `| ${new URL(r.url).hostname} | ${r.verdict.split(' — ')[0]} | ${r.axe.violationNodes} | ${r.axe.incompleteNodes} | ${r.axe.testedNodes} | ${r.shape.elements} |\n`;
  }

  const queue = recs.filter((r) => r.ok && r.incomplete && r.incomplete.length);
  md += `\n## The review queue\n\n`;
  md += `These are findings axe flagged and could not resolve. Each one needs a person to\n`;
  md += `decide. This is the corpus the triage layer is built on.\n\n`;
  for (const r of queue) {
    md += `### ${new URL(r.url).hostname}\n\n`;
    for (const it of r.incomplete) {
      md += `- \`${it.id}\` (${it.nodes} node${it.nodes === 1 ? '' : 's'}) — ${it.help}\n`;
      if (it.why) md += `  - axe says: ${it.why}\n`;
      if (it.sample[0]) md += `  - e.g. \`${it.sample[0].target}\`\n`;
    }
    md += `\n`;
  }
  if (!queue.length) md += `_No incomplete results on this run._\n`;

  md += `\n---\n\n**How to read a zero.** axe tests what it can express as a rule. A page can return\n`;
  md += `no violations and still be unusable with a screen reader. The "nodes tested" column is\n`;
  md += `the honest measure of how much the tool actually inspected; a low number next to a zero\n`;
  md += `means the scan failed, not that the site passed. Screenshots for every page are in\n`;
  md += `\`diagnostics/screens/\` so any zero can be looked at rather than taken on trust.\n`;

  writeFileSync('scan-audit.md', md);
  console.log(`\nWrote scan-audit.md, ${recs.length} files in diagnostics/, screenshots in diagnostics/screens/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
