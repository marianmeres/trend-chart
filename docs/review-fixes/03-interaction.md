<!--
GENERATED ANALYSIS — @marianmeres/trend-chart — pan/zoom gestures and pointer interaction
Produced 2026-08-12 by multi-agent review → adversarial verify (per-finding refutation
attempts with empirical `deno eval` repros) → synthesis.
Claims verified against the codebase at commit e06fdea. Planning artifact; no code was changed.
-->

# Interaction — gestures, domain events, pointer handling

> This is the layer a user touches directly, and it is the least tested code in the package:
> `gestures.ts` has **zero test coverage** despite being pure enough to drive headlessly with a
> stub element (see [06-tests-and-tooling.md](./06-tests-and-tooling.md) #1). Every finding
> below is a behavior a person can hit by hand within a minute of using a chart.
>
> **The one to fix first is the missing no-change guard.** `#applyDomain()` stores, re-renders
> and fires `onDomainChange` unconditionally, with no comparison against the current domain.
> That turns the obvious two-chart sync idiom — wire each chart's `onDomainChange` to the
> other's `setDomainX` — into **infinite recursion** the moment their ranges agree. It also
> means dragging an already-fully-zoomed-out chart fires a callback plus a full recompute on
> every single `pointermove` with a byte-identical window.
>
> The second cluster is **wheel handling**. `deltaY > 0 ? in : out` has no zero case, so a
> horizontal two-finger trackpad swipe (which delivers `deltaY === 0`) zooms in on every event
> while `preventDefault()` swallows the intended page scroll. Magnitude is discarded entirely,
> so one inertial flick can traverse the whole zoom range.

## Summary of recommendations

| # | Recommendation                                                                   | Value | Effort | Risk |
| - | -------------------------------------------------------------------------------- | ----- | ------ | ---- |
| 1 | Guard `#applyDomain` (and the gesture callers) against no-change domains         | high  | S      | low  |
| 2 | Normalize wheel input: ignore `deltaY === 0`, scale by magnitude and `deltaMode` | high  | M      | low  |
| 3 | Make zoom-in at `minDomainSpan` a no-op instead of a slow pan                    | med   | S      | low  |
| 4 | Reconcile the hover dot on every re-render                                       | med   | S      | low  |
| 5 | Ignore non-primary mouse buttons for click/hover state                           | med   | S      | low  |
| 6 | Don't let gestures dereference a null scene                                      | med   | S      | low  |
| 7 | Decide a scroll-capture policy (modifier-gated zoom / two-finger pan)            | med   | M      | med  |

---

## Findings & recommendations (detailed)

### 1. No no-change guard: event storms, and infinite recursion in two-chart sync

- **Problem / observation** — `#applyDomain()` unconditionally stores the domain, re-renders,
  and fires `onDomainChange`, with no comparison against the current `scene.domainX`. The
  gesture layer compounds it: both the pan path and `zoomAround()` call `setDomainX` on every
  event with the `clampDomainX` result, without checking it against the domain they just read.
  Three consequences:

  1. **Infinite recursion.** `chartA: { onDomainChange: (d) => chartB.setDomainX(d) }` and the
     mirror on B — the natural sync idiom for stacked charts — recurses to stack overflow once
     the ranges match, because neither side ever stops.
  2. **Event storms.** `types.ts:120` and `API.md` promise the callback fires _"whenever the
     visible x window **changes**"_. At full zoom-out, `clampDomainX` is idempotent, so every
     `pointermove` during a futile drag fires `onDomainChange` with identical values and
     triggers a full `computeScene` + DOM patch. Hosts that wire the callback to a data fetch
     issue a redundant request per event.
  3. **Follow-mode lost silently.** A no-op drag on a full-range chart still sets `#domainX`
     from `null` to a concrete window, so the chart stops following the full range on
     subsequent `update()` calls — a documented behavior
     ([trend-chart.ts:179-180](../../src/trend-chart.ts#L179-L180)) quietly turned off by a
     gesture that visually did nothing.

- **Evidence** — [trend-chart.ts:244-248](../../src/trend-chart.ts#L244-L248):

  ```ts
  #applyDomain(domain: [number, number]): void {
  	this.#domainX = domain;      // no comparison
  	this.#render();
  	this.#options.onDomainChange?.(domain);
  }
  ```

  [gestures.ts:63-67](../../src/gestures.ts#L63-L67) (pan) and
  [gestures.ts:38](../../src/gestures.ts#L38) (zoom) call it unconditionally. Verified:
  `clampDomainX([-5, 95], [0, 100], 3)` returns exactly `[0, 100]`, and `clampDomainX` is
  idempotent — so at full zoom-out a drag produces byte-identical domains indefinitely.

- **Proposed change** — Guard at the sink so every caller benefits, and again in `gestures.ts`
  to avoid the wasted `getScale()`/render round-trip:

  ```ts
  #applyDomain(domain: [number, number]): void {
  	const curr = this.#scene?.domainX;
  	if (curr && curr[0] === domain[0] && curr[1] === domain[1] && this.#domainX) return;
  	this.#domainX = domain;
  	this.#render();
  	this.#options.onDomainChange?.(domain);
  }
  ```

  The `&& this.#domainX` term is deliberate: the _first_ gesture on a follow-mode chart must
  still pin `#domainX` even if the values match, otherwise a legitimate "stop following"
  intent is swallowed. If consequence (3) above is judged undesirable instead — i.e. a no-op
  drag should _not_ end follow mode — drop that term and accept the simpler guard. **This is a
  decision, not a detail** (see Open questions).

- **Affected files** — `src/trend-chart.ts` (`#applyDomain`), `src/gestures.ts`
  (pan + `zoomAround` early-outs); `tests/` (new gestures suite).

- **Effort S / Value high / Risk low**

- **Implementation notes** — Test the recursion case explicitly with two stub charts wired to
  each other; it should settle in one hop. Also assert that N `pointermove` events against a
  data edge produce exactly one `onDomainChange`.

---

### 2. Wheel handling misreads trackpads: `deltaY === 0` zooms in, magnitude is discarded

- **Problem / observation** — Two defects in one expression:

  1. **`deltaY === 0` falls into the zoom-in branch.** A two-finger horizontal swipe on a
     precision trackpad delivers a stream of events with `deltaX !== 0, deltaY === 0`; each one
     zooms in 15%, so a single horizontal swipe slams the chart to `minDomainSpan` — while
     `preventDefault()` swallows the horizontal page scroll the user actually asked for.
     `deltaX` is never consulted, so this cannot be deliberate horizontal handling.
  2. **Magnitude is discarded.** A discrete mouse-wheel click is one event (1.15×), but a
     trackpad flick with inertia emits dozens of small-delta events — 30 events is
     `1.15^30 ≈ 66×`, i.e. one flick crosses the entire zoom range. `deltaMode`
     (pixel/line/page) is also ignored, so a Firefox line-mode wheel and a Chrome pixel-mode
     wheel behave identically despite delivering values two orders of magnitude apart.

- **Evidence** — [gestures.ts:86-90](../../src/gestures.ts#L86-L90):

  ```ts
  const onWheel = (ev: WheelEvent) => {
  	ev.preventDefault();
  	const factor = ev.deltaY > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR; // no zero case, no magnitude
  	zoomAround(invertX(toLocalX(ev), hooks.getScale()), factor);
  };
  ```

- **Proposed change** — Normalize the delta, then derive a continuous factor:

  ```ts
  const LINE_HEIGHT = 16;
  const PAGE_HEIGHT = 800;
  const ZOOM_SENSITIVITY = 0.0015; // tuned so a 100px wheel notch ≈ the old 1.15×

  const onWheel = (ev: WheelEvent) => {
  	// a horizontal-dominant swipe is a scroll, not a zoom — let the page have it
  	if (ev.deltaY === 0 || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
  	ev.preventDefault();
  	const unit = ev.deltaMode === 1
  		? LINE_HEIGHT
  		: ev.deltaMode === 2
  		? PAGE_HEIGHT
  		: 1;
  	const dy = ev.deltaY * unit;
  	const factor = Math.exp(dy * ZOOM_SENSITIVITY);
  	zoomAround(invertX(toLocalX(ev), hooks.getScale()), factor);
  };
  ```

  Note the early `return` now happens **before** `preventDefault()`, which is what restores
  horizontal page scrolling. `Math.exp` gives symmetric in/out steps (`exp(x) · exp(−x) = 1`),
  so zooming in and back out returns exactly to the starting span.

- **Affected files** — `src/gestures.ts`; `tests/` (new gestures suite); `API.md` interaction
  paragraph if the sensitivity story changes materially.

- **Effort M / Value high / Risk low** — Effort is M only because `ZOOM_SENSITIVITY` needs
  hands-on tuning across a mouse wheel and a trackpad; the code change itself is small.

- **Implementation notes** — Consider exposing sensitivity as an option later, but do **not**
  add it in this pass — `AGENTS.md` is explicit about not growing the option surface casually.
  Tune against the `example/` page with both input devices.

---

### 3. Zooming in at the `minDomainSpan` limit pans the window instead of stopping

- **Problem / observation** — `zoomAround()` computes a cursor-anchored domain, then clamps it.
  When the span is already at the zoom-in limit, `clampDomainX` restores the span to `minSpan`
  but keeps the **shifted** `d0` from the unclamped attempt (it clamps the span first, then
  anchors at `domain[0]`). So once the user hits the limit, every further wheel-in event
  _translates_ the window toward the cursor side instead of doing nothing. `API.md` documents
  zoom as "toward the cursor" — meaning the anchored point stays put — and at the limit it
  visibly slides.

- **Evidence** — [gestures.ts:31-39](../../src/gestures.ts#L31-L39) and
  [scale.ts:61-75](../../src/scale.ts#L61-L75) (span clamped at line 69, `d0` anchored at
  70-74). Reproduced with `full = [0, 100]`, `minSpan = 3`, cursor at ratio 0.75:

  ```
  [40, 43] → [40.293, 43.293] → [40.587, 43.587] → …   (~0.29 units drift per event, span constant)
  ```

  No caller compensates: `TrendChart.setDomainX` just re-runs the same `clampDomainX` on the
  already-drifted domain.

- **Proposed change** — Detect the saturated case in `zoomAround` and skip:

  ```ts
  const zoomAround = (centerX: number, factor: number) => {
  	const cfg = hooks.getScale();
  	const [d0, d1] = cfg.domainX;
  	const minSpan = hooks.getMinSpan();
  	const currSpan = d1 - d0;
  	// already at the zoom-in limit and asking to zoom further in → no-op
  	if (factor < 1 && currSpan <= minSpan) return;
  	const next: [number, number] = [
  		centerX - (centerX - d0) * factor,
  		centerX + (d1 - centerX) * factor,
  	];
  	const clamped = clampDomainX(next, hooks.getFullRange(), minSpan);
  	if (clamped[0] === d0 && clamped[1] === d1) return; // pairs with finding #1
  	hooks.setDomainX(clamped);
  };
  ```

- **Affected files** — `src/gestures.ts`; `tests/`.

- **Effort S / Value med / Risk low** — Fixing this also removes one of the sources of the
  redundant-callback storm in finding #1, which is why the two belong in the same task.

- **Implementation notes** — Consider whether `clampDomainX` itself should preserve the
  _center_ rather than `domain[0]` when it has to shrink the span. That is arguably the more
  correct primitive, but it changes an exported, documented, separately-tested function
  ([scale.ts:59-75](../../src/scale.ts#L59-L75)) — prefer fixing the caller in this pass.

---

### 4. The hover dot is never reconciled on re-render and sticks at stale pixels

- **Problem / observation** — `#render()` patches every `Scene`-derived element but never
  touches `#hoverDot` / `#hoverIndex`, which hold coordinates from a _previous_ scene's pixel
  space. After any redraw that moves points — wheel zoom (which fires no `pointermove` for a
  stationary cursor), programmatic `setDomainX`, `update()` with live data, or a resize — the
  visible hover dot stays at the old `(cx, cy)`, detached from the line. The early return in
  `#setHover` compounds it: it compares **index only**, so subsequent pointer moves whose
  nearest point is still the same index skip repositioning entirely, and the dot stays wrong
  until the nearest index changes or the pointer leaves.

- **Evidence** — [trend-chart.ts:259-372](../../src/trend-chart.ts#L259-L372) (`#render` — no
  hover handling) and [trend-chart.ts:475-478](../../src/trend-chart.ts#L475-L478):

  ```ts
  #setHover(hit: PointEvent | null): void {
  	if ((hit?.index ?? null) === this.#hoverIndex) {
  		return;                       // index-only guard: position never refreshed
  	}
  ```

  Verified detachments of 40–100px after a zoom. (Refinement from the verifier: if the cursor
  sits exactly on the zoom anchor, that point barely moves and the offset is small — the large
  detachments occur away from the anchor.)

- **Proposed change** — Reposition from the fresh scene at the end of `#render()`, keyed by the
  retained index:

  ```ts
  // in #render(), after labels
  this.#syncHoverDot();

  #syncHoverDot(): void {
  	const scene = this.#scene;
  	const idx = this.#hoverIndex;
  	const p = idx === null || !scene
  		? undefined
  		: scene.visible.find((v) => v.index === idx);
  	if (!p) {
  		this.#hoverDot.style.display = "none";
  		this.#hoverIndex = null;      // the hovered point left the view
  		return;
  	}
  	this.#hoverDot.style.display = "";
  	this.#hoverDot.setAttribute("cx", String(p.px));
  	this.#hoverDot.setAttribute("cy", String(p.py));
  	this.#hoverDot.setAttribute("r", String(scene.pointRadius + 1.5));
  	…
  }
  ```

  Then have `#setHover` keep its index-change guard for the _callback_ (it exists so
  `onPointHover` only fires on change — that part is correct and should stay) but delegate the
  visual update to `#syncHoverDot()` so both paths share one implementation.

- **Affected files** — `src/trend-chart.ts`.

- **Effort S / Value med / Risk low**

- **Implementation notes** — Careful with `onPointHover` semantics: `#syncHoverDot` must **not**
  fire the callback, or a resize would emit spurious hover events. Only `#setHover` notifies.
  Also decide whether a hovered point scrolling out of view should fire `onPointHover(null)`
  — arguably yes, since the hover genuinely ended.

---

### 5. `onPointClick` fires for middle and right mouse buttons; a right-click can wedge hover

- **Problem / observation** — The interaction `pointerdown` handler sets `#downAt` for **any**
  button, and `pointerup` treats any down+up without movement as a click — so a middle-click
  invokes `onPointClick`. Hosts universally expect click callbacks for the primary button only,
  and `gestures.ts` already guards `ev.button !== 0` for exactly this reason, so the two
  handlers on the same svg disagree with each other. Separately, on platforms where the context
  menu opens on mousedown (macOS), `pointerup` may never arrive, leaving `#downAt` set — which
  suppresses hover highlighting (the `pointermove` handler returns early while `#downAt` is
  truthy) until the pointer leaves and re-enters, or a later click clears it.

- **Evidence** — [trend-chart.ts:420-449](../../src/trend-chart.ts#L420-L449) versus the guard
  at [gestures.ts:42](../../src/gestures.ts#L42):

  ```ts
  if (ev.button !== 0 && ev.pointerType === "mouse") return; // gestures.ts — correct
  ```

  `#wirePointerInteraction` registers no `pointercancel` handler at all.

  > Verifier note: the macOS "context menu on mousedown" premise is well-known platform
  > behavior but was not directly exercisable in this environment; the code-side consequence
  > (a `#downAt` with no cancel path) is verified from the source.

- **Proposed change** — Mirror the gesture guard and add a cancel path:

  ```ts
  svg.addEventListener("pointerdown", (ev) => {
  	if (ev.button !== 0 && ev.pointerType === "mouse") return;
  	this.#downAt = { x: ev.clientX, y: ev.clientY };
  	this.#moved = false;
  });
  svg.addEventListener("pointercancel", () => {
  	this.#downAt = null;
  	this.#moved = false;
  });
  ```

- **Affected files** — `src/trend-chart.ts`.

- **Effort S / Value med / Risk low**

- **Implementation notes** — Track the `pointerId` alongside `#downAt` and ignore `pointerup`
  from a different pointer, so a second touch cannot complete the first one's click.

---

### 6. Gestures dereference `this.#scene!` and throw when the first render bailed

- **Problem / observation** — `getScale` is wired as `() => sceneScale(this.#scene!)`, but
  `#render()` returns early **without assigning `#scene`** when the measured size is falsy,
  while gestures are attached unconditionally _before_ that first render. The svg can still be
  visible and interactive in that state: `clientWidth`/`clientHeight` are spec-defined as 0 for
  inline-layout containers, so appending a chart to a `display: inline` host leaves `#scene`
  null forever while the attribute-less `<svg>` renders at the default replaced-element size
  (300×150) and receives events. The first drag or wheel then throws
  `TypeError: Cannot read properties of null`.

- **Evidence** — [trend-chart.ts:161-168](../../src/trend-chart.ts#L161-L168) (attach before
  render), [trend-chart.ts:176](../../src/trend-chart.ts#L176) (first render),
  [trend-chart.ts:260-261](../../src/trend-chart.ts#L260-L261) (`if (!width || !height) return;`
  — before the `#scene` assignment on line 263), [trend-chart.ts:164](../../src/trend-chart.ts#L164)
  and [:201](../../src/trend-chart.ts#L201) (the non-null assertions).

  `API.md:21-23` warns that a zero-size container "renders nothing" — but a hard crash on
  interaction is a different failure than a blank chart.

  > Verifier refinement: `pointermove` throws only _during a drag_ (bare hover is safe, since
  > `gestures.ts:53` returns early for unknown pointers and the hover path guards `!scene`).
  > The persistent case needs a host whose measured size stays 0 while the svg stays visible.

- **Proposed change** — Make the hook nullable and have the gesture layer no-op without a
  scene, rather than asserting:

  ```ts
  // GestureHooks
  getScale(): ScaleConfig | null;
  ```

  ```ts
  // gestures.ts — every use site
  const cfg = hooks.getScale();
  if (!cfg) return;
  ```

  ```ts
  // trend-chart.ts
  getScale: () => (this.#scene ? sceneScale(this.#scene) : null),
  ```

- **Affected files** — `src/gestures.ts` (`GestureHooks` interface + 3 call sites),
  `src/trend-chart.ts` (both wiring sites); `API.md` if `GestureHooks` is documented in detail.

- **Effort S / Value med / Risk low** — `GestureHooks` is a public exported type, so this is a
  (small) breaking change for anyone who implemented it by hand. Worth noting in the release.

- **Implementation notes** — Consider also having `destroy()` set a `#destroyed` flag that
  `#render` and the hooks check, so a late `ResizeObserver` callback or an in-flight event
  after teardown is a no-op rather than a partial render on a detached tree.

---

### 7. Default-on gestures make the chart a page scroll trap

- **Problem / observation** — With the defaults (`pan: true`, `zoom: true`), the wheel listener
  is registered non-passive and its handler unconditionally `preventDefault()`s, and
  `touch-action: none` is set on the svg. A chart embedded in a normal scrollable page
  therefore captures every scroll gesture passing over it: desktop users cannot wheel past a
  full-width chart, and mobile users cannot touch-scroll the page where the chart is, because a
  single-finger drag is consumed by pan. There is no gating option. The standard mitigation in
  map and chart widgets (Leaflet, Google Maps embeds, the Chart.js zoom plugin) is
  modifier-gated wheel zoom plus two-finger touch pan.

- **Evidence** — [gestures.ts:94](../../src/gestures.ts#L94) (`touch-action: none`),
  [gestures.ts:101-107](../../src/gestures.ts#L101-L107) (listener registration),
  [gestures.ts:87](../../src/gestures.ts#L87) (unconditional `preventDefault`),
  [types.ts:104-107](../../src/types.ts#L104-L107) (both default `true`).

- **Proposed change** — Finding #2's `deltaX`-dominant early return already returns horizontal
  scrolling to the page, which is a meaningful improvement on its own. Beyond that, the options
  are genuinely a product decision:

  **A.** Leave defaults as-is; document the trap prominently in `API.md` and show
  `{ pan: false, zoom: false }` in the README for embedded contexts. Zero code, zero risk.

  **B.** Add a `zoomModifier?: "ctrl" | "meta" | "shift" | null` option (default `null` = current
  behavior). Opt-in, no breaking change, small surface growth.

  **C.** Change the defaults so wheel zoom requires a modifier and touch pan requires two
  fingers, with a "hold ctrl to zoom" hint overlay. Best UX for embedded charts, breaking for
  existing consumers.

  **Recommendation: A now (as part of the docs pass), with B as a considered follow-up.**
  `AGENTS.md` is explicit about not growing the option surface, and the package's stated scope
  is a focused trend chart rather than a general interactive canvas — so C is out unless the
  maintainer disagrees.

- **Affected files** — `README.md`, `API.md` (option A); `src/gestures.ts`, `src/types.ts`,
  `example/index.html` toolbar (option B).

- **Effort M / Value med / Risk med**

- **Implementation notes** — If B is chosen, `touch-action` must be computed accordingly
  (`pan-y` rather than `none` when single-finger pan is disabled), and the four style properties
  set at [gestures.ts:94-99](../../src/gestures.ts#L94-L99) must all still be cleared correctly
  on re-attach — the existing comment there flags this contract.

---

## Open questions / decisions needed

- **Should a no-op drag on a full-range chart end follow-mode?** (finding #1). Currently it
  does, silently. The stricter guard preserves that behavior; the simpler guard removes it.
  This changes what `update()` does afterwards, so it needs an explicit call.
- **Scroll-capture policy** (finding #7): document-only (A), opt-in `zoomModifier` (B), or
  change the defaults (C)? This is the biggest UX decision in the plan.
- **Should a hovered point leaving the view fire `onPointHover(null)`?** (finding #4).
- **`GestureHooks.getScale` returning `ScaleConfig | null`** (finding #6) is a small breaking
  change to a public type. Acceptable pre-1.0, but worth a conscious yes.
- **Wheel `ZOOM_SENSITIVITY` value** (finding #2) needs hands-on tuning on a real trackpad and
  a real mouse before the constant is fixed.
