# Scan audit — did the baseline actually look at these pages?

Run 2026-09-18. 1 sites, 3000ms settle after networkidle.

The baseline run reported zero violations on several of these. This checks whether
that meant "clean" or meant "nothing was examined".

| Site | Verdict | Fails | Needs review | Nodes tested | Elements |
|---|---|---:|---:|---:|---:|
| www.winnipeg.ca | FAILURES DETECTED | 8 | 11 | 826 | 1479 |

## The review queue

These are findings axe flagged and could not resolve. Each one needs a person to
decide. This is the corpus the triage layer is built on.

### www.winnipeg.ca

- `color-contrast` (11 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it is overlapped by another element
  - e.g. `#globalSearchInput`


---

**How to read a zero.** axe tests what it can express as a rule. A page can return
no violations and still be unusable with a screen reader. The "nodes tested" column is
the honest measure of how much the tool actually inspected; a low number next to a zero
means the scan failed, not that the site passed. Screenshots for every page are in
`diagnostics/screens/` so any zero can be looked at rather than taken on trust.
