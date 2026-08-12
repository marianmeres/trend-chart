<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — SSR renderer and DOM/SSR parity
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# SSR & Parity — `render-string.ts`

> The two-renderer architecture is the package's best idea: one pure `Scene`, one DOM consumer,
> one string consumer. It only pays off if the two consumers actually agree — and today they
> diverge in five documented ways, each small, all of them landing on the same user: someone
> who server-renders a chart and then hydrates it with `TrendChart`.
>
> **One finding here is a security issue, not a parity nit.** `sceneToString()` escapes user
> strings almost everywhere — labels, gradient stop colors, band colors — but three sinks
> interpolate color options **raw** into double-quoted `style` attributes. A `"` breaks out of
> the attribute and `<…>` becomes live markup. Because the escaping is so consistent
> everywhere else, this reads as an oversight rather than a policy, and it is the one item in
> this doc that belongs in Sprint 1.
>
> The remaining five are parity breaks: the `class` option is silently dropped, marker markup
> uses a different (undocumented) class than the DOM renderer, `--trend-chart-font` is dead in
> SSR, gradient offsets lose precision, and the root svg lacks `display: block`. Individually
> cosmetic; together they mean "SSR then hydrate" produces a visible flicker and CSS that
> targets one renderer misses the other.

## Summary of recommendations

| # | Recommendation                                                                    | Value | Effort | Risk |
| - | --------------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Escape every user-controlled string reaching the markup (3 unescaped color sinks) | high  | S      | low  |
| 2 | Honor the documented `class` option in SSR                                        | med   | S      | low  |
| 3 | Match the DOM renderer's marker markup and documented class names                 | med   | S      | low  |
| 4 | Emit `var(--trend-chart-font, …)` in SSR when `cssVars` is on                     | med   | S      | low  |
| 5 | Stop rounding gradient stop offsets to 2 decimals                                 | med   | S      | low  |
| 6 | Add `display: block` to the SSR root svg                                          | low   | S      | low  |

---

## Findings & recommendations (detailed)

### 1. Unescaped color options are interpolated into `style` attributes (markup injection)

- **Problem / observation** — `sceneToString()` routes user strings through `esc()` almost
  everywhere: labels via `textMarkup()`, gradient stop colors via `esc(s.color)`, band colors
  via `esc(b.color)`, `ariaLabel` via `esc()`. But **three sinks interpolate raw**: the line
  stroke, the marker fill, and the end dot's fill and ring. All three trace back to
  user-supplied options (`lineColor`, `endDot.color`, `endDot.ringColor`). Any `"` in those
  values terminates the attribute early and any `<…>` becomes live markup — so the output is
  both malformed SVG for a benign quoted color _and_ an injection vector wherever colors come
  from user-controlled config (a theming UI, a saved dashboard, a URL parameter).

