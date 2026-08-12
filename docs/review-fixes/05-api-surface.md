<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — public API semantics and lifecycle
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# API Surface & Lifecycle — `TrendChart` methods and option semantics

> Every finding in this doc is a place where the documented contract and the implemented
> behavior disagree. None of them crash; all of them mislead — which for a library API is
> arguably worse, because the failure is silent and the consumer's mental model is what breaks.
>
> **The headline is `domainX` shadowing, and it produces two separate documented-behavior
> violations from one root cause.** `computeScene` resolves the window as
> `ctx.domainX ?? options.domainX ?? fullRange`. `TrendChart` passes `this.#domainX ?? undefined`
> as `ctx.domainX`. So whenever the internal window is cleared, the _initial_ `options.domainX`
> silently takes over instead of the full range — meaning `resetDomain()` does not reset to the
> full data range as its JSDoc and `API.md` both promise. And in the mirror case, once an
> internal window exists (after any pan, zoom, or `setDomainX`), `setOptions({ domainX })` is
> silently ignored. One fix, two contract violations resolved.
>
> The remaining three are small and independent: `update()` is the only window-moving path that
> doesn't fire `onDomainChange`, `minDomainSpan: 0` is swallowed by a truthiness check, and
> `setOptions` never reconciles the `ResizeObserver` when `width`/`height` change.

## Summary of recommendations

| # | Recommendation                                                                    | Value | Effort | Risk |
| - | --------------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Fix `domainX` shadowing — make `resetDomain()` and `setOptions({domainX})` honest | high  | S      | low  |
| 2 | Fire `onDomainChange` when `update()` clamps the window                           | med   | S      | low  |
| 3 | Accept `minDomainSpan: 0` (use `??`, not truthiness)                              | med   | S      | low  |
| 4 | Reconcile the `ResizeObserver` in `setOptions` when `width`/`height` change       | med   | S      | low  |

---

## Findings & recommendations (detailed)

### 1. `options.domainX` shadows the internal window — `resetDomain()` and `setOptions({domainX})` both lie

- **Problem / observation** — One root cause, two documented-behavior violations:

  **(a) `resetDomain()` does not reset to the full range.** It sets `#domainX = null` and
  re-renders, but `#render()` then passes `ctx.domainX = undefined`, and `computeScene` falls
  back to `options.domainX` before the full range. A chart constructed with a `domainX` option
  therefore snaps back to that _initial_ window, not the full data range — contradicting the
  method's own JSDoc (_"Reset to the full data range"_) and the `API.md` method table
  (_"Zoom out to the full data range"_). It then also fires `onDomainChange` with that wrong
  window.

  **(b) `setOptions({ domainX })` is silently ignored** once an internal window exists. The
  constructor seeds `#domainX` from `options.domainX`, and any pan/zoom/`setDomainX` sets it
  too; `setOptions` merges into `#options` but never touches `#domainX`, so the merged option
  is shadowed. The result is order-dependent: it works on a never-panned chart constructed
  _without_ `domainX`, and is a no-op otherwise. `API.md` documents `setOptions` as "Merge in
  new options and re-render" with no carve-out.

