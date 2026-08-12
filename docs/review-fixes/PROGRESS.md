# Implementation Progress — review fixes

Living tracker for acting on [`00-overview-and-roadmap.md`](./00-overview-and-roadmap.md). A
fresh conversation should read this file first, then the relevant `0X-*.md` section.

**Status legend:** ⬜ not started · 🚧 in progress · ⏸️ blocked/awaiting decision · ✅ done · ⏭️ deferred

> Convention: one branch per sprint, one commit per task. Each task resolves its source doc's
> "Open questions" first (record the call in the Decisions log), then implement → test → tick
> here → commit when the owner asks.
>
> **Baseline at plan time (commit `e06fdea`):** 53 tests passing, `deno lint` clean,
> `deno doc --lint src/mod.ts` clean. Every task must leave all three that way.

---

## Sprint 1 — Landmines

Confidently-wrong output: a hang, an injection, and two silently incorrect renders. This is the
only sprint that is urgent.

Branch: `fix/sprint-1-landmines`

| # | Task                                                                                | Source                             | Status | Commit    |
| - | ----------------------------------------------------------------------------------- | ---------------------------------- | ------ | --------- |
| 1 | `niceTicks()` terminates — index-based loop + bounded-length regression test        | [01](./01-core-math.md) #1         | ✅     | `b032e68` |
| 2 | Escape the 3 unescaped color sinks in `sceneToString()` (+ single `color()` helper) | [04](./04-ssr-and-parity.md) #1    | ✅     | `b28182a` |
| 3 | Zone gradient: edge-aware top stop when `domainY[1]` equals a boundary              | [01](./01-core-math.md) #2         | ⬜     | —         |
| 4 | Single-pass tick derivation (`ticksForStep`) so the axis bound gets a label         | [01](./01-core-math.md) #3         | ⬜     | —         |
| 5 | Non-finite sample policy — drop non-finite points, preserve `ScenePoint.index`      | [02](./02-scene-composition.md) #1 | ⬜     | —         |

**Sequencing:** do 1 before 4 (they share `ticksForStep()`). Task 2 is independent and can land
in any order. Tasks 1/3/4/5 touch `ticks.ts`/`zones.ts`/`scene.ts` — one branch, one commit each.

**Decisions needed before starting:** task 4 → export `ticksForStep` publicly or keep it
module-private? Task 5 → drop non-finite points (option A) or break the path into gap segments
(option B)?

---

## Sprint 2 — Interaction & state correctness

The things a user hits by hand. Starts with the test harness, because `gestures.ts` produced
three confirmed bugs with zero coverage and these fixes should land verified.

Branch: `fix/sprint-2-interaction`

| #  | Task                                                                            | Source                                 | Status | Commit |
| -- | ------------------------------------------------------------------------------- | -------------------------------------- | ------ | ------ |
| 6  | Headless gesture-test harness (`tests/gestures.test.ts` + element stub)         | [06](./06-tests-and-tooling.md) #1     | ⬜     | —      |
| 7  | No-change guard in `#applyDomain` + gesture-side early-outs                     | [03](./03-interaction.md) #1           | ⬜     | —      |
| 8  | Wheel normalization: ignore `deltaY === 0`, scale by magnitude + `deltaMode`    | [03](./03-interaction.md) #2           | ⬜     | —      |
| 9  | Zoom-in at `minDomainSpan` becomes a no-op instead of drifting                  | [03](./03-interaction.md) #3           | ⬜     | —      |
| 10 | Fix `domainX` shadowing — `resetDomain()` and `setOptions({domainX})`           | [05](./05-api-surface.md) #1           | ⬜     | —      |
| 11 | Reconcile the hover dot on every re-render (`#syncHoverDot`)                    | [03](./03-interaction.md) #4           | ⬜     | —      |
| 12 | Overscan containment: filter hit-test to the domain + require end dot in-domain | [02](./02-scene-composition.md) #2, #3 | ⬜     | —      |

**Sequencing:** task 6 first — it is the harness tasks 7/8/9 are tested with. Task 9 depends on
task 7's guard to be fully effective.

**Decisions needed before starting:** task 7 → should a no-op drag on a full-range chart still
end follow-mode? Task 11 → should a hovered point leaving the view fire `onPointHover(null)`?

---

## Sprint 3 — Parity & API hygiene

Silent contract violations and renderer drift. No urgency, no risk, high tidiness payoff.

Branch: `fix/sprint-3-parity`

| #  | Task                                                                                             | Source                                 | Status | Commit |
| -- | ------------------------------------------------------------------------------------------------ | -------------------------------------- | ------ | ------ |
| 13 | DOM↔SSR parity test (structural inventory + golden snapshot)                                     | [06](./06-tests-and-tooling.md) #2     | ⬜     | —      |
| 14 | SSR parity bundle: `class`, marker markup, font var, offset precision, `display:block`           | [04](./04-ssr-and-parity.md) #2–#6     | ⬜     | —      |
| 15 | End-dot extent folded into the default padding                                                   | [02](./02-scene-composition.md) #4     | ⬜     | —      |
| 16 | Lifecycle fixes: `update()` fires `onDomainChange`; `minDomainSpan: 0`; ResizeObserver reconcile | [05](./05-api-surface.md) #2–#4        | ⬜     | —      |
| 17 | Pointer hygiene: primary-button guard + `pointercancel`; nullable `getScale()`                   | [03](./03-interaction.md) #5, #6       | ⬜     | —      |
| 18 | `evenTicks()` snap + dedupe; normalize inverted domains in `niceDomain`/`inPlotY`                | [01](./01-core-math.md) #4, #5         | ⬜     | —      |
| 19 | Test coverage: three `domainY` modes + hostile-input cases per pure module                       | [06](./06-tests-and-tooling.md) #3, #4 | ⬜     | —      |
| 20 | Keep marker/hover/end-dot colors themable in zones mode                                          | [02](./02-scene-composition.md) #7     | ⬜     | —      |

