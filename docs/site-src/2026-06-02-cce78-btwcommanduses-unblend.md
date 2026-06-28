---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `btwCommandUses` from the cumulative `/btw` counter

**PR #119 · 2026-06-02**

## Problem

`signalsSummary.btwCommandUses` was supposed to hold a 30-day windowed
session-coverage count — how many sessions in the scoring window included a
`/btw` invocation. Instead, `run-assessment.mjs` blended it with
`~/.claude.json#btwUseCount`, a cumulative all-time invocation counter, via:

```js
Math.max(btwCommandUses_windowed, cliBtwUseCount_alltime)
```

The intent was predicate ergonomics: a single field that tells you whether
you've _ever_ adopted `/btw`. The effect was corrupting the Memory Execution
scorer's ratio numerator. Because `btwUseCount` grows monotonically with
account age, the blended value drifted upward over time regardless of recent
posture — a score that slowly improves with no behavior change is not a score.

This violates the project's hard rule: **don't blend cumulative all-time
counters into windowed ratio surfaces**. Numerator counters that share a ratio
with a 30-day windowed denominator must also be 30-day windowed.

## What changed

| Field | Before | After |
|-------|--------|-------|
| `btwCommandUses` | `Math.max(windowed_sessions, alltime_invocations)` | windowed session-coverage only (30-day) |
| `cliBtwUseCountAllTime` | did not exist | new field: `~/.claude.json#btwUseCount`, cumulative all-time, evidence-only |

The tip-33 predicate (`/btw` adoption check) now targets
`cliBtwUseCountAllTime >= 1` rather than `btwCommandUses >= 1`. A `>=1`
adoption check is a binary lifetime question; it belongs on the cumulative
field. The Memory Execution scorer's ratio numerator uses `btwCommandUses` —
the windowed field — so it reflects what you did in the last 30 days, not
what you've ever done.

Probe catalog, rubric, and the probe-implementation-status tracker were updated
in the same PR. Tests cover the new field path through
`buildSignalsSummary` and the revised predicate contract.

## Why the old blend looked safe

The `Math.max` form was written as a convenience — one field, two semantic
needs. It works correctly for a binary `>=1` predicate (cumulative wins when
it's ≥ 1) and looks fine in isolation. The corruption only surfaces when that
same field feeds a ratio's numerator: the all-time counter silently inflates
the ratio above the windowed session count, producing a Memory Execution score
that grows with account age rather than recent posture.

The general pattern to watch for: if a field needs to serve _both_ a binary
adoption probe (`>=1`) and a ratio numerator, those are two different semantic
axes — time window and counter class — and they need two different fields.

## Field semantics after CCE-78

```
btwCommandUses          → windowed (30-day), session-coverage
                          → used in: Memory Execution scorer numerator
                          → axis: "are you using /btw lately?"

cliBtwUseCountAllTime   → cumulative (all-time), raw invocation count
                          → used in: tip-33 adoption predicate, evidence text
                          → axis: "have you ever adopted /btw?"
```

Neither field should appear in a surface that belongs to the other's axis.

## Follow-up

CCE-78 fixes the blend for `/btw` specifically. The full Memory Execution
scorer carries a broader design issue: its original numerator summed
`/btw + /clear + /compact + /rewind` across fields with different time-window
and counter-class semantics. That redesign is tracked as **CCE-79** and has
its own spec at
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.
CCE-79 narrows the numerator to `/clear + /compact` (both windowed
session-coverage), surfaces `/btw` as cumulative evidence text, and
recalibrates the rubric target from 92 → 60 to match the realistic ceiling.
