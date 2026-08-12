<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — test coverage and build tooling
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# Tests & Tooling

> The suite is green (53 tests, `deno lint` and `deno doc --lint src/mod.ts` both clean) and
> the one-file-per-pure-module convention in `AGENTS.md` is followed for `scale`, `path`,
> `ticks`, `zones`, `scene` and `render-string`. This doc is not about coverage percentages —
> it is about the specific gaps that let the bugs in the other five docs ship.
>
> **The biggest gap is `gestures.ts`: zero tests, and it produced three confirmed bugs.** The
> module looks DOM-bound, which is presumably why it was skipped, but it is not — `attachGestures`
> only needs `addEventListener`, `getBoundingClientRect`, `setPointerCapture` and `style` on the
> element it is handed. A plain stub object satisfies all four, and the verifier drove the real
> module that way to confirm the zoom-anchor invariant. Every gesture fix in
> [03-interaction.md](./03-interaction.md) should land with tests, which means building this
> harness first.
>
> The second gap is structural rather than per-module: nothing asserts that the **two renderers
> agree**. Five of the six findings in [04-ssr-and-parity.md](./04-ssr-and-parity.md) are
> instances of one class of drift that a single parity test would have caught as a group.

## Summary of recommendations

| # | Recommendation                                                | Value | Effort | Risk |
| - | ------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Build a headless gesture-test harness and cover `gestures.ts` | high  | M      | low  |
| 2 | Add a DOM↔SSR parity test so renderer drift fails the suite   | high  | M      | low  |
| 3 | Cover the three `domainY` resolution modes in `computeScene`  | med   | S      | low  |
| 4 | Add hang-guard and non-finite-input tests to the pure modules | med   | S      | low  |
| 5 | Pass `[]` (not `[""]`) to `versionizeDeps` in the npm build   | low   | S      | low  |

---

## Findings & recommendations (detailed)

### 1. `gestures.ts` has zero test coverage although it is headless-testable

- **Problem / observation** — All interaction math lives in `gestures.ts` and no test exercises
  any of it: the pan pixel-delta → domain-shift conversion (sign and plot-width scaling), the
  wheel zoom direction, the zoom-toward-cursor invariant in `zoomAround` (the cursor's data-x
  must stay fixed), the pinch factor derived from the pointer-distance ratio, and the
  composition with `clampDomainX(fullRange, minSpan)`. A sign flip or an anchoring regression
  ships silently. The manual-testing carve-out in `tests/trend-chart.test.ts` covers only the
  DOM-bound `TrendChart` class, and `AGENTS.md`'s one-file-per-pure-module convention leaves
  this module orphaned because it _looks_ DOM-bound.

