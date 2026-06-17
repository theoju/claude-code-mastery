---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# CCE-78: Separating Cumulative and Windowed `/btw` Counters

**Release:** v0.9.19 · **PR:** #120 · **Date:** 2026-06-02

## Problem

Before this fix, `scripts/run-assessment.mjs` built `signalsSummary.btwCommandUses` like this:

```js
// BEFORE — incorrect blend
btwCommandUses: Math.max(
  signals.settings.cliBtwUseCount,  // cumulative all-time invocation count
  maxProbe(signals, "btwCommandUses") // 30-day windowed session-coverage
)
```

The `Math.max` looked ergonomic — "take the best signal" — but silently conflated two incompatible counter classes on two independent axes:

| Field | Time window | Counter class |
|---|---|---|
| `signals.settings.cliBtwUseCount` | Cumulative (lifetime) | Raw invocation count |
| `maxProbe(signals, "btwCommandUses")` | 30-day windowed | Session-coverage (deduped per session) |

Because `cliBtwUseCount` grows monotonically with account age, the blend caused `btwCommandUses` to drift upward for any user with historic `/btw` usage — even if they hadn't used it in months. Any ratio that used `btwCommandUses` as a numerator silently overstated recent posture. The longer you'd been using Claude Code, the more the number diverged from reality.

## Fix

The two counters are now exposed as separate fields. Neither appears in the other's projection:

```js
// AFTER — correctly separated (scripts/run-assessment.mjs:139-140)
btwCommandUses: maxProbe(signals, "btwCommandUses"),       // 30-day windowed only
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0, // cumulative, never in ratios
```

The rubric predicates for tips 33 and 54 (`btw-side-channel`) that previously read `btwCommandUses >= 1` as an adoption check are rerouted to `cliBtwUseCountAllTime >= 1`. Adoption checks ("have you ever done this?") correctly use the cumulative counter. Ratio numerators ("did you do this recently?") correctly use the windowed counter.

## The classification rule

This fix establishes a scored contract for all scorer authors. Before adding any field to a ratio numerator — or summing multiple fields into one — classify it on **both** axes:

| Axis | Possible classes |
|---|---|
| **(a) Time window** | windowed (e.g., 30-day) / cumulative (lifetime) |
| **(b) Counter class** | session-coverage (deduped per session) / raw invocation count |

If a candidate field differs from existing numerator inputs on **either axis**, it doesn't belong in the same sum. Route it to:

- **Evidence text** — if it's cumulative and informational only
- **Separate predicate** — if it's a binary adoption check
- **Separate ratio with a matched denominator** — if it's windowed but a different counter class

A `Math.max` blend looks safe but is exactly this trap: it silently unifies two incompatible classes whenever the cumulative value is higher, which it almost always is for established users.

## What didn't change

The Memory Execution score is **unaffected** by this PR. The Memory Execution numerator uses `clearCommandUses` and `compactCommandUses` — both 30-day windowed session-coverage signals — not `btwCommandUses`. The `btwCommandUses` field appears only in the `signalsSummary` projection used by rubric predicates, not directly in the Execution scorer ratio. CCE-79 is a separate follow-up that redesigns the Memory Execution scorer more broadly.

## Files changed

| File | Change |
|---|---|
| `scripts/run-assessment.mjs:134–140` | Removed the `Math.max` blend; exposed `cliBtwUseCountAllTime` as a separate field |
| `app/data/rubric.json` | Rerouted tips 33/54 predicate from `btwCommandUses>=1` to `cliBtwUseCountAllTime>=1` |
| `CLAUDE.md` | Added the cumulative-vs-windowed hard rule (§Hard rules) |
| `package.json` | Bumped to v0.9.19 |

## Follow-up

**CCE-79** — Memory Execution scorer redesign. The original numerator summed `/btw + /clear + /compact + /rewind` even though those four fields span three different counter classes. The redesign restricts the numerator to `clearCommandUses + compactCommandUses` (both 30-day windowed session-coverage), surfaces `/btw` as cumulative evidence text, demotes `/rewind` to a next-action probe only, and recalibrates the rubric target 92 → 60 to match the narrowed realistic ceiling. CCE-79 will get its own decision page when it lands.
