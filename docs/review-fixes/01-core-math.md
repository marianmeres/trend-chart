<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — core tick/scale/zone math
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# Core Math — ticks, domains, zone gradients

> This is the pure arithmetic underneath every frame: `ticks.ts` turns a y range into round
> numbers, `scale.ts` maps data to pixels, `zones.ts` turns value bands into gradient stops.
> It is the most testable code in the package and also where the two worst defects live.
>
> **The headline: `niceTicks()` can loop forever.** When the chosen tick step is smaller than
> the floating-point resolution of the domain's own magnitude, `v += step` stops advancing and
> the loop never exits — a frozen browser tab or a hung SSR process, reachable through
> `computeScene()` with default options. Everything else in this doc is visible-but-recoverable
> wrongness; this one is a denial of service.
>
> The second-worst is structural rather than arithmetic: the y domain and the y ticks are
> derived by **two separate `niceDomain()` passes that can disagree**, so the axis bound the
> chart deliberately expanded to is left with no gridline and no label. Fixing it means
> deriving both from one pass — a small change with a visible payoff on ~5% of integer ranges.

## Summary of recommendations

| # | Recommendation                                                              | Value | Effort | Risk |
| - | --------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Make `niceTicks()` terminate — generate ticks by index, not by accumulation | high  | S      | low  |
| 2 | Fix zone gradient when the domain top edge sits exactly on a zone boundary  | high  | S      | low  |
| 3 | Derive y domain and y ticks from a single `niceDomain()` pass               | high  | M      | med  |
| 4 | Normalize inverted domains in `niceDomain`/`niceTicks`                      | med   | S      | low  |
| 5 | Snap and dedupe `evenTicks()` output                                        | med   | S      | low  |

---

## Findings & recommendations (detailed)

### 1. `niceTicks()` never terminates when the step falls below the domain's float resolution

