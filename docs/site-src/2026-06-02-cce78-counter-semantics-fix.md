---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Counter Semantics Fix — `/btw` Cumulative vs. Windowed Blend

**PR #119 · 2026-06-02 · non-breaking**

## What changed

`buildSignalsSummary` in `scripts/run-assessment.mjs` previously computed
`signalsSummary.btwCommandUses` using a `Math.max` blend of two counters with
incompatible semantics:

- `btwCommandUses` — the 30-day windowed session-coverage count read from
  `~/.claude/history.jsonl` and transcript scans.
- `settings.cliBtwUseCount` — the cumulative all-time invocation count stored
  in `~/.claude.json` by Claude Code's own runtime.

The blend (`Math.max(btwCommandUses, cliBtwUseCount)`) was introduced during the
v0.9.15 cycle for predicate ergonomics around Boris tips 33 and 54: the
`btw-side-channel` rubric probe checks whether the user has ever adopted `/btw`
as a habit, and the cumulative counter is the truer signal for that question.
That goal was reasonable. The execution was wrong.

By writing the result back to `btwCommandUses`, the blend silently inflated the
field used as the Memory Execution ratio's numerator. Because the cumulative
counter grows monotonically with account age — regardless of whether the user ran
`/btw` in the last 30 days — the Memory Execution score drifted upward over time
without reflecting genuine recent posture.

## The two-axis classification

Every counter that feeds a ratio scorer must be classified on two independent
axes before it enters a sum or a `Math.max`:

| Axis | `btwCommandUses` | `settings.cliBtwUseCount` |
| --- | --- | --- |
| (a) Time window | windowed (30-day lookback) | cumulative (all-time) |
| (b) Counter class | session-coverage (deduped per session) | raw invocation count |

Both axes differ. They cannot appear in the same numerator without corrupting
window semantics.

## The fix

Two changes in `buildSignalsSummary`:

1. **`btwCommandUses` is now 30-day windowed session-coverage only.** The line
   that called `Math.max(maxProbe(signals, "btwCommandUses"), signals.settings.cliBtwUseCount ?? 0)`
   is replaced with simply `maxProbe(signals, "btwCommandUses")`, which takes
   the larger of the transcript and `history.jsonl` 30-day counts without
   touching the cumulative source.

2. **`cliBtwUseCountAllTime` is a new, separate field** exposed directly from
   `signals.settings.cliBtwUseCount`. It defaults to `0` when the field is
   absent. The rubric's `btw-side-channel` predicate for tips 33 and 54 was
   rerouted to compare against `cliBtwUseCountAllTime >= 1` instead of
   `btwCommandUses >= 1`, restoring the original ergonomics without corrupting
   the ratio numerator.

The Memory Execution score was unchanged at 16 because the scorer body already
called `maxProbe(...)` directly on the insights signals rather than reading from
the corrupted `btwCommandUses` field in `signalsSummary`.

## Probe and catalog changes

- Probe catalog: entries grew from 47 to 48. `cliBtwUseCountAllTime` is the new
  entry under the `runtime` source category, with the description:
  *"Cumulative all-time count of /btw invocations maintained by Claude Code.
  Habit-only adoption signal — backs the tip 33 predicate. Distinct from
  btwCommandUses which is 30-day windowed session-coverage."*
- `signalsSummary` keys grew from 71 to 72.
- The `btwCommandUses` catalog description was updated to document the
  separation explicitly: *"Note: NOT blended with cliBtwUseCountAllTime — that's
  a separate cumulative all-time counter exposed for 'have you ever adopted'
  predicates only. CCE-78."*

## New standing rule

A hard rule was added to `CLAUDE.md`:

> **Per-field semantic categorization before adding to any numerator.** When
> adding a new field to a ratio numerator (or summing multiple fields into one),
> classify each field on two independent axes BEFORE writing the sum: (a) time
> window — windowed vs. cumulative; (b) counter class — session-coverage vs.
> raw invocation count. If the new field's class on either axis differs from
> existing numerator inputs, it doesn't belong in the same sum.

The rule cites CCE-79 as the reference case — a deeper redesign of the Memory
Execution scorer that narrows the ratio numerator to the two windowed
session-coverage signals (`/clear + /compact`) and surfaces `/btw` as cumulative
evidence text rather than a ratio input.

## Test coverage

Three tests in `scripts/__tests__/signals-summary.test.mjs` enforce the
separation:

- `btwCommandUses takes MAX of transcript and history only — NOT cliBtwUseCount
  (CCE-78)` — with `historyInvocations.btwCommandUses = 5` and
  `settings.cliBtwUseCount = 36`, `signalsSummary.btwCommandUses` must equal
  `5`, not `36`.
- `exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)` —
  with `historyInvocations.btwCommandUses = 0` and `settings.cliBtwUseCount = 36`,
  the two fields independently equal `0` and `36`.
- `cliBtwUseCountAllTime defaults to 0 when settings.cliBtwUseCount is missing`.

The `signalsSummary` key snapshot in the same file is updated to include
`cliBtwUseCountAllTime` in the sorted key list.

## Related

- **CCE-79** — Memory Execution scorer redesign: restricts the ratio numerator
  to `/clear + /compact` session-coverage counts, recalibrates the rubric target
  from 92 to 60, and surfaces `/btw` as cumulative evidence text.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — probe
  tracker updated in the same PR with the new catalog entry and revised key
  counts.
