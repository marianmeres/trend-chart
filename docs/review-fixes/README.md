# Review Fixes — `@marianmeres/trend-chart`

This directory holds a **code-verified** review of the package and a prioritized plan for
fixing what it found, produced on **2026-08-12** (codebase at commit `e06fdea`). It is a
**planning artifact** — no source code was changed. Every technical claim cites real
`file:line` and was checked against the actual code, most with an empirical reproduction;
findings that could not survive an adversarial refutation attempt were dropped rather than
hedged.

**Start here:** [`00-overview-and-roadmap.md`](./00-overview-and-roadmap.md) — the ranked
master table, the recommended first sprint, the cross-cutting themes, and a sequencing graph.
Then [`PROGRESS.md`](./PROGRESS.md) for execution status.

## Documents

| #  | Doc                                                  | Scope                                      | Headline finding                                                                          |
| -- | ---------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 00 | [overview-and-roadmap](./00-overview-and-roadmap.md) | Synthesis + 4 sprints                      | Good architecture, four landmines; three recurring themes explain the rest                |
| 01 | [core-math](./01-core-math.md)                       | `ticks.ts`, `scale.ts`, `zones.ts`         | `niceTicks()` can loop forever (#1); zone gradient blends wrong across the plot (#2)      |
| 02 | [scene-composition](./02-scene-composition.md)       | `computeScene()` and the overscan contract | One `NaN` truncates the line (#1); overscan leaks into 3 consumers that meant "visible"   |
| 03 | [interaction](./03-interaction.md)                   | `gestures.ts` + pointer handling           | Two-chart sync recurses infinitely (#1); horizontal trackpad swipe zooms in (#2)          |
| 04 | [ssr-and-parity](./04-ssr-and-parity.md)             | `render-string.ts`                         | 3 color sinks interpolated unescaped (#1); 5 ways the two renderers disagree              |
| 05 | [api-surface](./05-api-surface.md)                   | `TrendChart` methods + option semantics    | `domainX` shadowing breaks `resetDomain()` **and** `setOptions({domainX})` from one cause |
| 06 | [tests-and-tooling](./06-tests-and-tooling.md)       | Coverage gaps + npm build                  | `gestures.ts`: 3 confirmed bugs, 0 tests — and it is headless-testable                    |

## How it was produced

A multi-agent workflow: 8 dimension reviewers over `src/`, then **one adversarial verifier per
finding** — each instructed to refute the claim, read the cited code and its callers, check
whether `AGENTS.md`/`API.md` declares the behavior intentional, and reproduce it with
`deno eval` wherever the claim concerned pure-module behavior. 48 agents total. Of 40
findings that survived verification (0 refuted, 0 uncertain), **33 remain after deduplicating
cross-dimension overlap** — the SSR escaping issue was found independently by three reviewers,
the end-dot overscan leak by two.

Verifier corrections are preserved inline in the docs as `> Verifier note:` /
`> Downgraded from the draft:` lines, so you can see what was tightened and why. Seven
lower-ranked findings were capped out of the verification stage and are **deliberately excluded**
from the plan rather than included unverified; they are logged in `PROGRESS.md`'s backlog.

> Nothing here is decided. Each doc ends with an **"Open questions / decisions needed"**
> section — those are the points that need your call before implementation begins. Two of them
> (the scroll-capture policy and the `"auto"` y-domain fit) are the most user-visible behavior
> changes in the plan and are parked in Sprint 4 as `⏸️ blocked` for exactly that reason.
