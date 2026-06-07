---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# CCE-78: Counter semantics fix — `btwCommandUses` ratio corruption

**PR #119 · 2026-06-02**

The Memory Execution ratio in `scripts/score.mjs` had a silent numerator
corruption: `btwCommandUses` was a blend of two incompatible counter classes,
mixed via `Math.max` in `run-assessment.mjs`. This PR removes that blend and
introduces a two-axis classification rule that gates every future numerator
addition.

## The bug

`~/.claude.json` exposes `btwUseCount`, a **cumulative all-time invocation
count** that grows monotonically with account age. The Memory Execution scorer
used `btwCommandUses` as part of its 30-day windowed session-coverage
numerator, but `run-assessment.mjs` had been silently inflating that field:

```js
// before — Math.max blend in run-assessment.mjs:134-137
btwCommandUses: Math.max(
  insights.btwCommandUses,     // 30-day windowed session-coverage
  signals.btwUseCount          // cumulative all-time invocation count ← wrong axis
)
```

The two sources differ on both classification axes:

| Field | Time window | Counter class |
| --- | --- | --- |
| `insights.btwCommandUses` | 30-day windowed | session-coverage (deduped per session) |
| `signals.btwUseCount` | cumulative (lifetime) | raw invocation count |

Because `Math.max` picks the larger value and the lifetime counter only grows,
the numerator drifted upward with account age instead of tracking recent `/btw`
posture. The score looked healthier than it was on older accounts and produced
ratios that couldn't drop when behavior changed.

## The fix

`btwCommandUses` is now strictly the 30-day windowed session-coverage counter.
The cumulative source is exposed on a separate field, `cliBtwUseCountAllTime`,
so adoption-gate predicates can still reach it without polluting any ratio
numerator.

The tip-33 predicate (`/btw` adoption check) is rerouted to
`cliBtwUseCountAllTime >= 1`. That predicate is a binary adoption gate — "have
you ever used `/btw`?" — which correctly reads a lifetime counter, not a
windowed one. Routing it to the windowed field would falsely report no adoption
for users who stopped using `/btw` in the last 30 days.

The Memory Execution score is intentionally **unchanged at 16** after this fix.
The score was already honest; only the field semantics were wrong. The blend
happened to produce the same result here because the windowed counter was
already the larger value.

## The two-axis rule

This PR adds a hard rule to `CLAUDE.md` that applies before any field enters a
ratio numerator:

| Axis | Classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

If the new field's class on either axis differs from existing numerator inputs,
it doesn't belong in the same `sum`. Route it instead to:

- **Evidence text** — cumulative counters displayed as supporting context
- **Separate binary predicate** — adoption-gate checks (`>= 1`) against a
  cumulative field
- **Separate ratio with a matched denominator** — if you need a windowed
  version of a different counter class, give it its own scorer

The ergonomic temptation behind the original blend — a single `btwCommandUses`
field that works for both ratio numerators and adoption predicates — is exactly
the shape that produces silent corruption. Keep the cumulative source on a
separate `signalsSummary` field and route predicates explicitly.

## Follow-up

**CCE-79** is a broader redesign of the Memory Execution scorer that applies
per-field semantic categorization to all fields in the numerator (not just
`/btw`). It will restrict the numerator to the two session-coverage signals
(`/clear + /compact`), surface `/btw` as cumulative evidence text, keep
`/rewind` only as a next-action probe, and recalibrate the rubric target
92 → 60 to match the narrowed realistic ceiling. CCE-79 is a separate PR and
will get its own doc target when it lands.
