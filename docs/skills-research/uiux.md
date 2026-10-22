# UI/UX Skills for Nila — "The Regex Paga"

First-principles UI/UX skills for the ZombieCoder UI/UX agent. Each skill follows
**what → why → how**, with a concrete application in a real codebase and one
authoritative source that was actually fetched while preparing this document
(2026-10-21).

These are working skills, not a mood board. A UI change is finished only when the
relevant state, viewport, input method and failure path have been exercised.

## Skill map

| # | Skill | Primary use |
| --- | --- | --- |
| 1 | Accessibility baseline (WCAG 2.2 POUR) | Define the non-negotiable floor |
| 2 | Semantic HTML before ARIA | Choose the right primitive |
| 3 | Keyboard operability and focus order | Make every path keyboard-complete |
| 4 | Visible focus and `:focus-visible` | Keep the keyboard cursor locatable |
| 5 | Pointer target size | Prevent mis-taps |
| 6 | Contrast and non-color cues | Keep meaning visible |
| 7 | ARIA live regions | Announce async status |
| 8 | Accessible forms and inline validation | Make input recoverable |
| 9 | Responsive layout foundations | Layout as a function of space |
| 10 | Container queries | Components respond to their own box |
| 11 | Interaction states | Design the full state machine |
| 12 | Design tokens | Separate decisions from values |
| 13 | Response-time budgets | Match feedback to latency |
| 14 | Skeleton and loading states | Explain waiting honestly |
| 15 | Empty states | Treat absence as information |
| 16 | Error messages | Restore the user's path |
| 17 | Journey mapping and user-path analysis | Find the real sequence |
| 18 | Reduced motion | Respect vestibular safety |
| 19 | Regex for repetitive UI edits | Change text-shaped repetition safely |
| 20 | AST codemods for UI refactors | Change tree-shaped repetition safely |

---

## 1. Accessibility baseline: WCAG 2.2 POUR

**What it is.** WCAG 2.2 organises accessibility into four principles —
**Perceivable, Operable, Understandable, Robust** — with testable success
criteria at levels A, AA and AAA. AA is the usual product baseline; AAA criteria
are design targets, not a default release gate.

**Why it matters.** Accessibility is not a feature added at the end; it is a
constraint on the information channel. If meaning exists only in colour, hover or
a mouse gesture, it does not exist for every user. POUR gives a stable checklist
that survives redesigns and framework migrations.

**How to apply.**
1. Put the target in the repo: `WCAG 2.2 AA` in the UI contribution guide.
2. Map each screen to the four principles before styling it:
   - Perceivable: alt text, captions, contrast, no color-only meaning.
   - Operable: keyboard, focus, target size, no timing traps.
   - Understandable: labels, consistent navigation, error suggestions.
   - Robust: valid semantics, name/role/value exposed to assistive tech.
3. Make accessibility checks part of the definition of done, not a separate ticket.
4. Record exceptions explicitly with owner and expiry; never silently waive a criterion.

**Check.** Keyboard-only pass, 200% zoom, screen-reader smoke test, automated scan
(e.g. axe) — then manual verification of anything the scanner cannot judge.

**Source.** https://www.w3.org/TR/WCAG22/

---

## 2. Semantic HTML before ARIA

**What it is.** Use the element whose meaning matches the job: `<button>` for an
action, `<a href>` for navigation, `<nav>`, `<main>`, `<header>`, `<label>`,
`<table>` for tabular data. Semantics are the machine-readable contract of the page.

**Why it matters.** Native elements ship with role, keyboard behaviour, focusability
and state for free. A `<div onclick>` has none of that. ARIA can rename or describe
a thing, but it cannot supply missing behaviour; incorrect ARIA is worse than none.

**How to apply.**
1. Write the plain-HTML outline first: landmarks, headings, lists, forms, tables.
2. One `<h1>` per page, headings in order; do not choose heading level by font size.
3. Use `<button type="button">` for UI actions and `<a href>` only for URLs.
4. Add ARIA only when native semantics cannot express the pattern, then follow the
   ARIA Authoring Practices pattern exactly.
5. Keep decorative images `alt=""`; give informative images meaningful alt text.

```html
<!-- action: button; navigation: link -->
<button type="button" aria-expanded="false" aria-controls="menu">Filters</button>
<a href="/reports/2026">2026 reports</a>
```

**Check.** Disable CSS: the page should still read in a sensible order. Inspect the
accessibility tree and confirm name, role and state.

