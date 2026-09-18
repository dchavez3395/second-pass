# Scan audit — did the baseline actually look at these pages?

Run 2026-09-18. 34 sites, 8000ms settle after networkidle.

The baseline run reported zero violations on several of these. This checks whether
that meant "clean" or meant "nothing was examined".

| Site | Verdict | Fails | Needs review | Nodes tested | Elements |
|---|---|---:|---:|---:|---:|
| www.winnipeg.ca | FAILURES DETECTED | 8 | 11 | 826 | 1479 |
| www.brandon.ca | FAILURES DETECTED | 8 | 28 | 423 | 739 |
| www.steinbach.ca | FAILURES DETECTED | 69 | 37 | 458 | 531 |
| www.city-plap.com | FAILURES DETECTED | 2 | 4 | 454 | 725 |
| www.thompson.ca | FAILURES DETECTED | 16 | 34 | 507 | 1139 |
| www.myselkirk.ca | FAILURES DETECTED | 7 | 11 | 732 | 2745 |
| www.cityofwinkler.ca | FAILURES DETECTED | 96 | 34 | 1015 | 1140 |
| www.mordenmb.com | PAGE DID NOT RENDER | 1 | 0 | 35 | 47 |
| www.dauphin.ca | FAILURES DETECTED | 13 | 34 | 521 | 1316 |
| www.cityofflinflon.com | FAILURES DETECTED | 65 | 52 | 986 | 880 |
| www.gov.mb.ca | FAILURES DETECTED | 6 | 3 | 354 | 467 |
| www.hydro.mb.ca | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 9 | 317 | 366 |
| www.mpi.mb.ca | FAILURES DETECTED | 13 | 80 | 363 | 477 |
| www.mbll.ca | FAILURES DETECTED | 7 | 21 | 998 | 745 |
| www.wcb.mb.ca | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 21 | 336 | 744 |
| www.travelmanitoba.com | FAILURES DETECTED | 54 | 76 | 895 | 2291 |
| sharedhealthmb.ca | FAILURES DETECTED | 9 | 11 | 225 | 1696 |
| wrha.mb.ca | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 30 | 304 | 950 |
| prairiemountainhealth.ca | FAILURES DETECTED | 8 | 10 | 297 | 1002 |
| southernhealth.ca | FAILURES DETECTED | 26 | 14 | 451 | 1513 |
| www.ierha.ca | FAILURES DETECTED | 17 | 7 | 265 | 1004 |
| northernhealthregion.com | FAILURES DETECTED | 26 | 19 | 458 | 1078 |
| www.cancercare.mb.ca | FAILURES DETECTED | 11 | 8 | 342 | 726 |
| umanitoba.ca | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 21 | 512 | 736 |
| www.uwinnipeg.ca | FAILURES DETECTED | 8 | 11 | 513 | 612 |
| www.brandonu.ca | FAILURES DETECTED | 13 | 43 | 447 | 485 |
| www.rrc.ca | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 18 | 423 | 991 |
| assiniboine.net | CLEAN ON RULES, OPEN ON JUDGEMENT | 0 | 54 | 727 | 898 |
| ustboniface.ca | FAILURES DETECTED | 1 | 20 | 585 | 1301 |
| www.wsd1.org | PAGE DID NOT RENDER | 1 | 0 | 6 | 8 |
| www.pembinatrails.ca | FAILURES DETECTED | 3 | 18 | 565 | 2541 |
| www.retsd.mb.ca | FAILURES DETECTED | 2 | 53 | 743 | 2593 |
| www.lrsd.net | FAILURES DETECTED | 56 | 6 | 1113 | 1397 |
| www.sjasd.ca | FAILURES DETECTED | 12 | 38 | 774 | 2020 |

## The review queue

These are findings axe flagged and could not resolve. Each one needs a person to
decide. This is the corpus the triage layer is built on.

### www.winnipeg.ca

