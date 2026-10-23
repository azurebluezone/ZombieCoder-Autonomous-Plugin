---
id: uiux-delivery
name: UI/UX Delivery
description: Ship a client-ready interface with a deliberate visual direction, every interaction state, WCAG 2.2 AA and Core Web Vitals budgets. Use for landing pages, dashboards, redesigns and design review.
---

# UI/UX Delivery

A page is not "done" when it renders. It is done when a stranger can use it on a
phone, with a keyboard, on a slow connection, and every state tells the truth.

## 0. Direction before pixels

Decide three things in writing before writing markup:

1. **Who reads this page and what is the one action?** (signup, call, buy, book)
2. **Visual direction** — one expressive display face, one restrained body face,
   one accent color, one neutral ramp. Not "modern and clean".
3. **Evidence of taste** — a reference (screenshot, brand guide, competitor) the
   client can point at. No reference means the design is a guess.

Anti-patterns that read as templated AI output: empty split hero, three identical
feature cards with icons, fake metrics ("99.9% uptime"), oversized headings,
gradients on everything. Each one needs a reason or it gets deleted.

## 1. States are the design

Every data-bearing component needs five states implemented, not described:

| State | Question it answers |
| --- | --- |
| loading | is something happening? (skeleton, not a spinner over blank) |
| empty | what do I do when there is nothing yet? |
| error | what failed, and what can I do now? |
| success | did my action land? |
| edge | long names, zero items, 10 000 items, RTL text |

A component without an error state is a bug report waiting for the client.

## 2. Accessibility floor (WCAG 2.2 AA)

- Contrast: 4.5:1 body text, 3:1 large text and UI borders.
- Keyboard: every action reachable by Tab, visible focus ring (`:focus-visible`),
  no focus traps, Escape closes overlays.
- Semantics: one `h1`, landmark elements, `label` bound to every input,
  `alt` on informative images, `alt=""` on decoration.
- Motion: honor `prefers-reduced-motion`.
- Forms: inline error text tied with `aria-describedby`, never color alone.
- Target size: 24×24 CSS px minimum (2.2 criterion 2.5.8).

Check with keyboard only, then 200% zoom, then a screen reader pass on the
primary flow. Lighthouse accessibility is a floor, not proof.

## 3. Performance budget (set before building)

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s on 4G mobile |
| INP | < 200 ms |
| CLS | < 0.1 |
| JS on first load | < 170 KB gzip for a marketing page |
| Hero image | AVIF/WebP, `srcset`, explicit `width`/`height` |

Rules that keep the budget: system font fallback with `font-display: swap`,
lazy-load below-the-fold media, no layout shift from late fonts or banners,
`loading="eager"` + `fetchpriority="high"` on the LCP image only.

## 4. Responsive contract

Design mobile first, then 768 px, then 1280 px. Content decides breakpoints, not
devices. No horizontal scroll at 320 px. Tap targets stay ≥ 44 px. Tables get a
scroll container or a card layout, never clipped columns.

## 5. Verification (evidence, not opinion)

```bash
npx lighthouse http://localhost:3000 --preset=desktop --output=json --output-path=/tmp/lh.json
node -e "const r=require('/tmp/lh.json');console.log(r.categories.accessibility.score, r.categories.performance.score)"
```

Report the numbers, plus screenshots at 375 px and 1440 px. "Looks good" is not
a result; a score, a screenshot path and a keyboard walkthrough are.

## 6. Review checklist before delivery

- [ ] One clear primary action per screen
- [ ] All five states exist for every async surface
- [ ] Keyboard-only pass on the main flow
- [ ] Contrast checked on real background images, not just tokens
- [ ] Lighthouse ≥ 90 accessibility, budgets met or deviation explained
- [ ] 320 px / 768 px / 1280 px screenshots attached
- [ ] Brand assets (logo, favicon, OG image, meta description) present
- [ ] Copy proofread; no lorem ipsum, no fake testimonials