**Source.** https://developer.mozilla.org/en-US/docs/Glossary/Semantics

---

## 3. Keyboard operability and focus order

**What it is.** Every interactive path must be completable with a keyboard:
`Tab`/`Shift+Tab` move between widgets, arrow keys move inside composite widgets,
`Enter`/`Space` activate, `Esc` dismisses. Focus order follows reading order.

**Why it matters.** Keyboard access is the shared substrate for screen readers,
switch devices, voice control and power users. A custom widget that only responds
to clicks excludes all of them. Predictable focus is also how users know where
they are.

**How to apply.**
1. Prefer native controls; they are already in the tab order.
2. For composite widgets (tabs, menus, listboxes, grids), use **roving tabindex**
   (`tabindex="0"` on the active item, `-1` on the rest) or
   `aria-activedescendant`, and implement the arrow-key contract for that pattern.
3. Never add positive `tabindex`; fix DOM order instead.
4. Move focus deliberately when content changes: open dialog → first meaningful
   control; close dialog → the trigger; delete row → next row or the list heading.
5. Do not trap focus except inside a modal dialog, and always provide `Esc`.

**Check.** Unplug the mouse. Complete the primary task. Confirm focus never
disappears, never jumps backwards unexpectedly, and can always leave a component.

**Source.** https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/

---

## 4. Visible focus and `:focus-visible`

**What it is.** Focus indication is the visible cursor for keyboard users.
`:focus-visible` lets the browser show a ring for keyboard/script focus while
usually suppressing it for a mouse click. WCAG 2.4.13 (AAA) quantifies a strong
indicator: at least the area of a 2 CSS-pixel perimeter, with 3:1 contrast between
focused and unfocused states. The AA baseline is 2.4.7 Focus Visible.

**Why it matters.** Removing `outline` to make a design look clean makes the
product unusable without a mouse. A visible, high-contrast ring is cheaper than
supporting a user who is lost.

**How to apply.**
1. Never use `outline: none` without an equivalent replacement.
2. Define one focus token and apply it consistently, with offset so the ring is
   not clipped by overflow.
3. Test on dark, light, image and coloured backgrounds.
4. For custom widgets, put the ring on the actual focused element, not only on a
   wrapper that may be off-screen.

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: 2px;
}
```

**Check.** Tab through every screen at 100% and 200% zoom. The ring must be visible
on every stop and must not be hidden by sticky headers or `overflow: hidden`.

**Source.** https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

---

## 5. Pointer target size

**What it is.** WCAG 2.5.8 (AA) requires pointer targets to be at least
**24 × 24 CSS pixels**, unless the target has enough spacing, an equivalent
alternative exists, or the target is inline text. The 24 px value is a floor, not
a comfort target.

**Why it matters.** Small targets cause mis-taps for people with tremor, limited
dexterity, large fingers or a phone used one-handed. Enlarging the hit area is
usually a CSS change, not a redesign.

**How to apply.**
1. Audit icon buttons, row actions, close buttons, pagination and checkboxes.
2. Separate the **visual size** from the **hit area**: a 16 px icon can sit inside a
   24–44 px button with padding.
3. Add spacing between adjacent destructive actions; never place "Delete" directly
   against "Save" with no gap.
4. Keep the target size when the viewport shrinks; responsive layout must not shrink
   controls below the floor.

```css
.icon-button {
  min-inline-size: 24px;
  min-block-size: 24px;
  display: inline-grid;
  place-items: center;
  padding: 8px;
}
```

**Check.** Measure the clickable box in DevTools, not the icon. Test with a coarse
pointer and at 320 px viewport width.

**Source.** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

---

## 6. Contrast and non-color cues

**What it is.** WCAG 1.4.3 (AA) requires **4.5:1** contrast for normal text and
**3:1** for large text (roughly ≥ 18 pt, or ≥ 14 pt bold). WCAG 1.4.1 separately
requires that colour is not the only way to convey meaning.

**Why it matters.** Low-contrast grey-on-grey is the most common visual accessibility
failure. Colour-only meaning fails for colour-blind users, monochrome displays,
forced-colors mode and printed output. Contrast is measurable, so there is no excuse
for guessing.

**How to apply.**
1. Tokenise text colours by role (`text`, `text-muted`, `text-disabled`) and verify
   each pair against its actual background, including hover and selected states.
2. Do not use opacity to create muted text without re-checking the composite colour.
3. Pair colour with a second cue: icon, label, underline, pattern, weight or position.
4. Check focus rings, borders of inputs, charts and status badges — non-text UI also
   needs 3:1 against adjacent colours.
5. Test `forced-colors: active`; do not rely on background images for meaning.

```html
<!-- wrong: colour alone -->
<span class="dot red"></span>
<!-- right: colour + text/icon -->
<span class="status status--error">● Failed: payment declined</span>
```

**Check.** Run a contrast checker on rendered pairs; view the screen in grayscale
and in forced-colors mode.

**Source.** https://webaim.org/articles/contrast/

---

## 7. Status announcements with ARIA live regions

**What it is.** A live region (`aria-live="polite"`, `role="status"`,
`role="alert"`) tells assistive technology to announce content that changes without
a page reload. `polite` waits for a pause; `assertive` interrupts and should be
reserved for time-critical failures.

**Why it matters.** Visual users see a toast, spinner or inline error; screen-reader
users hear nothing unless the change is announced. Silent async updates make a
modern SPA feel broken.

**How to apply.**
1. Put an empty, persistent live region in the DOM at mount; inject text into it
   after the update. A region created and filled in the same tick is often missed.
2. Use `role="status"` for success and background updates; `role="alert"` only for
   errors that need immediate attention.
3. Announce the outcome, not the mechanism: "Report exported" not "fetch resolved".
4. Do not announce every keystroke or every row of a stream; batch and debounce.
5. Keep the visual toast and the announced text equivalent.

```html
<div id="app-status" role="status" aria-live="polite" aria-atomic="true"></div>
<script>
  document.getElementById("app-status").textContent = "Report exported.";
