---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# CCE-78: `/btw` counter unblend — fixing cumulative drift in Memory Execution scoring

PR #119 separates two signals that were silently conflated in the Memory
Execution scorer: a 30-day windowed session-coverage counter and a
cumulative all-time invocation count. The fix prevents the ratio from
drifting upward as your account ages, independent of what you've actually
done in the last 30 days.

## What was wrong

The original scorer blended `~/.claude.json#btwUseCount` (cumulative
all-time `/btw` invocations) into `btwCommandUses` (30-day
session-coverage counter) via a `Math.max` call in
`scripts/run-assessment.mjs`:

```js
// before — blends two semantically incompatible sources
btwCommandUses: Math.max(windowedCoverage, cumulativeAllTime)
```

This looks ergonomic — one field, one predicate — but it conflates two
independent axes:

| Axis | Windowed source | Cumulative source |
|------|----------------|-------------------|
| **Time window** | 30-day sessions | All-time account history |
| **Counter class** | Per-session-coverage ratio | Raw invocation count |

A per-session-coverage ratio needs a numerator drawn from the same
universe as its denominator. Once you mix in a cumulative count, the
numerator grows with account age regardless of recent posture. After
enough `/btw` uses over a long account lifetime, the blended value
permanently saturates the windowed ratio — the Execution score stops
reflecting what you're doing now and becomes a record of what you've
ever done.

## What changed

The fix introduces a clean separation:

- **`btwCommandUses`** stays purely 30-day windowed session-coverage.
  It feeds the Memory Execution ratio where the denominator is also
  30-day windowed. The ratio remains comparable run-to-run.
- **`cliBtwUseCountAllTime`** is a new `signalsSummary` field that carries
  the cumulative `~/.claude.json#btwUseCount` value without touching the
  windowed counter.
- The **Boris tips 33 and 54** predicates (the `btw-side-channel` adoption
  check) are rerouted to target `cliBtwUseCountAllTime >= 1` instead of
  `btwCommandUses`. Habit-only adoption probes — the "have you ever used
  this?" checks — are the correct use for a cumulative source.

The rule: **habit-only predicates (`>= 1`) query the cumulative field;
ratio denominators stay purely windowed**.

## Score impact

The Memory Execution score is **intentionally unchanged** at 16 → 16. The
fix corrects the long-term trajectory, not the current value. Without it,
the score would have drifted upward over time in a way that doesn't reflect
recent posture.

## The two axes to check on any new counter

CCE-78 exposed a pattern worth applying whenever you add a counter to
the scoring pipeline. Before wiring a field into a ratio scorer, verify
two independent axes:

1. **Time window** — is the counter 30-day windowed or cumulative
   all-time? Windowed counters belong in ratio numerators/denominators.
   Cumulative counters belong in separate fields for adoption/habit probes.
2. **Counter class** — is it per-session-coverage (each qualifying session
   counted once) or raw invocation count (every call summed)? A
   per-session-coverage ratio with a raw-invocation numerator can exceed
   100% if one session generates many invocations.

A `Math.max(windowedCoverage, cumulativeCounter)` blend looks safe but
fails both axes simultaneously — the CLAUDE.md hard rules section documents
this as a permanent guardrail.

## Follow-up: CCE-79

This PR fixes the blend. The full Memory Execution scorer redesign — moving
to per-field semantics rather than a fungible sum across `/btw` signals —
is filed as **CCE-79** and tracked separately.
