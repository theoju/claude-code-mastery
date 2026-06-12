---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `btwCommandUses` from the Cumulative `/btw` Counter

**Date:** 2026-06-02  
**PR:** #119  
**Affects:** Memory Execution scorer, `buildSignalsSummary`, probe-catalog, rubric predicates for Boris tips 33 + 54

---

## Problem

`signalsSummary.btwCommandUses` was being populated via a `Math.max` blend:

```js
// BEFORE (broken)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed session-coverage
  signals.settings?.cliBtwUseCount ?? 0 // cumulative all-time invocation count
)
```

This conflated two independent semantic axes on a single field:

| Axis | `btwCommandUses` (history) | `cliBtwUseCount` (settings) |
|---|---|---|
| **(a) Time window** | 30-day windowed | Cumulative all-time |
| **(b) Counter class** | Per-session-coverage (deduped per session) | Raw invocation count |

A user who had invoked `/btw` even once in their account lifetime would have `cliBtwUseCount >= 1`. After `Math.max`, `btwCommandUses` could never fall back to `0` once that all-time counter was non-zero. The Memory Execution ratio's numerator silently drifted upward with account age rather than reflecting recent posture.

## Fix

Split the two signals onto separate fields in `buildSignalsSummary` (`scripts/run-assessment.mjs`):

```js
// AFTER (correct)
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` now carries only the 30-day windowed session-coverage count. `cliBtwUseCountAllTime` carries the cumulative all-time invocation count from `~/.claude.json`, but is never fed into any windowed ratio's numerator.

## Predicate rerouting

Boris tips 33 and 54 (`btw-side-channel`) track whether you've adopted the `/btw` habit at all — a binary "have you ever done this" check, not a recency signal. The predicate was previously `btwCommandUses>=1`; with the corrected semantics, the windowed field can validly be `0` even for an active adopter who simply hasn't used `/btw` in the last 30 days.

The predicate is rerouted to the cumulative field:

| Field | Before | After |
|---|---|---|
| `btw-side-channel` `satisfiedWhen` | `btwCommandUses>=1` | `cliBtwUseCountAllTime>=1` |

This restores the intent: the adoption check fires correctly for a long-time user regardless of whether their 30-day window is empty, while leaving `btwCommandUses` clean for any future windowed ratio consumer.

## Test coverage

Three regression tests in `scripts/__tests__/signals-summary.test.mjs` pin the new invariants:

1. **`btwCommandUses` takes MAX of transcript and history only — NOT `cliBtwUseCount`:** a signals fixture with `historyInvocations.btwCommandUses = 5` and `settings.cliBtwUseCount = 36` must produce `btwCommandUses = 5`, not `36`.
2. **`cliBtwUseCountAllTime` exposed separately:** same fixture must have `cliBtwUseCountAllTime = 36`.
3. **`cliBtwUseCountAllTime` defaults to `0`:** when `settings.cliBtwUseCount` is absent, the field is `0`, not `undefined`.

The all-satisfied fixture in `app/lib/__tests__/rubric-predicates.test.ts` was updated to include both `btwCommandUses: 1` and `cliBtwUseCountAllTime: 1` so the sweep guard catches any future field rename.

## General rule codified

This bug class has a repeating pattern. The fix adds a hard rule to `CLAUDE.md`:

> **Don't blend cumulative all-time counters into windowed ratio surfaces.** Two semantic axes to check per field: **(a) time window** (windowed vs cumulative) and **(b) counter class** (per-session-coverage vs raw invocation count). A summary blend via `Math.max(maxProbe(s, field), cumulativeCounter)` looks ergonomic but conflates both axes — keep the cumulative source on a separate `signalsSummary` field and route habit-only predicates (`>=1` adoption checks) at the cumulative field.

Before adding any field to a ratio numerator, classify it on both axes. If the class differs from the other numerator inputs on either axis, it does not belong in the same `sum`. Route it to evidence text, a separate predicate, or a separate ratio with a matched denominator instead.

## Follow-up

The Memory Execution scorer's numerator (`/btw + /clear + /compact + /rewind`) still mixes signals from different semantic classes. CCE-79 redesigns that scorer to restrict the numerator to the two session-coverage signals (`/clear + /compact`), surface `/btw` as cumulative evidence text, keep `/rewind` as a next-action probe only, and recalibrate the rubric target `92 → 60` to match the narrowed realistic ceiling.
