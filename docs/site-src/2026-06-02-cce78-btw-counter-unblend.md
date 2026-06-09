---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: `/btw` counter unblend — separating cumulative from windowed signals

**PR #119 · 2026-06-02**

## Problem

Every ratio scorer in `scripts/score.mjs` has two numbers: a numerator counting
_how many sessions_ had a given behavior and a denominator counting _how many
sessions ran in the window_. The ratio is meaningful only if both sides measure
the same thing — sessions in the same time window, counted the same way.

The Memory Execution scorer's `btwCommandUses` field violated that constraint.
During the v0.9.15 runtime-adoption-probes cycle, a `Math.max` blend was
introduced in `scripts/run-assessment.mjs` to make tip 33's predicate ergonomic:

```js
// run-assessment.mjs (before CCE-78)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),      // 30-day session-coverage counter
  cliBtwUseCount                            // ~/.claude.json lifetime total
),
```

The intent was to ensure `btwCommandUses >= 1` returned `true` if the user had
_ever_ used `/btw` — even before the scoring window. The side-effect was that
`signalsSummary.btwCommandUses` now held a cumulative all-time invocation count
on the left and a windowed session-coverage count on the right, with `Math.max`
silently picking the larger one. On accounts with a long `/btw` history, that
was always the cumulative count — a number that grows monotonically with account
age and has no relationship to recent session behavior.

Two independent axes were conflated:

| Axis              | `btwCommandUses` (original) | `~/.claude.json#btwUseCount` |
| ----------------- | --------------------------- | ---------------------------- |
| (a) Time window   | 30-day windowed             | cumulative (lifetime)        |
| (b) Counter class | per-session-coverage        | raw invocation count         |

## Decision

Separate the two values into two fields with distinct semantics. Never merge
them with `Math.max` or any other blend.

**`btwCommandUses`** — 30-day windowed, per-session-coverage. Used in the
Memory Execution ratio numerator. Stays on its existing surface.

**`cliBtwUseCountAllTime`** — cumulative all-time raw invocation count from
`~/.claude.json`. Exposed as a separate `signalsSummary` key. Used only on
cumulative evidence surfaces and binary adoption predicates.

The `satisfiedWhen` predicate for Boris tip 33 (`btw-side-channel`) and tip 54
is rerouted from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. An
adoption check ("have you ever used `/btw`?") belongs on the cumulative source;
a session-coverage ratio belongs on the windowed source.

## What changed in PR #119

| File | Change |
| --- | --- |
| `scripts/run-assessment.mjs` | Removed the `Math.max` blend; `btwCommandUses` is now read directly from the 30-day session-coverage probe |
| `scripts/insights-signals.mjs` | Added `cliBtwUseCountAllTime` as a separate field populated from `~/.claude.json#btwUseCount` |
| `app/data/rubric.json` | Predicate for tips 33 and 54 (`btw-side-channel`) updated to `cliBtwUseCountAllTime >= 1` |
| `app/data/probe-catalog.json` | New entry for `cliBtwUseCountAllTime`; probe count 47 → 48 |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Tracker updated; `signalsSummary` keys 71 → 72 |
| `CLAUDE.md` | New hard rule codifying the two-axis classification requirement |

## Score impact

The Memory Execution score is numerically unchanged at 16. The scorer body in
`scripts/score.mjs` already read `maxProbe(s, "btwCommandUses")` directly from
the probe layer, not from `signalsSummary.btwCommandUses` — so the Math.max
corruption never reached the scorer itself. What this PR restores is
**honesty at the `signalsSummary` surface**: the field now carries exactly what
its name says, and nothing more.

## Two-axis classification rule

This incident produced a new hard rule in `CLAUDE.md`. Before adding any field
to a ratio numerator — or summing multiple fields into one — classify each field
on two independent axes:

| Axis              | Possible classes |
| ----------------- | ---------------- |
| (a) Time window   | windowed (e.g., 30-day) / cumulative (lifetime) |
| (b) Counter class | per-session-coverage (deduped per session) / raw invocation count |

If a candidate field differs from existing numerator inputs on _either_ axis, it
doesn't belong in the same sum. Route it to a separate surface instead:

- Cumulative counts → evidence text or binary adoption predicate on `*AllTime` field
- Windowed but different counter class → separate ratio with a matched denominator
- Near-zero binary signals → next-action probe only (not a ratio input)

The CCE-79 Memory Execution scorer redesign applies this rule to the full
numerator (`/clear + /compact + /btw + /rewind`) and is tracked separately.

## What this doesn't fix

The deeper Memory Execution ratio had more than one misclassified field —
`/btw` was cumulative-all-time and `/rewind` was a near-zero binary signal,
both summed alongside the genuinely windowed `/clear` and `/compact` session
coverage counts. CCE-78 isolates the `/btw` half. The full per-field redesign
of the Memory Execution numerator (restricting it to `/clear + /compact`,
recalibrating the rubric target 92 → 60) is CCE-79 and is not covered here.
