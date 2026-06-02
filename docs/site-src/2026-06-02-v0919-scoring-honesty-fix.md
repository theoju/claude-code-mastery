---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
---

# v0.9.19 — Scoring Honesty Fix (CCE-78)

**Released:** 2026-06-02

v0.9.19 bundles two prior PRs: a scoring-honesty fix (CCE-78) that corrects a silent counter-blending bug in the Memory Execution signal surface, and housekeeping archival of the CCE-72 and CCE-76 plans that shipped in v0.9.18.

## The bug: cumulative count bleeding into a windowed ratio

The `/btw` side-channel adoption signal (`btwCommandUses`) feeds the Memory Execution scorer's ratio numerator. Before this fix, `run-assessment.mjs` blended the **cumulative all-time** `/btw` invocation count from `~/.claude.json#btwUseCount` into that **30-day windowed** session-coverage field via `Math.max`:

```js
// Before — corrupted blend
btwCommandUses: Math.max(btwCommandUses_windowed, cliBtwUseCount_allTime)
```

For users with significant older `/btw` usage the all-time counter always dominated, making scores drift upward with account age regardless of whether you used `/btw` recently. The ratio denominator (`btwSessionCount`, a 30-day windowed count) had no matching all-time companion, so the numerator could silently exceed the denominator without the scorer flagging it.

Two independent axes were being conflated: **time window** (30-day vs. cumulative) and **counter class** (per-session-coverage vs. raw invocation count). The `Math.max` looked ergonomic and was invisible in the output—your score just crept up over time.

## The fix

`signalsSummary` now exposes the two sources as **separate fields** with distinct semantics:

| Field | Source | Window | Use |
| --- | --- | --- | --- |
| `btwCommandUses` | transcript scan | 30-day windowed | Memory Execution ratio numerator |
| `cliBtwUseCountAllTime` | `~/.claude.json#btwUseCount` | cumulative all-time | habit-only adoption predicates |

The `btw-side-channel` predicate backing tips 33 and 54 now routes to `cliBtwUseCountAllTime`. That predicate is a `>=1` adoption check—cumulative all-time is the correct source for "have you ever adopted this habit?" The windowed `btwCommandUses` field is kept clean for the ratio scorer, where only recent posture should count.

The Memory Execution score itself is **unchanged**. It was already reading `maxProbe` directly, which never went through the blended field. This fix restores honesty in the signal surface without moving your score.

## Schema change

`signalsSummary` gains one additive field: `cliBtwUseCountAllTime`. Existing consumers of `btwCommandUses` are unaffected. No breaking changes.

## What's next: CCE-79

This fix resolves the counter-blending bug but leaves the Memory Execution scorer's per-field semantics as a deeper redesign opportunity. **CCE-79** tracks that work—a scorer that reasons explicitly about each field's time-window and counter-class rather than aggregating into a fungible sum.

## Hard rule added

CLAUDE.md now carries a hard rule on cumulative-vs-windowed counter semantics for scorer authors. The core of it: **never blend cumulative all-time counters into windowed ratio surfaces**. A `Math.max` blend conflates two independent axes—time window and counter class—and produces ratios that drift with account age rather than reflecting current posture. Route cumulative sources to separate `signalsSummary` fields (e.g. `cliBtwUseCountAllTime` for `cliBtwUseCount`) and aim habit-only predicates (`>=1` adoption checks) directly at those fields.

When reviewing a new ratio scorer, check both axes per field: (a) does the numerator share the same time window as the denominator? (b) are you counting per-session coverage or raw invocations? If either answer is "mixed," split the fields before wiring the predicate.
