---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# CCE-78: Scoring Honesty Fix — Separating Cumulative `/btw` Count from Windowed Coverage

**Shipped in v0.9.19 · PR #120 (CCE-78)**

`signalsSummary.btwCommandUses` was silently over-reporting recent `/btw`
usage for any user who had run the command many times historically but
rarely in the current 30-day window. The cause was a `Math.max` blend in
`scripts/run-assessment.mjs` that mixed a cumulative all-time invocation
count from `~/.claude.json` into a 30-day windowed session-coverage metric.
CCE-78 separates the two onto distinct fields and fixes the predicate
routing so each field is only consumed by surfaces whose semantics it
actually satisfies.

## What was wrong

`btwCommandUses` was intended to measure: _"in how many sessions over the
last 30 days did you use `/btw`?"_ — a windowed session-coverage counter.

Inside `run-assessment.mjs`, the build step was:

```js
btwCommandUses: Math.max(maxProbe(signals, 'btwCommandUses'), cliBtwUseCount)
```

`cliBtwUseCount` reads `~/.claude.json`'s lifetime invocation count —
cumulative, not windowed, and a raw invocation count rather than a
session-coverage number. The `Math.max` looked ergonomic (always use the
larger of the two sources), but it violated both semantic axes:

| Axis              | `btwCommandUses`                   | `cliBtwUseCount`             |
| ----------------- | ---------------------------------- | ---------------------------- |
| (a) Time window   | 30-day windowed                    | Cumulative (all-time)        |
| (b) Counter class | Session-coverage (deduped/session) | Raw invocation count         |

For a user who ran `/btw` 200 times two years ago and zero times this
month, the blend returned 200. The Memory Execution ratio then used that
200 as its numerator against a denominator of ~30 recent sessions —
producing a ratio far above 100 % and a clamped-to-100 score that said
_"excellent memory hygiene"_ when the honest answer was _"not recently."_

## The fix

Two changes, both in `scripts/run-assessment.mjs`:

1. **New field**: `cliBtwUseCountAllTime` exposes the cumulative all-time
   count on its own key in `signalsSummary`, untouched.

2. **Field restored**: `btwCommandUses` is restored to the pure 30-day
   windowed session-coverage value — no `Math.max` blend.

3. **Predicate re-routing**: the `btw-side-channel` predicate that backs
   tips 33 and 54 was updated to read `cliBtwUseCountAllTime`. A `>= 1`
   adoption check ("have you ever used `/btw`?") is the right semantic for
   a cumulative all-time counter; it is wrong for the windowed ratio
   numerator.

The Memory Execution _score_ does not change for a typical user whose
recent `/btw` usage matches their historical rate. It changes — downward,
toward honesty — only for users whose cumulative count was masking a recent
drop in usage.

## Downstream effect on `signalsSummary` consumers

`btwCommandUses` is an additive schema change in one direction: its value
can only decrease or stay the same post-upgrade. If you have a
`signalsSummary` consumer that reads this field as a session-coverage ratio
numerator, no action is needed — the corrected value is now more accurate.
If your consumer used `btwCommandUses` as a proxy for "has the user adopted
`/btw` at all," switch it to `cliBtwUseCountAllTime >= 1`.

## Why not just fix the Memory Execution scorer directly?

The Math.max blend was one symptom of a broader issue in the Memory
Execution numerator: it summed `/btw`, `/clear`, `/compact`, and `/rewind`
even though those four fields span three different semantic classes (see the
CLAUDE.md hard rule _"Per-field semantic categorization before adding to
any numerator"_). CCE-78 is the minimal fix — restore the surface that was
actively lying. **CCE-79** is the follow-up redesign that applies per-field
semantic categorization across all Memory Execution numerator inputs,
recalibrates the rubric target from 92 → 60, and restricts the numerator
to the two genuine 30-day session-coverage signals (`/clear` + `/compact`).

## Plans housekeeping

Completed plan files for CCE-72 (ship-journal stage counters) and CCE-76
(full Execution-scorer coverage across all 12 dimensions) were archived out
of `docs/superpowers/plans/` into `docs/superpowers/plans/archived/`.
Completed plans stay in the tree for history but stop cluttering the active
plans directory. The same convention applies to future completed work —
move, don't delete.

## Hard rule added to CLAUDE.md

A new hard rule, _"Per-field semantic categorization before adding to any
numerator"_, was added to `CLAUDE.md`. It requires classifying every field
on two independent axes — time window (windowed vs cumulative) and counter
class (session-coverage vs raw invocation count) — before including it in
a ratio numerator. Fields that differ on either axis don't belong in the
same sum. CCE-79 is cited as the reference case.

## Related

- CCE-79 (planned): Memory Execution scorer redesign with per-field
  semantic categorization — filed but not yet landed.
- [`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md) — design doc for the follow-up.
- [v0.9.19 release notes](2026-06-02-v0919-release-notes.md) — bundled alongside this change.
