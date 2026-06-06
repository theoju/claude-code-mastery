---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# CCE-78: Counter semantics unblend — `btwCommandUses` corruption fix

**PR #119 · 2026-06-06**

## What changed

`signalsSummary.btwCommandUses` was being silently corrupted by a
`Math.max` blend introduced during the v0.9.15 runtime-adoption-probes
cycle for predicate ergonomics. The blend mixed two semantically
incompatible sources into one field:

| Source | Time window | Counter class |
| --- | --- | --- |
| Transcript/history session counter | 30-day windowed | Per-session coverage (deduped) |
| `~/.claude.json#btwUseCount` | Cumulative all-time | Raw invocation count |

Mixing those two axes means the field grows with account age rather than
reflecting recent posture — and any ratio scorer that consumed it would
overstate session coverage as the cumulative count outpaced the windowed
session count.

PR #119 untangles them:

- **`btwCommandUses`** now contains only the 30-day windowed,
  per-session-coverage counter. Honest again.
- **`cliBtwUseCountAllTime`** is a new dedicated `signalsSummary` field
  that surfaces the cumulative source separately.
- The `btw-side-channel` predicate (Boris tips 33 and 54) is rerouted to
  `cliBtwUseCountAllTime >= 1` — the semantically correct source for a
  "have you ever adopted this habit" check, since cumulative all-time is
  exactly the right signal for a binary adoption gate.

### Numbers that moved

| Metric | Before | After |
| --- | --- | --- |
| Probe count | 47 | 48 |
| `signalsSummary` key count | 71 | 72 |
| Memory Execution score | 16 | 16 (unchanged) |

The Memory Execution score didn't move because the scorer body used
`maxProbe()` directly and never consumed the blended summary field. The
fix restores honesty in the `signalsSummary` surface only — the scorer
itself was clean.

## Why it matters

The blend was introduced for ergonomics — one field, one predicate
lookup. The cost was invisible corruption that would have surfaced only
when a ratio scorer with a windowed denominator consumed `btwCommandUses`
as its numerator. At that point the ratio could silently drift above
100% as the all-time count grew.

Two independent axes to verify before putting any field in a numerator:

1. **Time window** — windowed (e.g., 30-day) vs. cumulative (lifetime)
2. **Counter class** — per-session coverage (deduped per session) vs.
   raw invocation count

If the new field differs from existing numerator inputs on either axis,
it doesn't belong in the same sum. Route it to a separate surface:
evidence text (cumulative), a separate binary predicate, or a separate
ratio with a matched denominator.

## New hard rule

The fix codified a new hard rule in `CLAUDE.md`:

> **Never blend cumulative all-time counters into windowed ratio
> surfaces.** … A summary blend via `Math.max(maxProbe(s, field),
> cumulativeCounter)` looks ergonomic but conflates both axes — keep the
> cumulative source on a separate `signalsSummary` field and route
> habit-only predicates (`>= 1` adoption checks) at the cumulative field.

The rule names the original blend pattern explicitly so future authors
recognize it before writing it.

## What's next

CCE-78 isolates the `btwCommandUses` corruption. The broader issue — the
Memory Execution numerator summing `/btw + /clear + /compact + /rewind`
as if they were fungible — is addressed in **CCE-79**. That follow-up
redesigns the numerator to include only the two windowed session-coverage
signals (`/clear + /compact`), surfaces `/btw` as cumulative evidence
text, and recalibrates the rubric target from 92 to 60 to match the
narrowed realistic ceiling. CCE-79 will have its own doc target when it
lands.

## Files touched

- `scripts/insights-signals.mjs` — removed the `Math.max` blend;
  added `cliBtwUseCountAllTime` output
- `scripts/run-assessment.mjs` — wired `cliBtwUseCountAllTime` into
  `signalsSummary`
- `app/data/rubric.json` — rerouted `btw-side-channel` predicate to
  `cliBtwUseCountAllTime >= 1`
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` —
  updated probe registry per the per-probe-change convention (probe 47
  → 48, `signalsSummary` keys 71 → 72)
- `CLAUDE.md` — new hard rule on cumulative-vs-windowed counter blends