</script>
```

**Check.** With a screen reader, trigger save/delete/export and confirm exactly one
useful announcement, with no duplicate or interrupted speech.

**Source.** https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions

---

## 8. Accessible forms and inline validation

**What it is.** A form is a conversation: every control needs a programmatic label,
instructions where the expected format is not obvious, an error message tied to the
field, and a suggestion for recovery. Native constraint validation plus
`aria-invalid`/`aria-describedby` covers most needs.

**Why it matters.** Forms are where users spend money, submit work and abandon
products. An unlabelled input is unusable with a screen reader; an error that only
turns the border red is invisible to a colour-blind user and unhelpful to everyone.

**How to apply.**
1. Every input gets a `<label for>`; placeholders are hints, never labels.
2. Put format instructions before the field and connect them with
   `aria-describedby`.
3. Validate on submit, then re-validate on input after the first error; do not shout
   while the user is still typing the first character.
4. Set `aria-invalid="true"` and render the message next to the field; move focus to
   the first invalid field or an error summary.
5. Preserve entered values after a failed submit; never clear the form.
6. Use the Constraint Validation API (`validity`, `setCustomValidity`) for custom
   rules so browser and assistive tech agree.

```html
<label for="email">Work email</label>
<p id="email-hint">We use this for the receipt.</p>
<input id="email" name="email" type="email" required
       aria-describedby="email-hint email-error" aria-invalid="true">
<p id="email-error">Enter an email in the form name@company.com.</p>
```

**Check.** Submit empty, submit malformed, submit valid. Repeat with a screen reader
and confirm label, hint, error and recovery are all announced.

**Source.** https://www.w3.org/WAI/tutorials/forms/

---

## 9. Responsive layout foundations

**What it is.** Responsive design makes layout a function of available space:
a correct viewport declaration, fluid grids, flexible media and breakpoints where
the content actually breaks — not where a device catalogue says it should.

**Why it matters.** Users resize windows, split screens, rotate phones and zoom.
Device-specific layouts rot quickly. Content-driven breakpoints survive new hardware.

**How to apply.**
1. Include `<meta name="viewport" content="width=device-width, initial-scale=1">`.
2. Start with the narrow layout (mobile-first), then add complexity with
   `min-width` media queries.
3. Use `minmax()`, `clamp()`, `fr` and `auto-fit` instead of fixed pixel columns.
4. Make media fluid: `img { max-width: 100%; height: auto; }`.
5. Choose breakpoints by resizing until the layout fails, then fix it there.
6. Test at 320 CSS px (WCAG reflow), 768, 1024 and a wide desktop; also test 400% zoom.

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: var(--space-4);
}
```

