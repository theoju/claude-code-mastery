---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending `/btw` usage from the Memory Execution ratio

## Decision

Stop feeding `~/.claude.json`'s cumulative `btwUseCount` into the Memory
Execution scorer's windowed numerator. `buildSignalsSummary()` in
`run-assessment.mjs` now exposes it as its own field,
`cliBtwUseCountAllTime`, and keeps `btwCommandUses` as a pure 30-day,
session-coverage count (`maxProbe(signals, "btwCommandUses")` — the
transcript scan reconciled with `history.jsonl`, nothing else). The two
rubric predicates that referenced the old blended value (Boris tip 33 and
tip 54) were repointed at the correct field for what each is actually
asking.

## Context

Before this fix, `btwCommandUses` was computed by `Math.max`-ing the
windowed transcript/`history.jsonl` count against `cliBtwUseCount`, the
lifetime invocation counter `~/.claude.json` tracks. That blend meant a
user who invoked `/btw` twice three years ago and hasn't touched it since
would still show up in the last-30-days ratio as if they'd used it
recently — the count never resets, so it only ever ratchets the numerator
up as an account ages. Every other input to that ratio (`/clear`,
`/compact`) is genuinely windowed. Mixing a cumulative counter into a
windowed sum overstates recent posture and drifts independent of anything
the user actually did this month.

This is the exact failure mode `CLAUDE.md`'s per-field semantic rule
describes: before summing a field into a ratio numerator, classify it on
two axes — time window (windowed vs. cumulative) and counter class
(session-coverage vs. raw invocation count). `cliBtwUseCount` failed the
first axis outright. The `Math.max` pattern is ergonomic (it lets a
predicate treat "ever adopted" and "recently active" as the same signal)
but it silently corrupts any ratio that consumes the merged value as a
denominator input.

## What changed

- `buildSignalsSummary()` (`scripts/run-assessment.mjs`) drops the
  `Math.max(cliBtwUseCount, ...)` merge from `btwCommandUses` and adds a
  sibling field, `cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0`,
  carrying the cumulative value on its own.
- The tip 33 and tip 54 `satisfiedWhen` predicates in `rubric.json` that
  previously keyed off the blended `btwCommandUses` now key off
  `cliBtwUseCountAllTime`, matching the "have you ever adopted `/btw`"
  intent those two predicates actually have — that's a habit-adoption
  check, not a recent-activity ratio, so the cumulative field is the
  correct predicate LHS, not a workaround.
- `app/data/probe-catalog.json` gained an entry for the new field, and the
  living tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
  moved its header counts from 47 probes / 71 `signalsSummary` keys to 48
  and 72 respectively, per its CI-enforced convention.
- Because the Memory Execution ratio's numerator is unchanged in kind
  (still `/clear + /compact`, session-coverage, windowed) and the
  cumulative `/btw` value never belonged in it, the fix is deliberately
  score-neutral: the Memory Execution number itself doesn't move. What
  moves is the data provenance underneath the two predicates that used to
  read a corrupted field.

## Why this shape and not another

Routing `cliBtwUseCountAllTime` to a separate `signalsSummary` field
(rather than, say, capping the cumulative counter or decaying it) follows
the same resolution the project used for the sibling case this rule was
written from (CCE-78, documented in `CLAUDE.md`): keep the cumulative
source on its own field, and point only the predicates that genuinely want
"ever adopted" semantics at it. Predicates wanting recent-activity
semantics stay on the windowed field. No predicate should have to choose
between the two meanings by re-deriving one from the other inline.

## Verification

`app/lib/__tests__/rubric-predicates.test.ts` exercises the tip 33 / tip
54 predicates against the new field, and
`scripts/__tests__/build-signals-summary.test.mjs` plus
`scripts/__tests__/signals-summary.test.mjs` assert `cliBtwUseCountAllTime`
is present and that `btwCommandUses` no longer reflects the cumulative
counter under a fixture where the two diverge.
