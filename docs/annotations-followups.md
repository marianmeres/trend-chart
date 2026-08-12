# Context annotations — deliberate omissions & follow-ups

Backlog for the annotation feature shipped in `src/scene.ts:278-318` (compute),
`src/trend-chart.ts:567-607` (interaction) and `src/render-string.ts` (SSR).
Written **2026-08-12**, right after the prototype landed, while the reasoning was
still fresh. Nothing here is scheduled — each item records what was left out, why,
what it would cost, and what should trigger building it.

## The invariant everything below must respect

> **The library says where an annotation is and fires when it is interacted with;
> the host says what it means.**

The chart draws a mark and hands back the annotation it was given (`data`
untouched). It never renders the note. This is what keeps "built-in tooltips" out
of scope (`AGENTS.md` rule 6) while still making the feature useful — and it is the
one thing to check any follow-up against. Popovers, rich text, flip positioning,
dismiss behavior: that is a tooltip library, and accepting one of them piecemeal is
how it gets in.

## Decisions already made (do not re-litigate without a reason)

| Decision                                                                        | Why                                                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Colliding **labels** are dropped, rules never are                               | A crowded window should lose text, not marks. Silent mark loss would misrepresent the data.                                 |
| Annotations outside `domainX` are dropped, not clamped                          | Clamping would put a mark at a time the event did not happen. See "edge indicators" below for the alternative.              |
| 8px hit radius (points use 30px)                                                | Sparse, deliberate targets. A generous radius would make them steal clicks from the series.                                 |
| Annotation click wins over point click — **only if `onAnnotationClick` is set** | Otherwise an unhandled annotation punches an 8px dead zone into the middle of the point hit radius.                         |
| Hovers are independent (both callbacks fire)                                    | They are different questions ("which sample?" / "what happened here?"). Suppressing one to serve the other is a guess.      |
| Rules behind the series, labels in front                                        | Data always wins visually; but a label the line crosses is unreadable, hence the `--trend-chart-annotation-halo` punch-out. |
| Label width is **estimated** (`length * fontSize * 0.6`)                        | `computeScene()` is pure and DOM-less — there are no text metrics in SSR. Deliberately generous. See "label auto-layout".   |

## Follow-ups

### 1. X-range annotations (a band between two x values)

"Recession", "maintenance window", "the strike" — a period, not an instant. The
obvious next ask, and the one most likely to actually arrive.

**Sketch:** `x2?: number` on the existing `Annotation`, emitting a rect
(`plot.y`→`plot.y + plot.height`, `px`→`px2`) instead of a line. `SceneBand` already
exists but is y-sliced (full plot width) — this is its transpose, so it needs its own
scene member rather than a reuse.

**The part that is not trivial:** a range that is _partly_ visible must be **clamped**
to the plot, not dropped — the opposite of the point-annotation rule above, because a
range that starts before the window still applies inside it. That means tracking
whether each edge is real or clipped (otherwise a clamped edge reads as a real event
boundary), and the label wants centering in the _visible_ portion, not the true one.
Hit-testing changes shape too: "pointer inside `[px, px2]`", not "nearest rule".

**Cost:** M. **Trigger:** first real request. Do not pre-build.

### 2. Label auto-layout

Today: greedy left-to-right, drop on collision. In a dense window most labels vanish
(the rules remain). Options, roughly by ambition — stacking into rows, leader lines to
a displaced label, rotation, ellipsis truncation, a "+3 more" cluster badge.

**The blocking design question is not layout, it is measurement.** Every one of those
needs real text widths, and `computeScene()` has none by design. Two honest ways out:

1. Accept the estimate and layout approximately (works; occasionally ugly).
2. Add an optional `measureText?: (text: string) => number` option, which the DOM chart
   can fill from a canvas/SVG measurement and SSR leaves as the estimate. This keeps
   the core pure but makes the DOM and SSR renderers produce **different geometry** —
   which breaks the "one scene, two renderers" parity the architecture is built on, and
   would need to be a conscious tradeoff, not a slip.

**Cost:** M–L, and it is the tarpit of the whole feature. **Trigger:** someone
complains that labels disappear — not before. The current behavior is honest and
predictable, which is worth more than clever.