**Check.** No horizontal scrolling at 320 px; no clipped text at 200%/400% zoom;
tap targets remain ≥ 24 px.

**Source.** https://web.dev/articles/responsive-web-design-basics

---

## 10. Container queries for component-level responsiveness

**What it is.** A container query styles a component based on the size of its
container, not the viewport. Declare a containment context with
`container-type: inline-size` and query it with `@container`.

**Why it matters.** The same card can live in a wide main column and a narrow
sidebar. Viewport media queries cannot know that, so teams duplicate variants or
pass layout props through the component API. Container queries make the component
own its responsive behaviour.

**How to apply.**
1. Identify reusable components whose layout depends on placement (cards, media
   objects, toolbars, data rows).
2. Name containers when nesting: `container: card / inline-size`.
3. Write the narrow/default styles first, then `@container` overrides.
4. Use `cqi`/`cqw` units for type and spacing that should scale with the container.
5. Keep page-level layout in media queries; use container queries inside components.

```css
.card-host { container-type: inline-size; }

.card { display: grid; gap: 0.75rem; }

@container (width > 40rem) {
  .card { grid-template-columns: 12rem 1fr; align-items: start; }
}
```

**Check.** Render the same component in a narrow sidebar and a wide main area.
It must adapt without a viewport resize or a variant prop.

**Source.** https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries

---

## 11. Interaction states

**What it is.** Every interactive element is a state machine:
default, hover, focus, focus-visible, active/pressed, selected/checked, disabled,
invalid, loading. Pseudo-classes (`:hover`, `:active`, `:focus-within`,
`:disabled`, `:checked`, `:invalid`) expose those states to CSS.

**Why it matters.** Missing states make controls feel dead or ambiguous. Users cannot
tell whether a click registered, whether an item is selected, or whether a control is
available. Inconsistent state styling also hides bugs — a disabled button that looks
enabled will be clicked repeatedly.

**How to apply.**
1. Write the state list for each component before styling it.
2. Style in a stable order; keep hover and focus visibly different.
3. Never remove focus styling when adding hover styling.
4. Make disabled state obviously non-interactive and explain why nearby when the
   reason is not obvious; prefer disabling only when the action is truly unavailable.
5. Show a loading state on submit and prevent double submission.
6. Use `:focus-within` for composite controls (search box, segmented control) and
   `:user-invalid` where supported for post-interaction validation.

```css
.button { background: var(--color-action); }
.button:hover { background: var(--color-action-hover); }
.button:active { transform: translateY(1px); }
.button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.button:disabled { opacity: 0.5; cursor: not-allowed; }
.button[aria-busy="true"] { cursor: progress; }
```

**Check.** Force each state in DevTools and capture a screenshot. Verify hover,
focus, pressed, disabled and loading are distinguishable in grayscale.

**Source.** https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes

---

## 12. Design tokens

**What it is.** A design token is a named decision stored as data — colour, spacing,
type, radius, shadow, duration — instead of a hard-coded value. The Design Tokens
Community Group format uses `$value`, `$type`, groups and `{group.token}` aliases.

**Why it matters.** Hard-coded values drift: five greys, seven blues, inconsistent
focus rings. Tokens create one source of truth that can be themed, audited and
translated to CSS variables, Tailwind, iOS or Android. They also make accessibility
measurable at the decision level (contrast pairs, target sizes).

**How to apply.**
1. Inventory repeated values; name by **role**, not appearance (`action`, not `blue`).
2. Keep a primitive layer (`blue-600`) and a semantic layer (`action`, `danger`,
   `surface`) that aliases it.
3. Store tokens in one JSON file; generate CSS variables/platform outputs.
4. Reference tokens in components; ban raw hex/px in review for themed properties.
5. Version breaking token changes; deprecate aliases instead of renaming silently.

```json
{
  "color": {
    "blue-600": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.04, 0.37, 1] }
    },
    "action": { "$type": "color", "$value": "{color.blue-600}" }
  },
  "space": {
    "md": { "$type": "dimension", "$value": { "value": 16, "unit": "px" } }
  }
}
```

```css
:root { --color-action: #0b5fff; --space-md: 16px; }
.button { background: var(--color-action); padding: var(--space-md); }
```

**Check.** Change one primitive and confirm every consumer updates; grep for raw
values in themed components.

**Source.** https://tr.designtokens.org/format/

---

## 13. Response-time budgets