**Sequencing:** task 13 before 14 — the parity test defines what task 14 is fixing toward.

**Decisions needed before starting:** task 14 → add `Scene.class` or pass options to
`sceneToString`? Task 17 → `GestureHooks.getScale` returning `ScaleConfig | null` is a small
breaking change to a public type; confirm. Task 20 → wrap only, or color the dots by zone?

---

## Sprint 4 — Decisions & remaining debt

Every item here needs an explicit call from the owner before code is written, including the two
most user-visible behavior changes in the plan. Deliberately last.

Branch: `fix/sprint-4-decisions`

| #  | Task                                                                                        | Source                             | Status | Commit |
| -- | ------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ------ |
| 21 | Scroll-capture policy: document-only (A), opt-in `zoomModifier` (B), or change defaults (C) | [03](./03-interaction.md) #7       | ⏸️     | —      |
| 22 | `"auto"` y-domain: fit strictly in-domain points, or keep the overscan fit and document it  | [02](./02-scene-composition.md) #6 | ⏸️     | —      |
| 23 | `overscan: 2` when `smooth` is on (regenerate `tmp/previews.ts` references first)           | [02](./02-scene-composition.md) #5 | ⬜     | —      |
| 24 | Docs sync pass: `README.md` + `API.md` + `types.ts` JSDoc for every behavior changed above  | —                                  | ⬜     | —      |
| 25 | `build-npm.ts`: pass `[]` instead of `[""]` to `versionizeDeps`                             | [06](./06-tests-and-tooling.md) #5 | ✅     | —      |

**Sequencing:** task 24 last within the sprint — it documents the outcome of 21 and 22. Note
task 24 is a hard gate for any release: `AGENTS.md` requires that a changed option be updated in
all four places (`types.ts` JSDoc, `API.md` table, README, `example/index.html` toolbar).

**Blocked on:** tasks 21 and 22 are ⏸️ by design — do not start either without the owner's call.

---

## Backlog (not scheduled)

| Task                                                            | Source                                    | Status | Note                                                           |
| --------------------------------------------------------------- | ----------------------------------------- | ------ | -------------------------------------------------------------- |
| Non-finite samples as _gap segments_ rather than dropped points | [02](./02-scene-composition.md) #1 opt. B | ⬜     | Follow-up to task 5 if gap semantics matter to a real consumer |
| Dev-only DOM dependency to test `TrendChart` directly           | [06](./06-tests-and-tooling.md) open q.   | ⬜     | Would cover the 6 `trend-chart.ts` findings properly           |
| Per-zone coloring for markers / hover dot / end dot             | [02](./02-scene-composition.md) #7        | ⬜     | Visual improvement beyond task 20's theming fix                |
| Promote the end-dot ring width into `Scene`                     | [02](./02-scene-composition.md) #4 notes  | ⬜     | Removes a three-way duplicated magic `2`                       |
| Re-verify the 7 unverified findings from the original review    | [00](./00-overview-and-roadmap.md)        | ⬜     | Capped out of the verification stage; raw output retained      |

---

## Decisions log

- **2026-08-12** — Plan produced from the multi-agent review (48 agents: 8 dimension reviewers,
  40 adversarial verifiers). 40 findings confirmed, 0 refuted; 33 unique after deduplication.
  Grouped into 4 sprints by importance rather than by file, since the strongest themes
  (overscan leaks, missing change-detection, renderer drift) each span several modules.
- **2026-08-12** — The 7 findings that the verification stage capped out of scope are **not**
  carried into the plan; unverified items would violate the "verified, not vibes" rule. Logged
  in the backlog for optional re-verification instead of being silently dropped.
- **2026-08-12** — Task 1: `niceTicks()` generates by index and caps output at **1000 ticks**
  (`MAX_TICKS`). The cap is a belt-and-braces guard from [01](./01-core-math.md) #1; it only
  engages for absurd `targetCount` values (≥ ~1e4 on a normal domain), where the alternative was
  an OOM-sized array. `ticksForStep` was deliberately **not** extracted yet — that is task 4,
  where the export question gets decided.
- **2026-08-12** — Task 2: the `color()` helper is applied at **every** color sink in
  `sceneToString()`, not only the three unescaped ones — the already-safe sites (gradient
  stops, band fill/label, grid stroke, label fill) go through it too, so "is this sink
  escaped?" is never a per-site judgement call again. Escaping (not allowlist validation)
  is the chosen level: an allowlist would reject legitimate `color-mix()`/`lab()`/`var()`
  values. `Scene.class` / `cssVar()` / offset precision from the same doc stay in Sprint 3
  task 14.

---

## How to resume (for a fresh conversation)

1. Read this file + [`00-overview-and-roadmap.md`](./00-overview-and-roadmap.md).
2. Pick the next ⬜ task; open its source doc section for the verified evidence and sketch code.
3. Resolve that task's "Open questions" with the owner **first**; record the call in the
   Decisions log above with the date and rationale.
4. Branch → implement → `deno task test` → `deno fmt && deno lint && deno doc --lint src/mod.ts`
   → update this file → commit when the owner asks.
5. Visual change? Regenerate `tmp/previews.ts` and check against `tmp/screenshots/*` per the
   `AGENTS.md` checklist.
