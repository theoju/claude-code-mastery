---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
---

# v0.9.19 — Scoring honesty fix: `/btw` counter semantics (PR #120)

v0.9.19 bundles two merged PRs: a scoring-honesty fix (PR #119 / CCE-78) that
corrects a silent numerator inflation in the Memory Execution scorer, and
housekeeping archival of two completed plan files (PR #118).

---

## The problem: cumulative count blended into a windowed ratio

The Memory Execution scorer uses `btwCommandUses` — a 30-day windowed
session-coverage counter — as part of its numerator. Since at least v0.9.18,
`run-assessment.mjs` applied a `Math.max` blend:

```js
// before — silently mixed two incompatible counter classes
btwCommandUses: Math.max(btwCommandUses_30day, cliBtwUseCount_lifetime)
```

`cliBtwUseCount` comes from `~/.claude.json` and is a **cumulative all-time
invocation count**, not a 30-day session-coverage figure. For any user with
meaningful historical `/btw` usage, this blend guaranteed that `btwCommandUses`
was permanently floored at the all-time lifetime count, making the Memory
Execution ratio drift upward with account age regardless of recent practice.
The ratio didn't measure recent posture — it measured how old your account was.

## What changed

**PR #119 / CCE-78** makes three changes:

1. **Removes the `Math.max` blend.** `btwCommandUses` in `signalsSummary` is
   now purely the 30-day windowed session-coverage figure from
   `~/.claude/usage-data/`.

2. **Exposes the cumulative source separately.** A new
   `signalsSummary.cliBtwUseCountAllTime` field carries the `~/.claude.json`
   lifetime count. It is surfaced as evidence text (adoption signal) rather than
   folded into any ratio numerator.

3. **Reroutes the tip-33/54 predicate.** The `btw-side-channel` rubric
   predicate (`satisfiedWhen: { field: "btw-side-channel" }`) now reads
   `cliBtwUseCountAllTime` for the `>= 1` adoption check. Adoption detection is
   preserved — the change only stops that binary adoption signal from inflating
   the continuous ratio surface.

**PR #118** archives the CCE-72 and CCE-76 plan files now that those features
have shipped. No scoring contract changes.

## Counter-class rule (codified in CLAUDE.md)

This bug is a concrete instance of a class of errors: mixing counters of
different semantic classes into a single `Math.max` or summed numerator. The
fix introduced a hard rule in `CLAUDE.md`:

> **Don't blend cumulative all-time counters into windowed ratio surfaces.**
> Numerator counters that share a ratio with a 30-day windowed denominator must
> also be 30-day windowed. Expose cumulative sources on a separate
> `signalsSummary` field and route habit-only predicates (`>= 1` adoption
> checks) at the cumulative field.

The two axes to check per field before adding it to any ratio numerator:

| Axis              | Classes                                          |
| ----------------- | ------------------------------------------------ |
| (a) Time window   | windowed (e.g. 30-day) vs. cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) vs. raw invocation count |

A `Math.max` blend looks ergonomic but conflates both axes simultaneously.

## What this means for your scores

If you have significant historical `/btw` usage but low recent activity, your
Memory Execution score will likely **decrease** after upgrading to v0.9.19.
That decrease is correct — the previous score was inflated by the blend.

If you use `/btw` actively in your current 30-day window, the score is
unaffected.

## Follow-up: CCE-79

CCE-79 is filed for a fuller redesign of the Memory Execution scorer. The
current scorer still sums `/btw + /clear + /compact + /rewind` in its
numerator even though those signals have different counter classes and
real-world frequencies. The redesign will restrict the numerator to the two
session-coverage signals (`/clear + /compact`), surface `/btw` as cumulative
evidence text, and recalibrate the rubric target to match the narrowed
realistic ceiling.