**What it is.** Human perception sets three practical thresholds: **0.1 s** feels
instant, **1.0 s** keeps the flow of thought, **10 s** is the limit for holding
attention. Beyond that, users need progress, an estimate and the ability to do
something else.

**Why it matters.** Feedback that arrives after the user has mentally moved on feels
broken even when it is technically correct. Matching the feedback type to the delay
prevents both flicker (spinners for 50 ms) and silence (nothing for 5 s).

**How to apply.**
1. Measure the real path (network + server + render), not just the handler.
2. `< 100 ms`: render immediately, no spinner.
3. `100 ms–1 s`: optimistic UI or a subtle inline busy state; keep layout stable.
4. `1–10 s`: show a determinate progress indicator when possible, with a label.
5. `> 10 s`: show progress, allow cancel/background, and notify on completion.
6. Debounce rapid actions; keep the button busy until the request settles.

**Check.** Throttle the network to slow 3G and measure time to first feedback and
time to completion. Confirm the UI never looks idle while work is pending.

**Source.** https://www.nngroup.com/articles/response-times-3-important-limits/

---

## 14. Skeleton and loading states

**What it is.** A skeleton screen is a wireframe-like placeholder that mimics the
layout of content while a **full page** loads. It is a perceived-performance tool,
not a universal spinner replacement; partial updates usually need inline busy
indicators instead.

**Why it matters.** A blank screen gives no information and feels slower than the
same wait with structure. A skeleton sets expectations about what is coming and
reduces layout shift — but only if it matches the final layout. A fake skeleton that
does not resemble the result is just a spinner in costume.

**How to apply.**
1. Use skeletons for first paint of a page or large region; use spinners/progress
   bars for actions and process progress.
2. Match the real grid, block sizes and text line count to avoid a jump when data
   arrives.
3. Reserve space with `min-height`/aspect ratio; avoid cumulative layout shift.
4. Animate subtly (opacity/pulse), respect `prefers-reduced-motion`, and mark the
   placeholder `aria-hidden="true"`.
5. Announce loading once with a live region; do not let the skeleton itself be read.
6. Cap the skeleton: after a timeout, show a retry/error state instead of an
   infinite shimmer.

```html
<section aria-busy="true" aria-describedby="loading-msg">
  <p id="loading-msg" role="status">Loading invoices…</p>
  <div class="skeleton" aria-hidden="true"></div>
</section>
```

**Check.** Compare skeleton and loaded layout screenshots; measure layout shift;
confirm the loading message is announced once.

**Source.** https://www.nngroup.com/articles/skeleton-screens/

---

## 15. Empty states

**What it is.** An empty state is the designed response to "there is nothing here".
NN/g groups the job into three guidelines: communicate system status, provide
learning cues, and provide direct pathways to key tasks.

**Why it matters.** An unexplained blank panel is ambiguous: is it loading, broken,
filtered to nothing, or genuinely empty? Empty states are also a cheap onboarding
surface — they can teach the feature and offer the first action.

**How to apply.**
1. Distinguish the causes: first-use, no results after search/filter, cleared inbox,
   permission denied, error. Each needs different copy and actions.
2. State the status in plain language: "No invoices for this date range."
3. Offer the next step: clear filters, create the first item, import data, contact
   an admin. One primary action, not a wall of links.
4. Use a simple illustration only if it clarifies; never replace the message with it.
5. Keep the layout stable so the empty state does not look like a broken table.

```html
<div class="empty-state">
  <h2>No invoices yet</h2>
  <p>Invoices you create will appear here.</p>
  <button type="button">Create your first invoice</button>
</div>
```

**Check.** Trigger every empty variant (first-use, filtered, permission, error) and
confirm the copy names the cause and gives a working next action.

**Source.** https://www.nngroup.com/articles/empty-state-interface-design/

---

## 16. Error messages

**What it is.** An error message is a recovery interface. NN/g frames the work in
three groups: **visibility** (noticeable and recognisable), **communication**
(what happened, in the user's language) and **efficiency** (help the user fix it
without starting over).

**Why it matters.** Errors are inevitable; dead ends are a choice. A vague "Something
went wrong" forces support tickets. A specific, well-placed message with a fix
preserves trust and completion rate.

**How to apply.**
1. Put the message where the failure happened, close to the affected control or
   action.