- `color-contrast` (11 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it is overlapped by another element
  - e.g. `#globalSearchInput`

### www.brandon.ca

- `color-contrast` (28 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `#gsc-i-id2`

### www.steinbach.ca

- `color-contrast` (37 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.nav-utility > .garbage-day > .label`

### www.city-plap.com

- `color-contrast` (4 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it partially overlaps other elements
  - e.g. `#cookieconsent\:desc > p`

### www.thompson.ca

- `aria-valid-attr-value` (1 node) — ARIA attributes must conform to valid values
  - e.g. `.fa-search`
- `color-contrast` (33 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `#headerTop > span`

### www.myselkirk.ca

- `color-contrast` (11 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it is overlapped by another element
  - e.g. `#SR7_31_1-189-51`

### www.cityofwinkler.ca

- `color-contrast` (32 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element has a 1:1 contrast ratio with the background
  - e.g. `#weatherwidget-io-0 .currentTemp`
- `target-size` (2 nodes) — All touch targets must be 24px large, or leave sufficient space
  - axe says: Element size could not be accurately determined due to overflow content
  - e.g. `.owl-prev.disabled[role="presentation"]`

### www.dauphin.ca

- `color-contrast` (34 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.container > .qlContainer > a[href$="form-directory"] > span`

### www.cityofflinflon.com

- `color-contrast` (52 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `h1`

### www.gov.mb.ca

- `aria-valid-attr-value` (2 nodes) — ARIA attributes must conform to valid values
  - e.g. `div[aria-describedby="slick-slide00"]`
- `color-contrast` (1 node) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because element contains an image node
  - e.g. `div[aria-describedby="slick-slide00"] > .slide_content > h2`

### www.hydro.mb.ca

- `color-contrast` (9 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.person-profile`

### www.mpi.mb.ca

- `aria-hidden-focus` (6 nodes) — ARIA hidden element must not be focusable or contain focusable elements
  - e.g. `#search-modal`
- `aria-prohibited-attr` (1 node) — Elements must only use permitted ARIA attributes
  - e.g. `#video-modal`
- `color-contrast` (73 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a pseudo element
  - e.g. `p:nth-child(1)`

### www.mbll.ca

- `color-contrast` (14 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a pseudo element
  - e.g. `a[href$="our-responsibilities"] > h3`
- `target-size` (7 nodes) — All touch targets must be 24px large, or leave sufficient space
  - axe says: Element with negative tabindex has insufficient size (8px by 8px, should be at least 24px by 24px). Is this a target?
  - e.g. `button[aria-controls="splide-0f6a29ab30e-slide01"]`

### www.wcb.mb.ca

- `color-contrast` (19 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background gradient
  - e.g. `.elementor-element-f9fc7df > .elementor-widget-container > p > a`
- `link-in-text-block` (2 nodes) — Links must be distinguishable without relying on color
  - axe says: Element's contrast ratio could not be determined because of element overlap
  - e.g. `.elementor-element-bcc81bd > .elementor-widget-container > p > a`

### www.travelmanitoba.com

- `aria-prohibited-attr` (1 node) — Elements must only use permitted ARIA attributes
  - e.g. `#slide-vid-1 #movie_player`
- `color-contrast` (41 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because element contains an image node
  - e.g. `.nav--header__inner > .has-children.nav__item[data-has-subnav=""]:nth-child(1) > .nav__link[target=""][rel="noopener"]`
- `duplicate-id-aria` (34 nodes) — IDs used in ARIA and labels must be unique
  - axe says: Document has multiple elements referenced with ARIA with the same id attribute: submenu-100121
  - e.g. `.nav--primary > .has-children.nav__item[data-has-subnav=""]:nth-child(1) > .is-hidden.nav--subnav.js-subnav`

### sharedhealthmb.ca

- `aria-prohibited-attr` (2 nodes) — Elements must only use permitted ARIA attributes
  - e.g. `.nivo-prevNav`
- `color-contrast` (9 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `#custom-5640-particle > h1`

### wrha.mb.ca

- `color-contrast` (30 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.swp-input--search`

### prairiemountainhealth.ca

- `aria-prohibited-attr` (9 nodes) — Elements must only use permitted ARIA attributes
  - e.g. `.nivo-prevNav`
- `color-contrast` (1 node) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.swp-input--search`

### southernhealth.ca

- `color-contrast` (14 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.swp-input--search`

### www.ierha.ca

- `color-contrast` (7 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.swp-input--search`

### northernhealthregion.com

- `color-contrast` (19 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.swp-input--search`

### www.cancercare.mb.ca

- `color-contrast` (8 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it's partially obscured by another element
  - e.g. `a[href$="Patient-Family/"]`

### umanitoba.ca

- `aria-prohibited-attr` (1 node) — Elements must only use permitted ARIA attributes
  - e.g. `.eu-cookie-compliance-banner`
- `color-contrast` (20 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a pseudo element
  - e.g. `.hero__link__header > h2`

### www.uwinnipeg.ca

- `color-contrast` (10 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `#main-menu-1 > a`
- `video-caption` (1 node) — <video> elements must have captions
  - e.g. `video`

### www.brandonu.ca

- `aria-valid-attr-value` (1 node) — ARIA attributes must conform to valid values
  - e.g. `#panoramaAccessibilityFloatButton`
- `color-contrast` (42 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `input[type="button"]`

### www.rrc.ca

- `color-contrast` (18 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `a[href$="about/"]`

### assiniboine.net

- `color-contrast` (54 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background image
  - e.g. `.block-views-block--articles-block-featured > h2`

### ustboniface.ca

- `color-contrast` (18 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it is overlapped by another element
  - e.g. `#edit-fulltext`
- `duplicate-id-aria` (1 node) — IDs used in ARIA and labels must be unique
  - axe says: Document has multiple elements referenced with ARIA with the same id attribute: video-title
  - e.g. `.video-control > h2`
- `video-caption` (1 node) — <video> elements must have captions
  - e.g. `video`

### www.pembinatrails.ca

- `color-contrast` (18 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a pseudo element
  - e.g. `#slick-slide02 > .ci-txt > h1 > a`

### www.retsd.mb.ca

- `color-contrast` (45 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a background gradient
  - e.g. `#slick-slide01 > .ci-txt > h1 > a`
- `link-in-text-block` (4 nodes) — Links must be distinguishable without relying on color
  - axe says: Element's contrast ratio could not be determined because of element overlap
  - e.g. `.col-lg-3.col-md-6:nth-child(1) > .card > .card-body > p > a[target="_blank"]`
- `target-size` (4 nodes) — All touch targets must be 24px large, or leave sufficient space
  - axe says: Element with negative tabindex has insufficient size (12px by 12px, should be at least 24px by 24px). Is this a target?
  - e.g. `#slick-slide-control00`

### www.lrsd.net

- `color-contrast` (2 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined due to a pseudo element
  - e.g. `.number-slide1.keen-slider__slide.absolute:nth-child(2) > .bottom-\[80px\].z-10.xl\:flex > .mb-\[20px\] > .text-4xl.font-bold`
- `form-field-multiple-labels` (1 node) — Form field must not have multiple label elements
  - e.g. `#hamburger-input`
- `link-in-text-block` (3 nodes) — Links must be distinguishable without relying on color
  - axe says: Element's contrast ratio could not be determined because of element overlap
  - e.g. `a[href="/lrsd-2034.51440"][target="_self"][aria-label="Read More"]`

### www.sjasd.ca

- `color-contrast` (36 nodes) — Elements must meet minimum color contrast ratio thresholds
  - axe says: Element's background color could not be determined because it is overlapped by another element
  - e.g. `select`
- `link-in-text-block` (2 nodes) — Links must be distinguishable without relying on color
  - axe says: Element's contrast ratio could not be determined because of element overlap
  - e.g. `.SchoolDayContainer`


---

**How to read a zero.** axe tests what it can express as a rule. A page can return
no violations and still be unusable with a screen reader. The "nodes tested" column is
the honest measure of how much the tool actually inspected; a low number next to a zero
means the scan failed, not that the site passed. Screenshots for every page are in
`diagnostics/screens/` so any zero can be looked at rather than taken on trust.
