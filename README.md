# Second Pass

What automated accessibility testing reports on Manitoba public sector websites,
and what a person finds when they resolve the parts the tool could not.

Three layers, each a script:

| Phase | Script | What it produces |
|---|---|---|
| 01 baseline | `audit.mjs` | axe violations per site, the number everyone publishes |
| 01b scan audit | `diagnose.mjs` | proof the scan actually looked (nodes tested, screenshots) plus the **incomplete** list: findings axe raised and could not resolve |
| 02 review | `review.mjs` | a local page that serves those findings one at a time for a human decision; writes `decisions.jsonl` and `review-log.md` |

## Phase 01 — baseline

Baseline axe-core scan of Manitoba public sector websites.

This is the deterministic layer only. Published benchmarks put rule-based tools
near 0.36 recall against an expert audit, so whatever this reports is the floor,
not the finding. The point of the project is the layer that goes on top.

## Run it

```
npm install
npm run setup          # downloads Chromium for Playwright, one time
npm run smoke          # first 3 sites, confirms everything works
npm run audit          # all sites, home pages
npm run audit:deep     # also crawls 2 interior pages per site
```

## Output

- `results/<domain>.json` — full axe output per site, kept for the triage layer later
- `summary.md` — headline numbers, most common rules, per-site table
- `summary.csv` — the same table, for a spreadsheet

## Phase 01b — scan audit

```
npm run diagnose                          # diagnose-urls.txt (the ten from the first check)
node diagnose.mjs --file urls.txt         # all 34
npm run diagnose:slow                     # 15 s settle for slow sites
```

Waits for network idle plus 8 s, counts elements on the page and nodes axe actually
examined, keeps every incomplete and violation node with axe's own per-node
reasoning, the WCAG criterion and the element's on-page box, and screenshots each
page (viewport and full page) into `diagnostics/screens/`. Verdict per site says
whether a zero means clean or means nothing loaded. Report: `scan-audit.md`.

## Phase 02 — review

```
npm run review          # http://localhost:8901
```

One finding at a time: the element, its markup, why axe stopped, the WCAG
criterion, and the screenshot with the element boxed. Keys: **C** confirm,
**R** reject (a reason is required), **L** closer look, **J/K** move, **.** reuse
the last reason, **U** reopen. Filters by kind (axe could not decide / axe
reported a failure), site and rule.

Every decision appends to `decisions.jsonl` (the corpus — commit it). `review-log.md`
is regenerated on each one: totals, rejection rate per rule, and every decision
with its reason. The rejection rate is the finding: how often the tool's flag did
not survive a person looking at it.

## urls.txt

One URL per line, `#` for comments. Corrected after the first runs: `flinflon.ca` → `cityofflinflon.com`,
`sjsd.net` → `sjasd.ca`, `wsd1.org` → `winnipegsd.ca`, `mordenmb.com` → `morden.ca`.
Method notes: `morden.ca` sits behind a Cloudflare challenge and returns a
"Just a moment…" page to a headless browser (flagged PAGE DID NOT RENDER, excluded);
`cancercare.mb.ca` is slow enough to time out at 90 s on some runs.

## Before publishing anything from this

The numbers are machine detections with no human review. Do not describe them as
an audit. The honest framing is "what automated tooling detects," with the recall
caveat attached.

## Verified

The script was run end to end against a deliberately broken local page before
you got it. It correctly reported `button-name`, `color-contrast`, `html-has-lang`,
`image-alt`, `label`, `link-name` and `target-size`, crawled an interior page, and
recorded a 404 as a failure rather than crashing. The only untested part is the
real network, which this machine has and the cloud one does not.

If Playwright can't find Chromium, set `CHROMIUM_PATH` to a Chrome binary and
re-run. On Windows `npm run setup` should make that unnecessary.
