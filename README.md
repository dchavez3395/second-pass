# Second Pass

What automated accessibility testing reports on Manitoba public sector websites,
and what a person finds when they resolve the parts the tool could not.

Three layers, each a script:

| Phase | Script | What it produces |
|---|---|---|
| 01 baseline | `audit.mjs` | axe violations per site, the number everyone publishes |
| 01b scan audit | `diagnose.mjs` | proof the scan actually looked (nodes tested, screenshots) plus the **incomplete** list: findings axe raised and could not resolve |
| 03 measurement + model | `propose.mjs` | cuts each element out of the real screenshot, computes the contrast ratio from pixels, and asks a local vision model for a verdict with a reason; writes `proposals.jsonl` |
| 02 review | `review.mjs` | a local page that serves those findings one at a time for a human decision, blind to the model; writes `decisions.jsonl` and `review-log.md` |

## What this shows

Automated accessibility checkers report the failures they can express as rules
and stay silent about the rest. On 34 Manitoba public-sector home pages, axe
reported 558 failures and raised 862 findings it could not resolve — mostly
text on backgrounds it could not see through. The six sites that scored zero
failures carry 153 of those open questions between them.

A model can propose answers to those questions. It cannot be trusted to give
them. So the pipeline here puts the model *before* the person and hides its
answer until the person has decided. What comes out is a corpus of human
decisions with reasons, plus a measured record of how often the model agreed,
raised false alarms, missed real failures, and was confidently wrong — per rule.
That last table is the thing you need before AI-assisted findings can go in
front of a client.

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

## Phase 03 — measurement and model

```
node propose.mjs                     every review item without a proposal
node propose.mjs --site umanitoba.ca
node propose.mjs --measure-only      pixels only, no model
node propose.mjs --model gemma3:12b  default qwen3-vl:8b via Ollama at 127.0.0.1:11434
```

For each finding: crop the element from the full-page screenshot with the
element boxed (`diagnostics/crops/`); for contrast rules, compute the ratio from
the pixels inside the element (dominant colour = background, most-contrasting
colour with real coverage = text) against the 3:1 / 4.5:1 threshold for its font
size; then send the crop, markup, axe's reason, computed styles and the
measurement to a local vision model and take back `{verdict, confidence,
reason}` as JSON. Appends to `proposals.jsonl`. Resumable. About five seconds a
finding on a mid-range GPU.

The measurement is evidence and is shown to the reviewer. The model's verdict is
not shown until the reviewer has decided.

## Phase 02 — review

```
npm run review          # http://localhost:8901
```

One page per site, laid out like an agency audit worksheet. WCAG 2.2 criteria
down the left (from the Vincent Design *Project Accessibility Sheets* template,
with its guidance text, statuses and severities); the selected criterion in the
middle with its status — Supports / Partially Supports / Does Not Support / Not
Evaluated / Not Applicable — and notes; under it the evidence the pipeline
gathered for that criterion, **grouped by cause** (same rule, same reason axe
gave, same text colour, background and size band), each group showing the
worst- and best-case measured contrast against the threshold. One decision
resolves a group; any node can be overridden individually.

The full-page screenshot on the right is the workspace: every finding for the
criterion is a box on it, click a box to jump to its group, hover a group to
light up its boxes. The **eyedropper** (E) measures any two points — the
"lightest and darkest part of the image against the text" method from the
worksheet — and can drop the result into the notes.

Keys: **J/K** move between groups · **C** confirm · **R** reject (reason
required) · **L** closer look · **U** undo · **O** show nodes · **N** log an
issue · **E** eyedropper.

The model's proposals for a group are revealed only after the group is decided.

Records, append-only JSONL, latest wins — commit them, they are the corpus:
`decisions.jsonl` (one line per finding, group decisions marked `via: group`),
`criteria.jsonl` (status and notes per site and criterion), `tasks.jsonl` (the
issue list). `review-log.md` is regenerated on every write: totals, rejection
rate per rule, model-vs-person agreement with false alarms and misses, the
per-site worksheet, and every decision with its reason.

**Export worksheet** fills a copy of the template for the site — criterion
statuses and notes into *Review WCAG V2.2*, logged issues into *Task List* —
via `export.py` (needs Python with openpyxl; set `SECOND_PASS_TEMPLATE` to point
at the template). Output lands in `exports/`.

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