2. Say what happened and what to do next; avoid codes as the only explanation.
3. Use plain language, no blame ("We couldn't save…", not "You entered invalid data").
4. Preserve user input and offer retry where the operation is safe to repeat.
5. Distinguish validation errors (fix the field) from system errors (retry/support).
6. For destructive or irreversible actions, explain the consequence before the click,
   not only after failure.
7. Include a support reference (request ID) for server errors, without leaking secrets.

```html
<div role="alert" class="error">
  <strong>We couldn't save your changes.</strong>
  <p>The connection dropped. Your draft is still here.</p>
  <button type="button">Try again</button>
</div>
```

**Check.** Simulate 4xx, 5xx, timeout and offline. Confirm the message is specific,
the input survives, and retry works.

**Source.** https://www.nngroup.com/articles/error-message-guidelines/

---

## 17. Journey mapping and user-path analysis

**What it is.** A journey map is a structured view of one actor pursuing one
scenario over time. NN/g names five key elements: **actor**, **scenario +
expectations**, **journey phases**, **actions/mindsets/emotions**, and
**opportunities**.

**Why it matters.** UI defects cluster at transitions: after submit, between steps,
after an error, on return visits. Component-level review cannot see those seams.
Mapping the path exposes where users wait, backtrack, lose context or abandon.

**How to apply.**
1. Pick one actor and one scenario per map; do not average several personas.
2. Walk the real product (or prototype) and log each step, decision, wait and failure.
3. Mark the emotional low points and the information the user needs at each step.
4. Attach evidence: analytics funnel, session recordings, support tickets, usability
   test clips. A map without data is fiction.
5. Convert each low point into an opportunity with an owner and a measurable outcome.
6. In code, trace the same path end to end: route → data fetch → loading → success →
   error → empty → return. Fix the seam, not only the screen.

**Check.** For the top task, list every state the user can hit. Confirm each has a
designed screen and a way forward.

**Source.** https://www.nngroup.com/articles/journey-mapping-101/

---

## 18. Reduced motion

**What it is.** `prefers-reduced-motion: reduce` is a user preference indicating that
motion should be minimised. It is commonly enabled by people with vestibular
disorders, for whom parallax, zoom and large sliding animations can cause dizziness
or nausea.

**Why it matters.** Motion is not decoration for everyone. An animation that makes a
landing page feel premium can make the product unusable for a subset of users. The
fix is usually a few lines of CSS, not a second design.

**How to apply.**
1. Treat motion as optional enhancement; the interface must work with zero animation.
2. Remove or shorten large transforms, parallax, auto-playing carousels and scroll
   hijacking under `reduce`.
3. Keep essential state changes perceptible: replace movement with an instant
   opacity change or a static highlight.
4. Do not disable focus indicators or loading feedback along with the animation.
5. Test both preferences; never ship only the animated path.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Check.** Toggle the OS reduced-motion setting, reload, and complete the primary
task. No essential information may depend on motion.

**Source.** https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

---

## 19. Regex for repetitive UI edits

**What it is.** A regular expression is a pattern for matching text. For UI work it
is a **bulk-edit tool**: rename a prop, rewrite an import, normalise a class string,
find a deprecated attribute — when the change is text-shaped and the pattern is
regular.

**Why it matters.** Large UI codebases contain thousands of near-identical lines.
Manual editing is slow and inconsistent; a careless global replace is fast and
catastrophic. A precise, reviewed regex with a dry run is the middle path.

**How to apply.**
1. Define the exact shape to change and the shape to leave alone; write both as
   examples before writing the pattern.
2. Use literal anchors and escaped punctuation; prefer specific tags/attributes over
   broad `.*`.
