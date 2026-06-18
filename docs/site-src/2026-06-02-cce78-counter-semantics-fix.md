---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Counter-semantics fix — `btwCommandUses` vs `cliBtwUseCountAllTime`

**PR #119 · v0.9.18**

## Problem

`buildSignalsSummary` was exposing a single `btwCommandUses` field that blended two
semantically incompatible counters via `Math.max`:

```js
// before CCE-78 (corrupted form)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),  // 30-day windowed session-coverage
  signals.settings.cliBtwUseCount,     // cumulative all-time invocation count
),
```

Those two sources sit on different positions on each of two independent axes:

| Axis | `maxProbe(signals, "btwCommandUses")` | `settings.cliBtwUseCount` |
|---|---|---|
| **(a) Time window** | 30-day windowed | Cumulative all-time |
| **(b) Counter class** | Per-session-coverage (deduped per session) | Raw invocation count |

Blending them produced a value that drifted upward with account age. On a
mature account where `cliBtwUseCount` reached 36 all-time, the blended field
always returned 36 — regardless of what the last 30 days looked like.

### Why it was introduced

The blend was added during the v0.9.15 runtime-adoption-probes cycle for
predicate ergonomics: the tip-33 `btw-side-channel` probe needed to check
"have you ever adopted this habit?" — an all-time adoption check. Routing it
at the `btwCommandUses` field via `>=1` seemed convenient. The cost was
silently corrupting that field's semantics for any scorer that consumed it as
a windowed ratio numerator.

### Impact

The Memory Execution ratio was the downstream consumer. The scorer itself
already used `maxProbe` directly (bypassing `signalsSummary`), so the _scored
value_ was unaffected — Memory Execution remained 16. The corruption existed
only on the `signalsSummary` surface, which is what the predicate engine and
the dashboard's next-action probes evaluate. Any probe doing `btwCommandUses
>= N` was actually reading a cumulative count, not a 30-day count.

## Fix

Split the field. `buildSignalsSummary` now emits two separate fields with
clearly scoped semantics:

```js
// scripts/run-assessment.mjs — lines 134-141 (post-CCE-78)

// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The rubric predicate for `btw-side-channel` (Boris tips 33 and 54) was
rerouted from `btwCommandUses>=1` to `cliBtwUseCountAllTime>=1`, matching
the true semantic of the adoption check.

## Decision rule

This case established a hard rule documented in CLAUDE.md under **§Hard rules**:

> **Per-field semantic categorization before adding to any numerator.** When
> adding a new field to a ratio numerator (or summing multiple fields into
> one), classify each field on two independent axes BEFORE writing the sum.
>
> | Axis | Possible classes |
> |---|---|
> | (a) Time window | windowed (e.g., 30-day) / cumulative (lifetime) |
> | (b) Counter class | session-coverage (deduped per session) / raw invocation count |
>
> If the new field's class on either axis differs from existing numerator
> inputs, it doesn't belong in the same sum.

A `Math.max` blend looks ergonomic but conflates both axes. Keep the
cumulative source on a separate `signalsSummary` field (e.g.
`cliBtwUseCountAllTime` for `cliBtwUseCount`) and route habit-only predicates
(`>=1` adoption checks) at the cumulative field.

## Test coverage

Three new assertions in
`scripts/__tests__/signals-summary.test.mjs` cover the CCE-78 contract:

1. **`btwCommandUses` takes MAX of transcript and history only — NOT `cliBtwUseCount`** —
   with `historyInvocations.btwCommandUses = 5` and `settings.cliBtwUseCount = 36`,
   the field returns `5`, not `36`.
2. **`cliBtwUseCountAllTime` exposed separately** — with windowed count `0` and
   `cliBtwUseCount = 36`, the two fields return `0` and `36` respectively.
3. **`cliBtwUseCountAllTime` defaults to `0`** when `settings.cliBtwUseCount` is absent.

The key shape contract is locked in by the snapshot test in
`scripts/__tests__/build-signals-summary.test.mjs`:
`cliBtwUseCountAllTime` now appears in the sorted-keys inline snapshot alongside
`btwCommandUses`, making any future accidental removal a CI failure.

## What was not changed

- The Memory Execution scorer body in `scripts/score.mjs` — it already read
  `maxProbe` directly and was never affected.
- The Memory Execution score value (16).
- Any Execution ratio denominator or universe gate.

## What comes next

A deeper redesign of the Memory Execution scorer is tracked as **CCE-79**.
The original numerator summed `/btw + /clear + /compact + /rewind` even
though `/btw` was cumulative-all-time, `/rewind` was a near-zero binary
signal, and `/clear` and `/compact` were the only genuine windowed
session-coverage inputs. CCE-79 restricts the numerator to the two
matching signals, surfaces `/btw` as cumulative evidence text, and
recalibrates the rubric target from 92 → 60 to match the narrowed realistic
ceiling. See
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
for the full per-field table.

The probe-tracker spec at
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` was
updated inline as part of PR #119 to reflect the field split and the
predicate reroute.
