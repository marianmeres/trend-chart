<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — scene composition
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# Scene Composition — `computeScene()` and the overscan contract

> `computeScene()` is the package's load-bearing function: data + options + size in, a fully
> resolved `Scene` out, consumed unchanged by both renderers. The architecture is sound and
> this doc proposes no structural change to it. What it does propose is tightening a handful
> of composition decisions that leak.
>
> **The recurring theme is overscan.** `visibleSlice()` deliberately includes one extra point
> beyond each domain edge so the clipped line stays continuous while panning — a good idea.
> But that padded slice is then reused, unfiltered, for three things it was never meant to
> feed: the hit-test list, the end-dot's "is this really the last point" check, and the
> `"auto"` y-domain fit. Each produces a distinct user-visible bug, and all three have the
> same one-line shape of fix: filter to the domain at the point of use.
>
> The other cluster is **non-finite input**. A single `NaN` y sample puts a literal `NaN` into
> the path `d` attribute, and per the SVG spec rendering of that path stops there — so half
> the line silently vanishes while the axes still look perfectly normal. Gappy data is common;
> this deserves a defined policy rather than an accident.

## Summary of recommendations

| # | Recommendation                                                                 | Value | Effort | Risk |
| - | ------------------------------------------------------------------------------ | ----- | ------ | ---- |
| 1 | Define a policy for non-finite samples instead of emitting `NaN` into the path | high  | M      | med  |
| 2 | Filter the hit-test list to the visible domain (`Scene.visible` contract)      | med   | S      | low  |
| 3 | Require the end dot's point to be inside the domain, not merely last           | med   | S      | low  |
| 4 | Include the end-dot extent in the default padding so it stops being clipped    | med   | S      | low  |
| 5 | Use `overscan: 2` when `smooth` is on (Catmull-Rom needs two neighbors)        | med   | S      | low  |
| 6 | Decide whether `"auto"` y-domain should fit overscan points                    | med   | S      | med  |
| 7 | Keep marker/hover/end-dot colors themable and zone-consistent                  | low   | S      | low  |

---

## Findings & recommendations (detailed)

### 1. A single non-finite sample truncates the rendered line

- **Problem / observation** — `dataRangeY()` is incidentally `NaN`-tolerant (a `NaN` fails both
  `<` and `>` comparisons and is skipped), so the y domain and ticks come out **correct** — which
  is exactly what makes this confusing. But the visible-point mapping passes every slice point
  through `scaleY()` unfiltered, so a `NaN` y lands verbatim in the path string. Per the SVG
  spec, an erroneous path command halts rendering of that path from that segment onward: the
  chart shows a line that just stops, with normal-looking axes and no error. Missing/gappy data
  is a common shape (sensor dropouts, sparse time series), so this is reachable by ordinary use.

