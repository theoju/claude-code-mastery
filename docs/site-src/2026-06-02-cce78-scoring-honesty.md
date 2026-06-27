---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# CCE-78: Scoring Honesty — Cumulative vs. Windowed Counter Semantics

**Released in v0.9.19 · PR #120 · 2026-06-02**

## What broke and why

`run-assessment.mjs` builds a flat `signalsSummary` object that the predicate
engine evaluates against rubric `satisfiedWhen` expressions. Before CCE-78, the
entry for `/btw` command usage was constructed like this (lines 134–137 of the
pre-fix file):

```js
// ⚠ pre-CCE-78 — do not copy
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),
  signals.settings?.cliBtwUseCount ?? 0
),
```

The blend looked ergonomic: if the 30-day transcript scan missed some `/btw`
invocations, fall back to the all-time count from `~/.claude.json`. In
practice, it silently corrupted the Memory Execution ratio's numerator.
`maxProbe(signals, "btwCommandUses")` returns a **30-day windowed
session-coverage** count. `cliBtwUseCount` is a **cumulative all-time
invocation count**. The two measure different things on two independent axes:

| Axis | `btwCommandUses` | `cliBtwUseCount` |
|---|---|---|
| Time window | 30-day windowed | Cumulative (lifetime) |
| Counter class | Session-coverage (deduped per session) | Raw invocation count |

When you `Math.max` them into one field, the numerator of any ratio that reads
`btwCommandUses` can drift upward indefinitely with account age — even when
recent `/btw` usage is zero. A scorer measuring "how often you do this lately"
silently becomes "did you ever do this at all."

## The fix (CCE-78 / PR #119)

The blend is removed. `btwCommandUses` is now 30-day windowed session-coverage
only:

```js
// ✓ post-CCE-78 (run-assessment.mjs:139–140)
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

A new field, `cliBtwUseCountAllTime`, carries the cumulative all-time counter
separately. Rubric predicates that want "have you ever adopted this habit"
semantics (tip 33, tip 54) are rerouted to `cliBtwUseCountAllTime`. Windowed
ratio scorers that need recent posture continue reading `btwCommandUses`, which
is now unambiguously session-coverage over the look-back window.

The Memory Execution scorer body already used `maxProbe` directly, so its
computed score does not change. What changes is the shape contract: the two
semantic axes are no longer silently fused in `signalsSummary`.

## Scorer-author contract (new hard rule)

Before adding a field to any ratio numerator — or summing multiple fields into
one — classify each field on two independent axes:

| Axis | Possible classes |
|---|---|
| **(a) Time window** | windowed (e.g. 30-day) / cumulative (lifetime) |
| **(b) Counter class** | session-coverage (deduped per session) / raw invocation count |

If a new field's class on either axis differs from existing numerator inputs,
it does not belong in the same `sum`. Route it to a separate surface instead:

- **Cumulative evidence text** — show it alongside the ratio as supporting
  context, not as part of the numerator.
- **Separate predicate** — binary adoption check against the cumulative field
  (e.g. `cliBtwUseCountAllTime >= 1`).
- **Separate ratio** — pair the new field with a denominator whose universe
  matches its time window and counter class.

The `Math.max(maxProbe(s, field), cumulativeCounter)` pattern looks ergonomic
but conflates both axes. Never use it in a ratio numerator.

## What CCE-78 does NOT change

- The Memory Execution score value is unchanged — the scorer body's `maxProbe`
  call was already reading from the correctly-windowed source.
- The tip-33 and tip-54 predicates continue to work; they are rerouted to
  `cliBtwUseCountAllTime`, which preserves the "adoption" semantics those tips
  intend.
- No user-visible dashboard output changes in this release.

## Follow-on work

**CCE-79** (not yet landed) is a deeper Memory Execution scorer redesign that
restricts the ratio numerator to the two cleanly-windowed session-coverage
signals (`/clear` + `/compact`), surfaces `/btw` as cumulative evidence text,
and recalibrates the rubric target from 92 → 60 to reflect the narrowed
realistic ceiling. Document CCE-79 separately when it ships.
