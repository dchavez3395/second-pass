# Second Pass

What automated accessibility testing reports on Manitoba public sector websites,
and what a person finds when they resolve the parts the tool could not.

Three layers, each a script:

| Phase | Script | What it produces |
|---|---|---|
| 01 baseline | `audit.mjs` | axe violations per site, the number everyone publishes |
| 01b scan audit | `diagnose.mjs` | proof the scan actually looked (nodes tested, screenshots) plus the **incomplete** list: findings axe raised and could not resolve |
| 03 measurement + model | `propose.mjs` | cuts each element out of the real screenshot, computes the contrast ratio from pixels, and asks a local vision model for a verdict with a reason; writes `proposals.jsonl` |
| 04 checks beyond the rules | `checks.mjs` | alt text that says what the image says, link text that says where it goes, headings that describe their section — a vision model on the captured content, plus rules where a rule suffices; writes `checks.jsonl`, reviewed as "AI found" |
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

## Phase 04 — checks a rule cannot make

```
node checks.mjs                     # every site, every check; resumable
node checks.mjs --site umanitoba.ca --check alt-text
```

`diagnose.mjs` now captures every image with its alt, every link with its
accessible name and its 2.4.4 context (the enclosing sentence, list item or
cell, else the nearest heading), and the heading outline. `checks.mjs` then:

- **alt-text (1.1.1)** — rules catch file names, "image"/"White Logo", internal
  labels ("file photo"), over-long alts, decorative images that are a link's
  only content. Everything else goes to the vision model with the actual image,
  its alt and its context: is this alt what a blind user needs?
- **link-purpose (2.4.4)** — generic text ("Learn more") with no sentence, list
  item or cell around it is a rule. Generic or duplicated text *with* context
  goes to the model with that context.
- **headings (1.3.1, 2.4.6)** — empty headings and skipped levels are rules;
  the outline goes to the model for headings that do not describe their section.

Each raised item is a claim. It appears in the review page tagged **AI found**
with the reason (and a suggested alt where the model offered one); the
reviewer's Confirm or Ignore is the measurement. `review-log.md` gains a "Beyond
the rules" section: raised, confirmed, ignored and precision per check, and the
share of all confirmed problems that had no axe rule behind them — what
"automated tools miss" means on these pages, as reviewed.

Model plumbing note (`lib/ollama.mjs`): qwen3-vl thinks out loud on text-only
prompts regardless of `think:false`; prefilling the first characters of the
JSON answer is what makes it answer directly.

## Phase 02 — review

```
npm run review          # http://localhost:8901
```

Laid out like the Equalize Digital Accessibility Checker, which is what the
reviewer already knows: a summary strip, then one row per **issue** (findings
grouped by cause — same rule, same reason axe gave, same text colour,
background and size band) with its count, its worst- and best-case measured
contrast, and its review status. **Details** opens the items: crop, code,
measurement, and Confirm / Ignore (reason required) / Not sure per item or for
the whole issue at once. **View on page** walks the items on the full-page
screenshot with the element spotlighted, ◀ ▶ to step, the same three buttons,
and an eyedropper for two-point contrast checks — the worksheet's "lightest and
darkest part of the image against the text" method.

The AI's opinion on an item is shown only after that item is decided.

The **Worksheet** tab is the template's Review sheet: a status and a note per
WCAG 2.2 A/AA criterion, with a status suggested from what has been reviewed.
**Export worksheet** fills a copy of the template (`export.py`, needs Python with
openpyxl; `SECOND_PASS_TEMPLATE` points at the template) into `exports/`.

Records, append-only JSONL, latest wins — commit them, they are the corpus:
`decisions.jsonl` (one line per finding), `criteria.jsonl` (status and notes per
site and criterion), `tasks.jsonl` (logged issues). `review-log.md` is
regenerated on every write: totals, rejection rate per rule, model-vs-person
agreement with false alarms and misses, the per-site worksheet, and every
decision with its reason.

## urls.txt

One URL per line, `#` for comments. Corrected after the first runs: `flinflon.ca` → `cityofflinflon.ca` (`cityofflinflon.com`
is an expired domain now serving unrelated content — a finding in itself),
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