- **Evidence** — [scene.ts:123-129](../../src/scene.ts#L123-L129) maps the slice unconditionally;
  [scale.ts:84-93](../../src/scale.ts#L84-L93) shows why the domain survives. Reproduced:

  ```
  data [1, 2, NaN, 4]  →  linePath "M 40 275 L 225.67 186 L 411.33 NaN L 597 8"
  ```

  Everything from the third point on disappears. All-`NaN` data yields
  `domainY [Infinity, -Infinity]` and a path starting `"M 40 NaN …"` — nothing renders.

- **Proposed change** — Pick one of two policies and implement it consistently in
  `computeScene` (both renderers then inherit it for free, which is the architecture working
  as intended):

  **Option A — drop (simplest).** Filter non-finite points out of the slice before mapping.
  The line bridges the gap with a straight segment. One line, no type changes.

  ```ts
  const slice = rawSlice.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  ```

  **Option B — break the path (more correct).** Treat a non-finite sample as a gap and emit a
  new `M` sub-path after it, so the chart shows a genuine discontinuity rather than
  interpolating across missing data. Requires `buildLinePath`/`buildAreaPath` to accept
  `(PxPoint | null)[]` and segment on `null`, plus matching area sub-paths.

  Option A is the Sprint-1 fix; Option B is a candidate follow-up if gap semantics matter to
  real consumers. Guard the all-non-finite case either way, so `dataRangeY` cannot return
  `[Infinity, -Infinity]` — fall back to `[0, 1]` as the empty-data path already does
  ([scale.ts:86](../../src/scale.ts#L86)).

- **Affected files** — `src/scene.ts` (+ `src/path.ts` and `src/types.ts` for Option B);
  `tests/scene.test.ts`; `types.ts` JSDoc on `DataPoint` + `API.md` to state the policy.

- **Effort M / Value high / Risk med** — The risk is behavioral: consumers currently passing
  gappy data see a truncated line, and after the fix they see a bridged one. That is strictly
  better, but it _is_ a visual change, and it must be documented.

- **Implementation notes** — Also guard `index`: `ScenePoint.index` must remain an index into
  the **full** dataset ([types.ts:215](../../src/types.ts#L215)), so filter _after_ computing
  `startIndex + i`, or carry the original index through the filter. Getting this wrong
  silently corrupts `onPointClick`'s `index`.

---

### 2. `Scene.visible` contains out-of-domain overscan points, and hit-testing trusts it

- **Problem / observation** — `visible` is mapped straight from the overscanned slice, so up to
  one point per side lies outside `domainX` with a pixel position beyond the plot rect. That
  contradicts the `Scene` contract, which documents `visible` as _"All visible points
  (hit-testing source, superset of `markers`)"_ ([types.ts:252-253](../../src/types.ts#L252-L253)).
  `TrendChart.#nearest()` does no domain check, and the `pointermove` listener covers the whole
  svg including the y-label gutter — so hovering over the axis labels selects a point that is
  panned out of view, fires `onPointHover`/`onPointClick` for it, and positions the (unclipped)
  hover dot in the gutter where no data is drawn.

- **Evidence** — [scene.ts:123](../../src/scene.ts#L123) (maps the padded slice),
  [path.ts:17-31](../../src/path.ts#L17-L31) (`overscan = 1`),
  [trend-chart.ts:457-472](../../src/trend-chart.ts#L457-L472) (no domain filter),
  [trend-chart.ts:148](../../src/trend-chart.ts#L148) (hover dot appended outside the clipped
  `#gSeries`). Reproduced: data `x = 0..100`, `domainX [40, 60]`, 400px svg →
  `visible` contains `x=39` at `px=22.1` (left of `plot.x = 40`, in the label gutter) and
  `x=61` at `px=414.9` (beyond the svg). With `HOVER_MAX_DISTANCE = 30`, the gutter point is
  reachable by the pointer.

  > **Downgraded from the draft:** the claim that `onPointHover` can report a `pixel.x` outside
  > the svg was verified as _not_ reachable in that repro — the pointer is confined to the svg,
  > so the nearest-point midpoint keeps the reported pixel inside. The gutter-side selection is
  > real; the off-canvas report is not.

- **Proposed change** — Keep the overscan (the line needs it) but make the hit-test list
  honest. Preferred: add a domain filter in `#nearest()`, so `Scene.visible` keeps its
  render-oriented meaning and only the interaction path narrows:

  ```ts
  for (const p of scene.visible) {
  	if (p.x < scene.domainX[0] || p.x > scene.domainX[1]) continue;
  	if (Math.abs(p.px - px) < Math.abs(best.px - px)) best = p;
  }
  ```

  Note `best` is currently seeded with `scene.visible[0]` — which may itself be an overscan
  point — so seed with `null` and handle the empty case. Alternatively add a separate
  `Scene.hitTargets` field and re-point the doc comment; that is cleaner conceptually but adds
  public surface for little gain.

- **Affected files** — `src/trend-chart.ts` (`#nearest`), `src/types.ts` (clarify the
  `visible` JSDoc to say "visible slice including overscan"), `tests/scene.test.ts`.

- **Effort S / Value med / Risk low**

- **Implementation notes** — Whichever way it goes, the `Scene.visible` JSDoc must stop
  claiming these are all visible points; that inaccuracy is what makes the renderer's
  assumption look safe.

---

### 3. The end dot appears when the dataset's last point is panned out of view

- **Problem / observation** — The guard `last.index === points.length - 1` is meant to
  emphasize only the true end of the dataset, and it is documented
  ([types.ts:77-79](../../src/types.ts#L77-L79): _"hidden while that point is panned out of
  view"_) and tested. But because `visible` is overscanned, whenever `domainX[1]` falls between
  the second-to-last and the last x, the last point is present _as the overscan point_ and the
  index check passes. The dot is deliberately rendered unclipped in both renderers
  ([render-string.ts:137](../../src/render-string.ts#L137): _"unclipped so it survives sitting
  on the plot edge"_), so it draws in the right padding or past the svg edge entirely.

- **Evidence** — [scene.ts:226-241](../../src/scene.ts#L226-L241). Reproduced: 20 points
  `x = 0..19`, `domainX [0, 18.5]`, 300px svg → `endDot.px = 303.9` with the plot right edge at
  297 and the svg 300 wide.

- **Proposed change** — Require the point to be inside the domain as well as last:

  ```ts
  if (
  	last && last.index === points.length - 1 &&
  	last.x >= domainX[0] && last.x <= domainX[1]
  ) {
  ```

- **Affected files** — `src/scene.ts`; `tests/scene.test.ts`.

- **Effort S / Value med / Risk low** — The existing test at
  `tests/scene.test.ts:54` uses `domainX [0, 5]` over `x = 0..9`, where overscan reaches only
  `x = 6`, so it passes today and stays green. Add the `[0, 8.5]` case that currently fails.

- **Implementation notes** — Do this together with finding #4 (padding), since both are about
  the end dot's relationship to the plot edge and they share a test.

---

### 4. The default padding ignores the end dot, so an enabled end dot is always clipped

- **Problem / observation** — `edge` sizes the default paddings for the **line stroke only**
  (3px at the default `lineWidth: 2`). The default end dot has `r = max(4, lineWidth * 1.75) = 4`
  plus a hardcoded 2px ring stroke — a 5px outer extent. At the full data range the dot's center
  sits exactly on the plot's right edge (`width - 3`), so it extends 2px past the svg viewport
  and is clipped by the root svg's default `overflow: hidden` (neither renderer sets `overflow`).
  With plain `{ endDot: true }` the dot's right side is **always** shaved off. In sparkline mode
  (axes off, top/bottom padding 3) it is clipped vertically too when the last point is the data
  extreme.

- **Evidence** — [scene.ts:80](../../src/scene.ts#L80) (`edge = Math.ceil(lineWidth/2) + 2`),
  [scene.ts:82-89](../../src/scene.ts#L82-L89) (paddings), ring width hardcoded at
  [trend-chart.ts:357](../../src/trend-chart.ts#L357) and
  [render-string.ts:142](../../src/render-string.ts#L142).

- **Proposed change** — Fold the resolved dot extent into `edge` when `endDot` is enabled:

  ```ts
  const dotCfg = typeof options.endDot === "object" ? options.endDot : {};
  const dotExtent = options.endDot
  	? (dotCfg.r ?? Math.max(4, lineWidth * 1.75)) + 1 // + half the 2px ring
  	: 0;
  const edge = Math.max(Math.ceil(lineWidth / 2) + 2, Math.ceil(dotExtent));
  ```

  This requires resolving the `endDot` config earlier than the current
  [scene.ts:228](../../src/scene.ts#L228); hoist it above the padding block and reuse it in
  both places rather than resolving twice.

- **Affected files** — `src/scene.ts`; `tests/scene.test.ts`.

- **Effort S / Value med / Risk low** — Explicit `padding` overrides still win (they are
  checked with `??` before the default), so consumers who tuned padding are unaffected.

- **Implementation notes** — The ring stroke width is currently a magic `2` duplicated in both
  renderers. Consider promoting it to the `Scene.endDot` object (`ringWidth`) so the padding
  math, the DOM renderer, and the SSR renderer all read one value. That is a small `Scene`
  addition but it removes a three-way duplication.

---

### 5. Smoothing needs two neighbors per side, but overscan is 1 — curves pop at the plot edges

- **Problem / observation** — `computeScene` always uses `visibleSlice`'s default `overscan = 1`,
  but `buildSmooth()` needs **two** neighbors per side: each segment's control points use
  `points[i-1]` and `points[i+2]`, and the slice's first/last point substitutes itself as a
  phantom neighbor (`points[i - 1] ?? points[i]`). The first and last curve segments straddle
  the plot edge and are partially visible, so their visible portion is computed from a phantom
  neighbor instead of the real adjacent point that exists in the full dataset. Whenever a point
  crosses the domain edge during a pan, the slice shifts by one and the visible curve near that
  edge **discontinuously changes shape** — a wobble/pop. It also means SSR edge curvature
  differs from the true full-data curve.

- **Evidence** — [scene.ts:95](../../src/scene.ts#L95) (default overscan),
  [path.ts:74-91](../../src/path.ts#L74-L91) (phantom neighbors). Reproduced at the path level:
  the segment `x=1→2` emits `C 1.33 15, 1.67 76.67, 2 80` under domain `[0.9, 4.9]` versus
  `C 1.17 21.67, 1.67 76.67, 2 80` with the real neighbor present — different control points
  for the same visible segment.

- **Proposed change** — One line in `scene.ts`:

  ```ts
  const { points: slice, startIndex } = visibleSlice(points, domainX, smooth ? 2 : 1);
  ```

  This requires hoisting `const smooth = options.smooth ?? false` above the slice call (it is
  currently resolved at [scene.ts:131](../../src/scene.ts#L131)).

- **Affected files** — `src/scene.ts`; `tests/path.test.ts` or `tests/scene.test.ts`.

- **Effort S / Value med / Risk low** — Interacts with findings #2, #3 and #6, all of which
  filter by domain rather than by slice membership; do those first and this becomes free of
  side effects. Note it slightly widens the `"auto"` y-domain input, which is finding #6's
  subject — another reason to sequence #6 before or with this.

- **Implementation notes** — Verify visually via `tmp/previews.ts` against
  `tmp/screenshots/*` per the AGENTS.md checklist; a smoothing change is exactly the kind of
  thing the preview references exist for.

---

### 6. `"auto"` y-domain fits the overscan slice, so an out-of-view spike flattens the visible series

- **Problem / observation** — For `domainY: "auto"`, `dataRangeY()` runs over the
  `visibleSlice()` result, which includes one overscan point per side. A large value just
  outside the pan window therefore dominates the y scale even though it is clipped away.
  `API.md` and `types.ts` describe `"auto"` as _"fit visible slice"_, which a reader takes to
  mean the visible data.

- **Evidence** — [scene.ts:102](../../src/scene.ts#L102). Reproduced:

  ```
  computeScene([{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:3,y:1000}], {}, {width:300,height:150,domainX:[0,2]})
    → domainY [0, 1000]; all three visible points at py 124.88 in a plot spanning y 8..125
  ```

  A flat line pinned to the bottom of the plot because of a spike that is not drawn.

- **Proposed change** — Three options, in increasing sophistication:

  **A.** Fit strictly in-domain points: `dataRangeY(slice.filter(p => p.x >= domainX[0] && p.x <= domainX[1]))`.
  Standard charting behavior; exit segments simply clip. Simplest and most predictable.

  **B.** Include an overscan point only when the domain edge actually cuts its segment (i.e.
  the edge lies strictly between the neighboring x values), which is the only case where the
  connecting segment is visible.

  **C.** Include the _interpolated_ y value at each domain edge rather than the neighbor's own
  y — correct in the sense that it bounds exactly what is drawn, at the cost of a little math.

  **Recommendation: A**, with C as a considered upgrade. The overscan inclusion does buy
  continuity when an exit segment is partially visible, but the squash cost is much larger than
  the benefit.

  > Verifier note: with the default 2px stroke a sub-pixel sliver of the rising segment's
  > stroke can paint at the clip boundary, so "nothing of it is drawn" is effectively but not
  > mathematically absolute.

- **Affected files** — `src/scene.ts`; `types.ts` + `API.md` wording for `"auto"`;
  `tests/scene.test.ts`.

- **Effort S / Value med / Risk med** — This changes the y scale of existing panned charts. It
  is the most _visible_ behavior change in the whole plan, which is why it sits in the
  decisions sprint rather than a correctness sprint.

- **Implementation notes** — Whichever option is chosen, tighten the `"auto"` wording in
  `types.ts:100-102` and `API.md` so the contract is unambiguous.

---

### 7. In zones mode, markers / hover dot / end dot use a raw, unthemed line color

- **Problem / observation** — `lineColor: strokeGradient ? lineColor : cssColor("line", …)`
  skips the CSS-var wrapper when zones are configured, on the theory that `lineColor` is
  "ignored when zones are set". But both renderers _do_ consume `scene.lineColor` — for
  `points: "all"` markers and for the DOM hover dot — and the `endDot` default color resolves
  to it too. Two consequences in zones mode: (a) `--trend-chart-line` silently stops applying
  to those elements, and (b) they render default blue on a line that is zone-colored red/green.

- **Evidence** — [scene.ts:251](../../src/scene.ts#L251) (the conditional),
  [trend-chart.ts:345](../../src/trend-chart.ts#L345) and
  [render-string.ts:132](../../src/render-string.ts#L132) (markers),
  [trend-chart.ts:486](../../src/trend-chart.ts#L486) (hover dot),
  [scene.ts:236](../../src/scene.ts#L236) (end-dot default). Verified: with zones the field is
  the raw `"#4a9eed"`; without zones it is `var(--trend-chart-line, #4a9eed)`.

- **Proposed change** — Always wrap: `lineColor: cssColor("line", lineColor, cssVars)`. The
  stroke is unaffected because both renderers prefer `url(#strokeGradient)` when present, so
  the wrapper is simply unused there. Then, optionally, color the dots by zone —
  `zoneColorAt(zones, point.y)` already exists and is exported
  ([zones.ts:10](../../src/zones.ts#L10)) — which is the visually correct answer but a bigger
  behavior change.

- **Affected files** — `src/scene.ts`; `types.ts` JSDoc for `lineColor` (it currently says
  "Ignored for stroke when zones are set", which is accurate but understates what else uses it);
  `tests/scene.test.ts`.

- **Effort S / Value low / Risk low** — Lowest-value item retained in this doc; kept because
  the fix is one line and it removes a silent theming hole.

- **Implementation notes** — Do the wrapper fix unconditionally; treat per-zone dot coloring as
  a separate opt-in decision.

---

## Open questions / decisions needed

- **Non-finite policy (finding #1): drop, or break the path into gap segments?** Dropping is a
  one-line Sprint-1 fix; gap segments are the more honest rendering but touch `path.ts`,
  `types.ts` and both renderers. _(Recommendation: drop now, revisit gaps if asked.)_
- **`"auto"` y-domain (finding #6): change the behavior, or document the current one?** This is
  the plan's most visible rendering change. It needs an explicit call before implementation.
- **Should the end-dot ring width become part of `Scene`** (finding #4), or stay a magic `2`
  duplicated across both renderers plus the padding math?
- **Should marker/hover/end-dot colors follow the zone color** in zones mode (finding #7), or
  deliberately stay a single accent color for contrast against the banded background?