- **Problem / observation** — The tick loop assumes `v += step` always advances `v`. For
  large-magnitude domains with a small relative spread, the "nice" step can be smaller than
  half a ULP of `min`, making `min + step === min`. The loop then pushes the same value
  forever: an unbounded hang plus unbounded array growth. In the browser this freezes the tab;
  in SSR it hangs the request. It is reachable through `computeScene()` with **default**
  options, because `yAxis` and `grid` both default to `true`
  ([scene.ts:72-74](../../src/scene.ts#L72-L74)) and the default path calls
  `niceTicks(domainY, yTickCount)` at [scene.ts:169](../../src/scene.ts#L169).

- **Evidence** — [ticks.ts:42-48](../../src/ticks.ts#L42-L48):

  ```ts
  export function niceTicks(domain: [number, number], targetCount = 5): number[] {
  	const [min, max, step] = niceDomain(domain, targetCount);
  	if (!step) return [min];
  	const out: number[] = [];
  	for (let v = min; v <= max + step / 2; v += step) out.push(snap(v, step)); // ← never advances
  	return out;
  }
  ```

  Reproduced under a 5s SIGALRM watchdog (process killed, exit 142, never returned):

  ```
  niceTicks([1e15, 1e15 + 0.125], 5)
    → niceDomain returns [1e15, 1e15, 0.05]; half-ULP at 1e15 is 0.0625 > step 0.05 → hang

  computeScene([{x:0,y:1.7e18},{x:1,y:1.7e18+300}], {}, {width:600,height:300})
    → ULP at 1.7e18 is 256, half-ULP 128 > nice step 100 → hang
  ```

  The second case is a realistic shape: **nanosecond-epoch timestamps used as y values**, a few
  hundred apart. No doc declares a magnitude limitation.

- **Proposed change** — Generate by index so termination is structural, not arithmetic. This
  also removes additive drift (each tick is computed from `min` rather than from its
  predecessor), which is why `snap()` was needed in the first place:

  ```ts
  export function niceTicks(domain: [number, number], targetCount = 5): number[] {
  	const [min, max, step] = niceDomain(domain, targetCount);
  	if (!step || !Number.isFinite(step)) return [min];
  	const count = Math.floor((max - min) / step + 0.5);
  	if (!Number.isFinite(count) || count < 0) return [min];
  	const out: number[] = [];
  	for (let i = 0; i <= count; i++) out.push(snap(min + i * step, step));
  	return out;
  }
  ```

  Consider additionally capping `count` (e.g. `Math.min(count, 1000)`) as a belt-and-braces
  guard against a pathological `targetCount`.

- **Affected files** — `src/ticks.ts`; regression test in `tests/ticks.test.ts`.

- **Effort S / Value high / Risk low** — Existing assertions must stay green:
  `tests/ticks.test.ts:19` (`niceTicks([0,100],5) === [0,20,40,60,80,100]`) and `:20`
  (`niceTicks([15,65],5) === [10,20,…,70]`). The index form reproduces both.

- **Implementation notes** — Add a test that would hang under the old code, guarded so a
  regression fails fast rather than hanging CI:

  ```ts
  Deno.test("niceTicks terminates when step is below the domain's float resolution", () => {
  	const t = niceTicks([1e15, 1e15 + 0.125], 5);
  	assert(t.length > 0 && t.length < 1000);
  });
  ```

---

### 2. Zone gradient blends the wrong color across the whole plot when the domain top edge equals a zone boundary

- **Problem / observation** — `zoneColorAt()` assigns a value that sits exactly on a boundary
  to the zone **above** it. When `domainY[1]` coincides with an interior boundary, the
  offset-0 stop therefore gets the color of a zone that is entirely invisible — and the
  hard-stop pair that would correct it is skipped by the `o <= 0` guard, because that
  boundary's offset _is_ 0. With no second stop, SVG linearly interpolates the wrong color all
  the way down. The line and the fill become a smooth two-color blend instead of solid zone
  coloring, and they visibly disagree with the background bands, which `zoneBands()` computes
  correctly. This is not exotic: `domainY` defaults to `"full"` when zones are configured
  ([scene.ts:98](../../src/scene.ts#L98)), so a dataset whose maximum lands on a boundary hits it.

- **Evidence** — [zones.ts:10-16](../../src/zones.ts#L10-L16) and
  [zones.ts:41-52](../../src/zones.ts#L41-L52):

  ```ts
  while (i < boundaries.length && boundaries[i] <= value) i++;   // `<=` → boundary joins the zone above
  …
  push(0, zoneColorAt(zones, domainY[1]));                        // ← wrong zone when domainY[1] IS a boundary
  for (let j = boundaries.length - 1; j >= 0; j--) {
  	const o = offsetOf(boundaries[j], domainY);
  	if (o <= 0 || o >= 1) continue;                            // ← skips the corrective pair at o === 0
  ```

  Reproduced:

  ```
  zoneGradientStops({boundaries:[0,50,100], colors:["green","red"]}, [0,50])
    → [{offset:0, color:"red"}, {offset:1, color:"green"}]
  ```

  Every visible value is in the green zone, yet the stroke renders as a full red→green blend.

- **Proposed change** — Resolve the top stop against a value _just inside_ the domain rather
  than exactly on its edge, so a boundary-equal top picks the zone actually occupying the plot:

  ```ts
  /** Zone color of the band immediately below `value` (for the top edge of a domain). */
  function zoneColorBelow(zones: ZoneConfig, value: number): string {
  	const { boundaries, colors } = zones;
  	let i = 0;
  	while (i < boundaries.length && boundaries[i] < value) i++;   // strict `<`
  	return colors[Math.max(0, Math.min(i - 1, colors.length - 1))];
  }
  …
  push(0, zoneColorBelow(zones, domainY[1]));
  ```

  Keep `zoneColorAt()` unchanged — it is exported, documented, and correct for its own
  "which zone does this sample belong to" contract; only the gradient's top stop needs the
  edge-aware variant. Cross-check the result against `zoneBands()`, which already picks the
  right color here.

- **Affected files** — `src/zones.ts`; regression test in `tests/zones.test.ts`.

- **Effort S / Value high / Risk low** — Purely additive; the existing zone tests exercise
  non-boundary domains and stay green.

- **Implementation notes** — Assert the invariant directly: for a domain whose top edge equals
  a boundary, the first and last stop colors must match the colors of the corresponding
  `zoneBands()` entries. That test also covers the symmetric bottom edge (currently correct
  by accident of the same `<=` convention — worth locking down).

---

### 3. Y domain and y ticks come from two disagreeing `niceDomain()` passes, leaving the axis bound unlabeled

- **Problem / observation** — `computeScene` calls `niceDomain(raw, yTickCount)` and uses its
  `[min, max]` as `domainY` — **discarding the step it just computed**. It then calls
  `niceTicks(domainY, yTickCount)`, which re-runs `niceDomain` on the already-expanded domain.
  The expansion can push the span across a 1/2/5 threshold in `niceNum()`, so the second pass
  picks a coarser step whose ceil-expanded bounds overshoot `domainY`; the overshooting ticks
  are then filtered away by `inPlotY`. Net effect: the chart expanded its own axis to a nice
  bound that gets **no gridline and no label**, and the tick count collapses well below the
  requested `yTickCount`.

- **Evidence** — [scene.ts:102-110](../../src/scene.ts#L102-L110) (pass 1, step discarded) and
  [scene.ts:169-170](../../src/scene.ts#L169-L170) (pass 2 + filter):

  ```ts
  const [min, max] = niceDomain(raw, yTickCount);          // step computed, then dropped
  domainY = [Math.min(min, raw[0]), Math.max(max, raw[1])];
  …
  const yTicks = yAxis || grid ? niceTicks(domainY, yTickCount) : [];   // re-derives a DIFFERENT step
  const inPlotY = yTicks.filter((v) => v >= domainY[0] && v <= domainY[1]);
  ```

  Reproduced:

  ```
  computeScene(Array.from({length:22},(_,i)=>i*5), {}, {width:600,height:300})
    → domainY [0, 120]   (pass 1 step 20)
    → yLabels ["0","50","100"]   (pass 2 step 50 — 3 labels for yTickCount 5)
  ```

  The top sixth of the axis (100→120) is blank. Symmetric for negatives: raw `[-105, 0]` →
  domain `[-120, 0]`, labels `[-100, -50, 0]`, bottom bound unlabeled. A sweep of `[0, m]` for
  `m = 1..400` shows 20/400 (~5%) affected — the spans that cross the `f < 3` threshold in
  `niceNum()` after pass-1 expansion.

- **Proposed change** — Derive both from one pass. Add a step-aware entry point in `ticks.ts`
  and have `scene.ts` use the triple it already receives:

  ```ts
  /** Ticks at `step` covering `[min, max]` — the companion to `niceDomain`'s return triple. */
  export function ticksForStep(min: number, max: number, step: number): number[] {
  	if (!step || !Number.isFinite(step)) return [min];
  	const count = Math.floor((max - min) / step + 0.5);
  	const out: number[] = [];
  	for (let i = 0; i <= count; i++) out.push(snap(min + i * step, step));
  	return out;
  }
  ```

  In `scene.ts`, keep the `niceDomain` triple in scope and reuse it:

  ```ts
  let yStep = 0;
  …
  const [min, max, step] = niceDomain(raw, yTickCount);
  domainY = [Math.min(min, raw[0]), Math.max(max, raw[1])];
  yStep = step;
  …
  const yTicks = yAxis || grid
  	? (yStep ? ticksForStep(domainY[0], domainY[1], yStep) : niceTicks(domainY, yTickCount))
  	: [];
  ```

  `niceTicks()` becomes `ticksForStep(...niceDomain(...))`, so finding #1's fix and this one
  share one implementation. The `niceTicks` fallback still covers the explicit-array
  `domainY` case, where there is no pass-1 step.

- **Affected files** — `src/ticks.ts` (new export + `mod.ts` re-export + JSDoc),
  `src/scene.ts` (domainY block + tick derivation), `tests/ticks.test.ts`,
  `tests/scene.test.ts`; `API.md` lower-level-building-blocks table if `ticksForStep` is exported.

- **Effort M / Value high / Risk med** — Highest-risk item in Sprint 1: it changes tick output
  for the ~5% of ranges that currently misbehave, and `tests/scene.test.ts:40`
  (`domainY === [10, 70]`) plus the `tests/ticks.test.ts` assertions must stay green. The
  `domainY` values themselves do **not** change — only which ticks are drawn on them.

- **Implementation notes** — The `Math.min(min, raw[0])` / `Math.max(max, raw[1])` clamps mean
  `domainY` can be _wider_ than pass 1's nice bounds when raw data exceeds them; `ticksForStep`
  should then be called with the nice bounds and the surplus left unlabeled, or extended by
  whole steps. Prefer extending by whole steps so the tick lattice stays uniform. Add a test
  asserting that for `[0, 105]` data every gridline is `step`-spaced and the topmost tick is
  `>= domainY[1] - step`.

  > **Open question (see below):** whether to export `ticksForStep` publicly or keep it module-private.

---

### 4. An inverted explicit `domainY` silently drops every y label and gridline

- **Problem / observation** — `domainY: [10, 0]` is a plausible attempt at an inverted y axis,
  and `scaleY()` handles it correctly — the line renders flipped, as asked. But the tick path
  produces `NaN`: `niceNum()` takes `Math.log10()` of a negative span, `niceDomain`'s `if (!step)`
  guard treats the resulting `NaN` as falsy and returns step 0, so `niceTicks([10, 0])` returns
  just `[10]`, which `inPlotY`'s `v >= 10 && v <= 0` filter then removes entirely. The user gets
  a chart with a correctly flipped line, zero gridlines, zero labels, and no error.

- **Evidence** — [ticks.ts:4-12](../../src/ticks.ts#L4-L12) (`Math.floor(Math.log10(x))` with
  `x < 0` → `NaN`), [ticks.ts:33](../../src/ticks.ts#L33) (`if (!step)` swallows `NaN`),
  [scene.ts:170](../../src/scene.ts#L170) (the filter that empties the result).

- **Proposed change** — Normalize order at the top of `niceDomain()`, since ticks are an
  ordered lattice and orientation is `scaleY`'s business, not the tick generator's:

  ```ts
  let [min, max] = domain;
  if (min > max) [min, max] = [max, min];
  ```

  Then relax `inPlotY` in `scene.ts` to compare against the sorted domain:

  ```ts
  const [yLo, yHi] = domainY[0] <= domainY[1] ? domainY : [domainY[1], domainY[0]];
  const inPlotY = yTicks.filter((v) => v >= yLo && v <= yHi);
  ```

- **Affected files** — `src/ticks.ts`, `src/scene.ts`, `tests/ticks.test.ts`.

- **Effort S / Value med / Risk low** — No behavior change for ascending domains.

- **Implementation notes** — Decide explicitly whether inverted `domainY` is _supported_ or
  merely _non-destructive_. If supported, say so in `types.ts` JSDoc and `API.md`; if not,
  it is still better to render labels than to silently drop them. Either way this fix is
  strictly an improvement.

---

### 5. `evenTicks()` emits floating-point noise and stacked duplicates

- **Problem / observation** — Two defects in one function, both surfacing through the
  documented `xTicks: <number>` option with `formatX` defaulting to `String`:

  1. **Float noise.** `evenTicks` pushes raw `domain[0] + step * i` with no rounding, so
     fractional x domains produce labels like `"0.09999999999999999"`. The y pipeline has
     `snap()` at [ticks.ts:15](../../src/ticks.ts#L15) for exactly this — its doc comment even
     cites the `0.30000000000000004` example — so the x path is an inconsistency, not a policy.
  2. **Stacked duplicates.** With a zero-span domain (a 1-point dataset, or a collapsed
     `domainX`), `step` is 0 and the function returns the same value `count` times, so
     `computeScene` emits N identical `<text>` nodes overdrawn at the plot center — it renders
     as artificially bold text. The default x-tick path is safe only because `sampleTicks()`
     dedupes ([ticks.ts:69](../../src/ticks.ts#L69)).

- **Evidence** — [ticks.ts:51-58](../../src/ticks.ts#L51-L58). Reproduced:

  ```
  computeScene([{x:0,y:1},{x:0.1,y:2},{x:0.2,y:3},{x:0.3,y:4}], {xTicks:4}, {width:600,height:300})
    → xLabels ["0", "0.09999999999999999", "0.19999999999999998", "0.3"]
  ```

- **Proposed change** — Snap against the step and dedupe, mirroring the y path:

  ```ts
  export function evenTicks(domain: [number, number], count: number): number[] {
  	if (count <= 0) return [];
  	const step = (domain[1] - domain[0]) / Math.max(1, count - 1);
  	if (count === 1 || step === 0) return [(domain[0] + domain[1]) / 2];
  	const out: number[] = [];
  	for (let i = 0; i < count; i++) {
  		const v = snap(domain[0] + step * i, step);
  		if (out[out.length - 1] !== v) out.push(v);
  	}
  	return out;
  }
  ```

  Note the zero-span branch now returns the midpoint **once**, matching `scaleX`'s zero-span
  contract ([scale.ts:39](../../src/scale.ts#L39): a zero-span domain maps to the plot center).

- **Affected files** — `src/ticks.ts`, `tests/ticks.test.ts`.

- **Effort S / Value med / Risk low** — `tests/ticks.test.ts:44`
  (`evenTicks([0,10],3) === [0,5,10]`) stays green.

- **Implementation notes** — `snap()` is module-private in `ticks.ts`, so no export churn.
  Be aware `snap` derives its precision from the step magnitude; for timestamp-scale x domains
  (steps in the millions) it is a no-op, which is correct.

---

## Open questions / decisions needed

- **Export `ticksForStep` publicly?** It fits the "lower-level building blocks" table in
  `API.md`, but every public export is a JSR-documented surface with a "no slow types"
  obligation. Keeping it module-private in `ticks.ts` is also viable since `scene.ts` is the
  only consumer. _(Recommendation: keep it private initially; promote it only if a real
  consumer asks.)_
- **Is inverted `domainY` a supported feature or an accident?** Finding #4's fix makes it
  render sensibly either way, but the docs should say which.
- **Should `computeScene` reject non-finite `domainY` / `yTickCount` outright** rather than
  degrading? A thrown error is friendlier than a blank axis, but it is a behavior change for
  anyone currently passing junk and getting a partial chart.