3. Capture only what you need with groups; use `$1`/`\1` in the replacement.
4. Run a **count-only** pass first (`grep -P`/ripgrep), inspect matches, then apply.
5. Work on a clean git tree; review the full diff; run typecheck/tests after.
6. Never regex-parse nested HTML/JSX/JSON as if it were a regular language. If the
   pattern needs balanced brackets, switch to an AST codemod (#20).

```bash
# inventory first: how many matches, and where?
rg -n --pcre2 'className="([a-z-]+)"' src/

# apply only after the inventory looks right
rg -l --pcre2 'className="([a-z-]+)"' src/ \
  | xargs perl -pi -e 's/className="([a-z-]+)"/className={cn("$1")}/g'
```

```js
// JS replace with a capture group, applied to one known string shape
html.replace(/<img\s+([^>]*?)alt=""/g, '<img $1alt="Decorative image"');
```

**Check.** Match count before/after, zero unintended files in the diff, tests and
typecheck green. If the count is surprising, stop and inspect.

**Source.** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions

---

## 20. AST codemods for UI refactors

**What it is.** An AST codemod parses source into a syntax tree, finds nodes by
structure, and rewrites them. Tools such as **ast-grep** (`sg`) and **jscodeshift**
apply structural search/replace across thousands of files without regex fragility.

**Why it matters.** UI refactors are tree-shaped: replace a component, rename a prop,
migrate an API, add an attribute to every `<Button>`. Regex breaks on formatting,
nesting and strings. AST tools match code by syntax and preserve formatting, making
large migrations reviewable and repeatable.

**How to apply.**
1. Start from a clean git tree and a green test baseline.
2. Write one before/after example and encode it as a pattern with metavariables.
3. Run the pattern in **search-only** mode; inspect every match and false positive.
4. Apply the rewrite, then run formatter, typecheck, tests and a visual smoke test.
5. Commit the codemod script with the change so the migration is reproducible.
6. For complex transforms (conditional logic, imports, types), use a jscodeshift
   transform with tests rather than a chain of patterns.

```bash
# ast-grep: structural search first, then rewrite
sg -p '$A && $A()' -r '$A?.()' src/
sg -p 'className="$A"' -r 'className={cn("$A")}' src/
```

```js
// jscodeshift transform shape
module.exports = function transform(fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.JSXAttribute, { name: { name: "className" } })
    .forEach((p) => { /* rewrite deliberately */ })
    .toSource();
};
```

**Check.** Codemod diff is limited to intended files; tests pass; the app renders
the same screens. Re-run the search pattern and confirm zero remaining old shapes.

**Source.** https://ast-grep.github.io/

---

## Sources

All URLs below returned HTTP 200 when fetched on 2026-10-21 and are the basis for
the corresponding skill.

1. W3C — *Web Content Accessibility Guidelines (WCAG) 2.2* — https://www.w3.org/TR/WCAG22/
2. MDN — *Semantics (Glossary)* — https://developer.mozilla.org/en-US/docs/Glossary/Semantics
3. W3C WAI APG — *Developing a Keyboard Interface* — https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
4. W3C WAI — *Understanding SC 2.4.13: Focus Appearance* — https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
5. W3C WAI — *Understanding SC 2.5.8: Target Size (Minimum)* — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
6. WebAIM — *Contrast and Color Accessibility* — https://webaim.org/articles/contrast/
7. MDN — *ARIA live regions* — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions
8. W3C WAI — *Forms Tutorial* — https://www.w3.org/WAI/tutorials/forms/
9. web.dev — *Responsive web design basics* — https://web.dev/articles/responsive-web-design-basics
10. MDN — *CSS container queries* — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries
11. MDN — *Pseudo-classes* — https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes
12. Design Tokens Community Group — *Design Tokens Format Module 2025.10* — https://tr.designtokens.org/format/
13. Nielsen Norman Group — *Response Time Limits* — https://www.nngroup.com/articles/response-times-3-important-limits/
14. Nielsen Norman Group — *Skeleton Screens 101* — https://www.nngroup.com/articles/skeleton-screens/
15. Nielsen Norman Group — *Designing Empty States in Complex Applications: 3 Guidelines* — https://www.nngroup.com/articles/empty-state-interface-design/
16. Nielsen Norman Group — *Error-Message Guidelines* — https://www.nngroup.com/articles/error-message-guidelines/
17. Nielsen Norman Group — *Journey Mapping 101* — https://www.nngroup.com/articles/journey-mapping-101/
18. MDN — *prefers-reduced-motion* — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
19. MDN — *Regular expressions (JavaScript Guide)* — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions
20. ast-grep — *structural search/rewrite* — https://ast-grep.github.io/

Additional pages consulted for cross-checks (not used as a skill's primary source):

- MDN — *:focus-visible* — https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible
- MDN — *Client-side form validation* — https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Form_validation
- W3C WAI — *Understanding SC 1.4.1: Use of Color* — https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- GitHub — *facebook/jscodeshift* — https://github.com/facebook/jscodeshift

### Fetch notes

- `https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_pseudo-classes` returned
  **404**; replaced with `https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes` (200).
- `https://web.dev/articles/forms` returned **404**; form guidance uses the W3C WAI
  Forms Tutorial and MDN client-side validation instead.