- **Evidence** — [render-string.ts:119-134](../../src/render-string.ts#L119-L134) and
  [render-string.ts:138-144](../../src/render-string.ts#L138-L144):

  Three independent sinks, each interpolating a color straight into a `style` attribute:

  ```text
  line    style="fill:none;stroke:${stroke};…"                      ← scene.lineColor, raw
  marker  style="fill:${scene.lineColor}"                           ← scene.lineColor, raw
  endDot  style="fill:${d.color};stroke:${d.ringColor};…"           ← endDot.color/.ringColor, raw
  ```

  compared with the escaped neighbours at [:37](../../src/render-string.ts#L37) (stops),
  [:83](../../src/render-string.ts#L83) (bands) and [:49](../../src/render-string.ts#L49) (text).

  > Verifier scoping note: the marker sink is reachable only in `points: "all"` mode (markers
  > is `[]` otherwise, [scene.ts:224](../../src/scene.ts#L224)). The line-stroke and end-dot
  > sinks are reachable with default options.

- **Proposed change** — Wrap all three in the existing `esc()`, and — because "remember to
  escape at each site" is exactly the discipline that failed here — funnel color output through
  one helper so future sinks cannot regress:

  ```ts
  /** Escape a resolved color for interpolation into a style attribute. */
  function color(c: string): string {
  	return esc(c);
  }
  ```

  Then use `color(scene.lineColor)`, `color(d.color)`, `color(d.ringColor)` at the three sites.
  Also apply it at [:105](../../src/render-string.ts#L105) (grid stroke) and
  [:29](../../src/render-string.ts#L29) (label fill) — both are currently `cssColor()` output
  built from a literal fallback and are safe **today**, but only because no user string reaches
  them; escaping uniformly removes the reasoning step.

  A stricter alternative — validating colors against an allowlist pattern and rejecting the
  rest — is more defensive but would break legitimate exotic values (`color-mix()`, `lab()`,
  `var(--x, …)` chains). Escaping is the right level here.

- **Affected files** — `src/render-string.ts`; `tests/render-string.test.ts`.

- **Effort S / Value high / Risk low**

- **Implementation notes** — Add a test that renders with
  `lineColor: '"><script>alert(1)</script>'` and asserts the output contains no unescaped `<`
  after the opening `<svg`, plus the equivalent for `endDot.color` / `endDot.ringColor`. Note
  the DOM renderer is **not** affected — it assigns through `el.style.fill`, which is a
  property write, not markup.

---

### 2. SSR silently ignores the documented `class` option

- **Problem / observation** — `sceneToString()` hardcodes `class="trend-chart"` on the root svg
  and never appends `options.class`. The DOM renderer does. `API.md` states both entry points
  "consume the same options", documents `class` as "Extra class name(s) on the root `<svg>`"
  with no DOM-only caveat, and `renderToString`'s JSDoc says only _interactive_ options are
  ignored — `class` is not interactive. Since per-chart CSS-var theming (the documented no-JS
  theming path for `cssVars: true` SSR output) is naturally scoped by a class on the svg, this
  silently breaks a documented styling workflow.

- **Evidence** — [render-string.ts:58-63](../../src/render-string.ts#L58-L63) versus
  [trend-chart.ts:275](../../src/trend-chart.ts#L275):

  ```ts
  svg.setAttribute("class", `trend-chart${o.class ? ` ${o.class}` : ""}`); // DOM — honored
  ```

- **Proposed change** — `options.class` is not part of `Scene`, so pick one:

  **A (preferred).** Add `class?: string` to `Scene`, set it in `computeScene`, and use it in
  both renderers. This keeps `sceneToString(scene)` self-sufficient — which matters, because
  it is a public export that consumers can call with a hand-built `Scene`.

  **B.** Give `sceneToString` an optional second parameter (`sceneToString(scene, { class })`).
  Smaller change, but it splits the scene contract across two arguments and the DOM renderer
  would still read `options.class` directly.

  Option A also resolves the same question for anything else renderer-visible but currently
  options-only.

- **Affected files** — `src/types.ts` (`Scene`), `src/scene.ts`, `src/render-string.ts`,
  `src/trend-chart.ts` (read from the scene for consistency); `tests/render-string.test.ts`.

- **Effort S / Value med / Risk low** — Adding an optional `Scene` field is backward compatible
  for consumers reading a `Scene`, and JSDoc is mandatory on the new member per `AGENTS.md`.

---

### 3. SSR marker markup diverges from the DOM renderer and from the documented class names

- **Problem / observation** — With `points: "all"`, the DOM renderer emits
  `<g class="trend-chart-markers">` containing class-less circles; SSR emits loose sibling
  circles each carrying the **singular**, undocumented class `trend-chart-marker` and no group
  at all. `API.md:294-296` promises stable class names including `trend-chart-markers` — absent
  from SSR output — and never mentions `trend-chart-marker`. Consequence: CSS written as
  `.trend-chart-markers circle { … }` styles the live chart but not the SSR output, and
  `.trend-chart-marker { … }` does the opposite.

- **Evidence** — [render-string.ts:129-134](../../src/render-string.ts#L129-L134) versus
  [trend-chart.ts:143-144](../../src/trend-chart.ts#L143-L144) and
  [trend-chart.ts:339-346](../../src/trend-chart.ts#L339-L346); documented names at
  `API.md:294-296`.

- **Proposed change** — Make SSR match the documented DOM structure:

  ```ts
  if (scene.markers.length) {
  	out.push(`<g class="trend-chart-markers">`);
  	for (const m of scene.markers) {
  		out.push(
  			`<circle cx="${n(m.px)}" cy="${n(m.py)}" r="${scene.pointRadius}" ` +
  				`style="fill:${color(scene.lineColor)}"/>`,
  		);
  	}
  	out.push(`</g>`);
  }
  ```

  The DOM structure is the one the docs promise, so SSR moves to it rather than the reverse.

- **Affected files** — `src/render-string.ts`; `tests/render-string.test.ts`.

- **Effort S / Value med / Risk low** — Anyone currently styling `.trend-chart-marker` in SSR
  output loses that hook, but it was never documented.

- **Implementation notes** — While here, do a full structural diff of the two renderers and
  record the result — this finding is one instance of a class of drift, and a checklist in
  `AGENTS.md` ("new visual features go: compute in scene → render in BOTH consumers") is only
  enforceable if someone has actually diffed them once.

---

### 4. `--trend-chart-font` is dead in SSR even with `cssVars: true`

- **Problem / observation** — The DOM renderer always writes the label font family as
  `var(--trend-chart-font, ui-sans-serif, …)`, including for band labels. SSR's `textStyle()`
  and the band-label style hardcode the `FONT_FAMILY` constant and never consult
  `scene.cssVars`. `API.md`'s styling table lists `--trend-chart-font` among the themable
  custom properties with no DOM-only caveat, and the README presents CSS-var theming as
  opt-in for `renderToString` via `cssVars: true`. So an SSR chart on a themed page honors
  `--trend-chart-line`/`-fill`/`-grid`/`-label`/`-end-dot-ring` but silently renders in the
  wrong font.

- **Evidence** — [render-string.ts:27-30](../../src/render-string.ts#L27-L30) and
  [render-string.ts:89-92](../../src/render-string.ts#L89-L92) versus
  [trend-chart.ts:385](../../src/trend-chart.ts#L385).

- **Proposed change** — Route the font through `cssColor()`'s sibling logic. `cssColor` is
  color-named but is really "wrap in a custom property with a fallback", so either reuse it or
  add a tiny general helper in `scene.ts`:

  ```ts
  /** Wrap a resolved value in a themable CSS custom property reference. */
  export function cssVar(name: string, fallback: string, useVars: boolean): string {
  	return useVars ? `var(--trend-chart-${name}, ${fallback})` : fallback;
  }
  ```

  Then `cssColor` becomes a thin alias (or is replaced outright), and SSR uses
  `cssVar("font", FONT_FAMILY, scene.cssVars)` in both text styles.

- **Affected files** — `src/scene.ts` (helper), `src/render-string.ts` (2 sites);
  `tests/render-string.test.ts`. If `cssColor` is replaced rather than aliased, it is a public
  export — see Open questions.

- **Effort S / Value med / Risk low**

---

### 5. Gradient stop offsets are rounded to 2 decimals, misaligning zone transitions

- **Problem / observation** — `n()` rounds to 2 decimals "to keep the markup compact" and is
  correct for **pixel** values, but it is also applied to gradient stop offsets, which are
  `0..1` fractions of the plot height. Rounding a relative offset to 0.01 introduces up to
  `0.005 × plotHeight` of error — several pixels on a tall chart — so the zone hard-stop color
  transition lands visibly away from the corresponding band rect edge (band `y` coordinates are
  also `n()`-rounded, but as pixels, i.e. 0.005px of error). The DOM renderer uses
  `String(s.offset)` at full precision, so live charts align exactly and SSR does not.

- **Evidence** — [render-string.ts:19-22](../../src/render-string.ts#L19-L22) (`n`),
  [render-string.ts:37](../../src/render-string.ts#L37) (applied to `s.offset`),
  [trend-chart.ts:410](../../src/trend-chart.ts#L410) (full precision in the DOM).

- **Proposed change** — Round offsets on their own scale:

  ```ts
  /** Round a 0..1 fraction — offsets need far more precision than pixel coords. */
  function f(v: number): number {
  	return Math.round(v * 1e5) / 1e5;
  }
  …
  `<stop offset="${f(s.offset)}" …/>`
  ```

  1e-5 of the plot height is sub-pixel for any realistic chart while keeping the markup tidy.

- **Affected files** — `src/render-string.ts`; `tests/render-string.test.ts`.

- **Effort S / Value med / Risk low**

- **Implementation notes** — The natural regression test is a parity assertion: for a zoned
  scene, the offset of each hard-stop pair must map back to the same pixel y (within a
  tolerance) as the corresponding `zoneBands()` rect edge.

---

### 6. The SSR root svg lacks `display: block`

- **Problem / observation** — `TrendChart` sets `svg.style.display = "block"` so the chart has
  no inline baseline gap; `sceneToString` emits no display style, so SSR output embedded in
  HTML renders as an inline element with the usual ~4px baseline whitespace below it and
  different flow behavior. In the SSR-placeholder-then-hydrate pattern, the swap causes a small
  visible layout shift.

- **Evidence** — [trend-chart.ts:123](../../src/trend-chart.ts#L123) versus
  [render-string.ts:58-63](../../src/render-string.ts#L58-L63).

- **Proposed change** — Add `style="display:block"` to the SSR root svg element. (The
  alternative — dropping the inline style from both in favor of a documented stylesheet rule —
  is cleaner but shifts a working default onto every consumer.)

- **Affected files** — `src/render-string.ts`; `tests/render-string.test.ts`.

- **Effort S / Value low / Risk low** — Retained only because it is a one-line change that
  removes a real hydration flicker.

---

## Open questions / decisions needed

- **`Scene.class` (finding #2): add the field, or pass options to `sceneToString`?** Option A
  (a `Scene` field) is recommended, but it grows the public `Scene` type, which is a documented
  surface with JSDoc obligations on every member.
- **Replace or alias `cssColor` (finding #4)?** Verified that `cssColor` is **not** re-exported
  from `mod.ts` (which exposes only `computeScene`, `normalizeData` and `SceneContext` from
  `scene.ts`), so renaming or generalizing it is an internal-only change. Still worth a
  conscious call on whether one `cssVar()` helper replaces it or wraps it.
- **Should SSR and DOM markup be locked down by a shared golden test?** A single test that
  computes one rich `Scene` and asserts a structural equivalence between the two renderers
  would have caught findings #2–#6 as a class. Worth building once — see
  [06-tests-and-tooling.md](./06-tests-and-tooling.md).
- **Is `renderToString`'s `ssrCounter`-based `idPrefix` sufficient** for multiple charts on one
  page? It is per-process, so two charts in one response get distinct ids — but a server that
  renders fragments across processes and composes them could collide. Not currently a verified
  defect; noted as a thing to think about rather than a finding.