- **Evidence** — [scene.ts:93](../../src/scene.ts#L93) is the fallback chain:

  ```ts
  const domainX = ctx.domainX ?? options.domainX ?? fullX;
  ```

  [trend-chart.ts:266](../../src/trend-chart.ts#L266) (`domainX: this.#domainX ?? undefined`),
  [trend-chart.ts:117](../../src/trend-chart.ts#L117) (constructor seeds `#domainX`),
  [trend-chart.ts:221-225](../../src/trend-chart.ts#L221-L225) (`resetDomain`),
  [trend-chart.ts:194-208](../../src/trend-chart.ts#L194-L208) (`setOptions`).

  Reproduced for (a):

  ```
  computeScene(data /* x = 0..19 */, { domainX: [5, 10] }, { width: 300, height: 150 })
    → scene.domainX [5, 10]      (expected [0, 19] after a reset)
  ```

  > Verifier refinement on (b): `types.ts:98` and `API.md:151` already describe `domainX` as the
  > _"Initial visible x window"_, so the docs are not wholly silent — the residual defect is the
  > inconsistency between that framing and `setOptions`'s unqualified "merge in new options".

- **Proposed change** — Two coordinated edits.

  **In `TrendChart`, make `options.domainX` strictly an initial value.** Since the constructor
  already copies it into `#domainX`, `computeScene` never needs to see it again — so stop
  forwarding it, and have `setOptions` route an incoming `domainX` through the normal path:

  ```ts
  // #render(): pass the option through only as the seed, never as a fallback
  const scene = (this.#scene = computeScene(this.#data, o, {
  	width,
  	height,
  	domainX: this.#domainX ?? dataRangeX(this.#data),   // explicit: null means FULL range
  	…
  }));
  ```

  ```ts
  // setOptions(): honor an explicitly passed domainX
  setOptions(options: Partial<TrendChartOptions>): void {
  	this.#options = { ...this.#options, ...options };
  	if (options.domainX) {
  		this.#domainX = clampDomainX(
  			[...options.domainX], dataRangeX(this.#data), this.#minSpan(),
  		);
  	}
  	…
  }
  ```

  **Leave `computeScene`'s fallback chain as-is.** It is correct for the SSR path, where
  `options.domainX` is the only way to express a window and there is no internal state. The bug
  is entirely in `TrendChart` conflating "no internal window" with "no window specified".

- **Affected files** — `src/trend-chart.ts` (`#render`, `setOptions`); `types.ts` JSDoc for
  `domainX` (say plainly that it seeds the initial window and that `setOptions` re-applies it);
  `API.md` (`setOptions` and `resetDomain` rows); `tests/trend-chart.test.ts` — though note
  these paths are DOM-bound, so see [06-tests-and-tooling.md](./06-tests-and-tooling.md) for
  how to cover them.

- **Effort S / Value high / Risk low** — Behavior change: charts constructed with `domainX`
  will now genuinely zoom all the way out on `resetDomain()`. That is what the docs always
  promised, so it is a fix rather than a break, but it is user-visible.

- **Implementation notes** — Guard against the empty-data case: `dataRangeX([])` returns
  `[0, 1]` ([scale.ts:79](../../src/scale.ts#L79)), which is a sane placeholder. Also make sure
  `resetDomain()` still fires `onDomainChange` **after** the render, so `getDomainX()` inside
  the callback reports the new window — it already does, and the fix must preserve that
  ordering.

---

### 2. `update()` clamps the visible window without firing `onDomainChange`

- **Problem / observation** — `types.ts:120` documents `onDomainChange` as _"Fired whenever the
  visible x window changes (gesture or programmatic)"_. `update()` clamps `#domainX` to the new
  data range and re-renders, but never calls the callback — so a host syncing external UI (a
  zoom slider, a visible-range readout, a paired chart) silently goes stale at exactly the
  moment the window was forcibly moved out from under it. `resetDomain()` and `#applyDomain()`
  both fire it, making `update()` the odd one out.

- **Evidence** — [trend-chart.ts:181-191](../../src/trend-chart.ts#L181-L191) versus
  [trend-chart.ts:224](../../src/trend-chart.ts#L224) and
  [trend-chart.ts:247](../../src/trend-chart.ts#L247).

- **Proposed change** — Fire it only when the clamp actually moved the window:

  ```ts
  update(data: TrendData): void {
  	this.#data = normalizeData(data);
  	const before = this.#domainX;
  	if (before) {
  		this.#domainX = clampDomainX(before, dataRangeX(this.#data), this.#minSpan());
  	}
  	this.#render();
  	const after = this.#domainX;
  	if (before && after && (before[0] !== after[0] || before[1] !== after[1])) {
  		this.#options.onDomainChange?.(after);
  	}
  }
  ```

- **Affected files** — `src/trend-chart.ts`; `API.md` `update()` row.

- **Effort S / Value med / Risk low** — Depends on the no-change-guard decision in
  [03-interaction.md](./03-interaction.md) #1; implement them consistently (both compare
  before/after rather than firing blind).

- **Implementation notes** — In follow-mode (`#domainX === null`) the visible window _does_
  change when new data arrives, since it tracks the full range. Decide whether that should fire
  too — arguably yes for consistency, but it makes `update()` chatty for streaming charts,
  which is the main follow-mode use case. _(Recommendation: fire only for the pinned case, as
  sketched above; document it.)_

---

### 3. `minDomainSpan: 0` is silently replaced by the ~3-point default

- **Problem / observation** — `#minSpan()` uses a truthiness test on a numeric option, so an
  explicit `minDomainSpan: 0` — the natural way to disable the zoom-in limit — falls through to
  the default. `0` is a perfectly valid value one layer down: `clampDomainX` defaults `minSpan`
  to `0` itself, meaning "no limit", and separately guards against zero-width domains — so
  there is no safety rationale for rejecting it. Neither `types.ts:108` nor `API.md:154`
  reserves `0` or hints that it is impossible.

- **Evidence** — [trend-chart.ts:237-241](../../src/trend-chart.ts#L237-L241):

  ```ts
  if (this.#options.minDomainSpan) return this.#options.minDomainSpan; // 0 is falsy
  ```

  versus [scale.ts:61-68](../../src/scale.ts#L61-L68) where `minSpan = 0` is the documented default.

- **Proposed change** —

  ```ts
  #minSpan(): number {
  	const opt = this.#options.minDomainSpan;
  	if (opt !== undefined && Number.isFinite(opt) && opt >= 0) return opt;
  	const [x0, x1] = dataRangeX(this.#data);
  	return this.#data.length > 1 ? ((x1 - x0) / (this.#data.length - 1)) * 3 : 0;
  }
  ```

- **Affected files** — `src/trend-chart.ts`; `types.ts` JSDoc (state that `0` disables the limit).

- **Effort S / Value med / Risk low**

---

### 4. `setOptions` never reconciles the `ResizeObserver` when `width`/`height` change

- **Problem / observation** — The `ResizeObserver` is created **only** in the constructor, and
  only when `width` or `height` is undefined. `setOptions` re-wires gestures when `pan`/`zoom`
  change but never revisits the observer, even though `width`/`height` are ordinary mergeable
  options and `setOptions` is documented as an unqualified merge. Two asymmetric failure modes:

  1. **Fixed → responsive.** Constructed with `{ width, height }`, then
     `setOptions({ width: undefined, height: undefined })`. The spread merge _does_ clear them,
     so `#size()` starts measuring the container — but no observer exists, so the chart renders
     once at the current size and then never tracks the container again.
  2. **Responsive → fixed.** An observer stays attached and keeps firing `#render()` on every
     container resize, doing nothing useful (the explicit size wins) but burning a full
     `computeScene` + DOM patch each time.

- **Evidence** — [trend-chart.ts:171-174](../../src/trend-chart.ts#L171-L174) (constructor-only
  creation) and [trend-chart.ts:194-208](../../src/trend-chart.ts#L194-L208) (`setOptions`).

- **Proposed change** — Extract the decision into one method and call it from both places:

  ```ts
  #syncResizeObserver(): void {
  	const needed = this.#options.width === undefined || this.#options.height === undefined;
  	if (needed && !this.#ro) {
  		this.#ro = new ResizeObserver(() => this.#render());
  		this.#ro.observe(this.#container);
  	} else if (!needed && this.#ro) {
  		this.#ro.disconnect();
  		this.#ro = null;
  	}
  }
  ```

  Call it at the end of the constructor's wiring block and inside `setOptions` whenever
  `"width" in options || "height" in options`. Note the `in` check rather than
  `options.width !== undefined` — clearing an option by passing `undefined` explicitly must
  count as a change.

- **Affected files** — `src/trend-chart.ts`.

- **Effort S / Value med / Risk low**

- **Implementation notes** — While here, consider having `destroy()` null out `#ro` and set a
  `#destroyed` flag (see [03-interaction.md](./03-interaction.md) #6) so a double `destroy()`
  and any post-teardown callback are both safe no-ops. `destroy()` is currently idempotent by
  luck — `disconnect()`, the detach function, and `remove()` all tolerate being called twice —
  but that is worth making explicit rather than relying on.

---

## Open questions / decisions needed

- **Should `update()` fire `onDomainChange` in follow-mode** (finding #2), where the visible
  window genuinely changes on every data append? Firing is more consistent; not firing keeps
  streaming charts quiet. _(Recommendation: don't fire; document it.)_
- **Should `setOptions({ domainX })` clamp, or apply verbatim?** (finding #1). The sketch
  clamps, matching `setDomainX`. Applying verbatim would let a consumer set a window outside the
  data — currently impossible through any public path.
- **Is a `#destroyed` flag worth adding** (finding #4 notes + [03](./03-interaction.md) #6), or
  is "don't use it after destroy" an acceptable contract? Adding it is a few lines and removes a
  class of late-callback bugs.
- **Should `domainX` be removed from `TrendChartOptions` entirely** and become a constructor-only
  third argument? That would make the shadowing bug structurally impossible, but it is a real
  breaking change and it would break `renderToString`, which legitimately needs the option.
  _(Recommendation: no — fix the conflation in `TrendChart` instead, as proposed.)_