### 3. Y-axis reference lines / thresholds

The symmetric counterpart: "target: 100", "SLA: 200ms" — a horizontal rule plus label.
Arguably requested more often than x annotations in dashboards.

**Not covered by `zones`:** zones partition the whole y domain into colored bands; a
threshold is a single line that says "here". Different intent, different visual.

**Sketch:** a separate `thresholds?: { y, label?, color?, dash? }[]` option →
horizontal `SceneLine` + `SceneText`. Deliberately **not** a `y` variant of
`Annotation`: one type spanning both axes makes both worse (half the fields
meaningless in each direction, and the hit-testing has nothing in common).

Likely needs **no interaction at all** — a threshold is a constant, not an event, so
there is nothing to click. That makes it much cheaper than it looks.

**Cost:** S. **Trigger:** any dashboard use case.

### 4. Edge indicators for off-screen annotations

Zoomed in, annotations outside the window vanish with no trace that they exist. A small
chevron or count at the plot edge ("← 3") would fix the "am I missing something?"
problem.

Rejected for v1 as clutter, and it adds state the scene does not currently carry
(counts of what was dropped on each side, which is cheap to compute but is new API
surface: `Scene.annotationsOffscreen: { before: number; after: number }`).

**Cost:** S. **Trigger:** users getting lost while zoomed in.

### 5. Accessibility

**Annotations are currently invisible to assistive tech.** They are not in
`ariaLabel`/`<title>`, there is no focusable element, and there is no keyboard path to
`onAnnotationClick`.

Points have exactly the same gap, so this is not a regression — but annotations make it
worse, because an annotation carries _meaning_ a screen-reader user has no other way to
reach, whereas a point is at least implied by the series description.

**Cheap partial win:** append annotation labels to the generated `<title>` text
("… Annotations: warm-up ends, cool-down"). Real fix: focusable `<g tabindex="0">` per
annotation with `role="button"` + keyboard activation, which finally gives the chart a
keyboard story for points too.

**Cost:** S for the title, M for the real fix. **Trigger:** worth doing on its own
merits; the honest framing is that the chart has no keyboard story at all today.

### 6. Clustering at low zoom

Distinct from label layout (#2): with a few hundred events, the _rules themselves_
become a picket fence, and dropping labels does not help. Density-based merging into a
single cluster mark with a count would.

**Cost:** M. **Trigger:** someone feeds it real deploy/event-log data. Likely arrives
together with #4 and #2 as one "dense annotations" project — worth doing as one piece
of work rather than three.

### 7. Per-frame cost with many annotations

`computeScene()` filters **all** annotations on every frame (`src/scene.ts:285`) before
sorting the survivors. That is O(n) per frame over the full array, on every pan/zoom
tick — fine for tens, wasteful for tens of thousands.

`DataPoint.x` is already documented as monotonically non-decreasing; requiring the same
of `annotations` would allow a binary search for the window and make the sort
unnecessary. Cheap to do, and consistent with the existing data contract — but it is a
**breaking tightening** of an option that currently accepts any order (there is a test
asserting input order does not matter), so it belongs in a minor bump with a note.

**Cost:** S. **Trigger:** a real dataset that is slow. Measure before touching it.

### 8. No kill switch for annotation interaction

Interaction is disabled only by not passing the callbacks. There is no
`annotations: { interactive: false }` equivalent to `points: "none"`, and the hover
emphasis (opacity/width bump) paints regardless of whether any callback is registered.

Arguably fine — the emphasis signals "this mark means something" even in a static
context. Noted because it is an undocumented asymmetry with `points`, not because it is
known wrong.

**Cost:** S. **Trigger:** someone wants purely decorative annotations without the hover
affordance.

## Not planned

- **Note rendering of any kind** (popover, card, rich text, positioning). See the
  invariant at the top.
- **Annotations bound to a data point** (`index` instead of `x`). Events happen at
  times, not at samples; snapping would silently move them. `x` is arbitrary on purpose.
- **Per-annotation styling beyond color/dash** (icons, glyphs, images). Each addition is
  another renderer to keep in parity for a diminishing return; a host that needs a glyph
  can draw it from `onAnnotationHover`'s pixel coords.