- **Evidence** — [gestures.ts:24](../../src/gestures.ts#L24) (`attachGestures`); no
  `tests/gestures.test.ts` exists. The module's entire DOM surface is four members:
  `addEventListener` / `removeEventListener`, `getBoundingClientRect`,
  `setPointerCapture` / `hasPointerCapture` / `releasePointerCapture`, and `style`.

  The verifier drove the real module with a plain stub in `deno eval` and confirmed the
  invariant holds today: wheel `{deltaY:-1, clientX:50}` on domain `[0,100]` produced
  `[6.52, 93.48]` — cursor data-x 50 stays the midpoint.

- **Proposed change** — Add `tests/gestures.test.ts` with a small element stub:

  ```ts
  function stubEl(width = 400) {
  	const listeners = new Map<string, ((ev: any) => void)[]>();
  	return {
  		style: {} as Record<string, string> & {
  			setProperty(k: string, v: string): void;
  		},
  		addEventListener: (t: string, fn: (ev: any) => void) =>
  			listeners.set(t, [...(listeners.get(t) ?? []), fn]),
  		removeEventListener: (t: string, fn: (ev: any) => void) =>
  			listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)),
  		getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 200 }),
  		setPointerCapture: () => {},
  		hasPointerCapture: () => true,
  		releasePointerCapture: () => {},
  		dispatch: (t: string, ev: Record<string, unknown>) =>
  			listeners.get(t)?.forEach((fn) => fn({ preventDefault() {}, ...ev })),
  		count: (t: string) => listeners.get(t)?.length ?? 0,
  	};
  }
  ```

  `style` needs a `setProperty` stub because [gestures.ts:99](../../src/gestures.ts#L99) calls
  it. Cast the stub through `as unknown as SVGSVGElement` at the `attachGestures` call.

  Cases worth locking down, each of which corresponds to a confirmed bug or an invariant a fix
  must preserve:

  | Case             | Assertion                                                                                 |
  | ---------------- | ----------------------------------------------------------------------------------------- |
  | Zoom anchor      | cursor data-x is unchanged after wheel in **and** out                                     |
  | Wheel symmetry   | in-then-out returns to the original span (needs `Math.exp`, [03](./03-interaction.md) #2) |
  | Horizontal swipe | `deltaY === 0, deltaX !== 0` → no `setDomainX`, no `preventDefault`                       |
  | Pan direction    | dragging right moves the window left (earlier data)                                       |
  | Pan scaling      | a half-plot-width drag shifts by half the domain span                                     |
  | Edge saturation  | N pan events against a data edge → exactly one `setDomainX`                               |
  | Zoom-in limit    | at `minSpan`, further zoom-in is a no-op (no drift)                                       |
  | Pinch            | distance ratio maps to the inverse span ratio, anchored at the midpoint                   |
  | Detach           | `detach()` removes every listener it added (`count(t) === 0` for all four)                |
  | Null scale       | `getScale()` returning `null` never throws ([03](./03-interaction.md) #6)                 |

- **Affected files** — new `tests/gestures.test.ts`; possibly a shared `tests/_stub.ts` if the
  stub is reused.

- **Effort M / Value high / Risk low** — Build this **before** the Sprint-2 gesture fixes, so
  each fix lands with a failing-then-passing test rather than a hand check.

---

### 2. Nothing asserts that the two renderers agree

- **Problem / observation** — `AGENTS.md` states the rule plainly — _"New visual features go:
  compute in `scene.ts` → render in BOTH consumers"_ — but nothing enforces it. Five of the six
  findings in [04-ssr-and-parity.md](./04-ssr-and-parity.md) are the same failure mode: a
  renderer-visible detail implemented in one consumer and not the other (`class`, marker
  structure, font var, offset precision, `display:block`). They were found by reading both
  files side by side; a test should find the next one.

- **Evidence** — `tests/render-string.test.ts` asserts SSR output in isolation;
  `tests/trend-chart.test.ts` contains only 2 tests (public exports, and an end-to-end
  `renderToString` smoke test) because the class needs a DOM.

- **Proposed change** — Two complementary layers:

  **A. A structural parity test (no DOM needed).** Compute one deliberately rich `Scene`
  (zones + bands + labels + markers + endDot + grid + ariaLabel + custom class), serialize it,
  and assert the _inventory_: which classes appear, how many of each element, and that every
  documented class name from `API.md:294-296` is present. This catches "SSR forgot X" without
  needing to diff attribute-by-attribute against a live DOM.

  **B. A golden-snapshot test.** Assert the full SSR string for a fixed scene against a stored
  snapshot, so any markup change is a deliberate, reviewed diff. Cheap to maintain with
  `deno test --update` style regeneration, and it makes the offset-precision class of bug
  (finding [04](./04-ssr-and-parity.md) #5) visible in review.

  A true DOM-vs-string diff would need a DOM implementation (`deno-dom` or similar), which
  conflicts with the zero-runtime-dependency stance — but note that a **dev**-only test
  dependency does not violate it, since `deno.json` `imports` already carries `@std/assert`
  and friends for tests only. Worth a conscious decision (see Open questions).

- **Affected files** — new `tests/parity.test.ts`; possibly `tests/__snapshots__/`.

- **Effort M / Value high / Risk low**

---

### 3. The three `domainY` resolution modes are untested

- **Problem / observation** — The `domainY` block has three documented modes but only implicit
  coverage: an explicit `[min, max]` pass-through is asserted by no test; `"full"` is hit only
  incidentally through the zones-default test, which never asserts the resulting `domainY`; and
  the load-bearing `"auto"` behavior — the y domain re-fitting as you pan — is unasserted,
  since the pan test checks only `domainX` and `visible`. This block is the visual core of
  pan/zoom and [01-core-math.md](./01-core-math.md) #3 is about to rewrite the code immediately
  next to it.

- **Evidence** — [scene.ts:97-111](../../src/scene.ts#L97-L111); `tests/scene.test.ts:40`
  asserts `domainY` only for the unpanned default path; `tests/scene.test.ts:85` is the pan test.

  All three modes were verified to behave correctly today (`"auto"` refits `[0,100]` → `[0,12]`
  when panned to `domainX [0,10]`; `"full"` keeps `[0,100]` while panned; explicit `[0,200]`
  passes through) — so this is purely regression risk, not a live defect.

  > Verifier refinements: [scene.ts:108](../../src/scene.ts#L108) _is_ executed by the existing
  > sparkline test — what is unexercised are its `|| Math.abs(raw[0]) * 0.02 || 0.5` fallback
  > arms, since no test uses flat axis-less data. And the unpanned `"auto"` default path _is_
  > explicitly asserted at `tests/scene.test.ts:40`.

- **Proposed change** — Add to `tests/scene.test.ts`: explicit array returned verbatim;
  `"auto"` `domainY` shrinks when `domainX` narrows; `"full"` does not; zones default to
  `"full"` (assert the value, not just the presence of zones); flat axis-less data yields a
  non-degenerate domain (covering both fallback arms: all-zero data and all-nonzero-flat data).

- **Affected files** — `tests/scene.test.ts`.

- **Effort S / Value med / Risk low**

---

### 4. The pure modules lack hang-guard and non-finite-input tests

- **Problem / observation** — The two worst defects in this review — the `niceTicks` infinite
  loop and the `NaN`-in-path truncation — are both "hostile input to a pure function", and the
  existing tests only ever feed well-formed input. The `zero-span domain is padded, not crashed`
  test at `tests/ticks.test.ts:32` shows the instinct is already there; it just was not extended
  to magnitude extremes or non-finite values.

- **Evidence** — `tests/ticks.test.ts` and `tests/scale.test.ts` exercise only finite,
  moderate-magnitude, well-ordered input.

- **Proposed change** — A small hostile-input block per pure module:

  - `ticks`: huge-magnitude domain with a tiny span (must terminate — assert a bounded length,
    so a regression fails instead of hanging CI); inverted domain; `NaN`/`Infinity` bounds;
    `targetCount` of 0, 1, and something absurd.
  - `scale`: `NaN` value into `scaleX`/`scaleY`; zero and negative plot dimensions;
    `clampDomainX` with an inverted or zero-width `full`.
  - `path`: non-finite coordinates; 0, 1 and 2 points; duplicate x values.
  - `zones`: `boundaries.length !== colors.length + 1`; unsorted boundaries; a single zone.

  For the hang guard specifically, assert an upper bound on the returned array length rather
  than wrapping in a timeout — simpler, deterministic, and it fails fast.

- **Affected files** — `tests/ticks.test.ts`, `tests/scale.test.ts`, `tests/path.test.ts`,
  `tests/zones.test.ts`.

- **Effort S / Value med / Risk low** — Several of these will be written anyway as regression
  tests for Sprint 1; this finding is the reminder to do the neighbouring cases at the same
  time, while the context is loaded.

---

### 5. `build-npm.ts` passes `[""]` to `versionizeDeps`

- **Problem / observation** — `dependencies: versionizeDeps([""], denoJson)` yields `[""]`
  (`versionizeDeps` returns unknown names verbatim), and `npmBuild`'s `string[]` path then runs
  `npm install ""` because the array is non-empty. The published artifact is **correct** —
  verified: `.npm-dist/package.json` has `dependencies {}`, sane `exports`/`main`/`types`/`files`,
  and the ESM output imports cleanly under node — but the call deviates from `@marianmeres/npmbuild`'s
  documented usage (real dep names, default `[]`) and from every sibling config in the ecosystem
  (`kv`, `ticker`, `fsm` all pass actual names), and it relies on npm indefinitely tolerating an
  empty spec.

- **Evidence** — [scripts/build-npm.ts:15](../../scripts/build-npm.ts#L15). Running
  `deno task npm:build` logs `--> Executing: npm install` with an empty argument, which the
  current npm treats as a bare install (`up to date, audited 1 package`). Confirmed by importing
  `versionizeDeps` directly: `versionizeDeps([""], denoJson)` returns `[""]`, because the empty
  string has no `@` at index > 0 and no matching `imports` entry.

- **Proposed change** — For a zero-runtime-dependency package, pass `[]` (or omit the field and
  take the default).

- **Affected files** — `scripts/build-npm.ts`.

- **Effort S / Value low / Risk low** — Lowest-value item in the plan; included because it is a
  one-token change and it removes a latent dependency on undocumented npm tolerance.

---

## Open questions / decisions needed

- **Is a dev-only DOM dependency acceptable** (e.g. `deno-dom`) to test `TrendChart` and do a
  true DOM↔SSR diff? `AGENTS.md` forbids new **runtime** dependencies; test-only imports are a
  different category, and `deno.json` already carries test-only imports. But it is the
  maintainer's call, and finding #2's option A avoids the question entirely.
- **Should `tests/gestures.test.ts` use a shared stub** in `tests/_stub.ts`, given that a
  `TrendChart` test harness would want the same thing? Worth deciding before writing two stubs.
- **Snapshot tests: in-repo golden files or inline assertions?** Golden files catch more but add
  a regeneration ritual that a solo maintainer has to remember.
- **Should `AGENTS.md`'s "Before Making Changes" checklist gain a parity line** — "changed a
  renderer? change both, and check `tests/parity.test.ts`"? The convention exists but nothing
  points at it from the checklist.
