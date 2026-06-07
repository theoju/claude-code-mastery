---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate ranker — pre-computed next-actions

A two-PR fix for a recurring `/self-assessment` bug: the skill was
re-implementing the `satisfiedWhen` filter by hand instead of reading the
pre-ranked list the scorer already computed, and hand-written filters
silently drop string predicates, producing "todo" suggestions for actions
you've already completed.

The triggering case: `/self-assessment` surfaced `Start with one loop: /loop 30m /babysit` as a top-3 priority even though `signalsSummary.loopCommandUses=14` — the predicate `loopCommandUses>=1` was satisfied and the action should have been filtered out.

---

## Why this happens

The `satisfiedWhen` field on each rubric next-action is a DSL string like
`loopCommandUses>=1` or `hasShipCommand & shipsRecent>=3`. Evaluating it
correctly requires a canonical implementation. Before this fix, the
canonical evaluator lived in `app/lib/assessment.ts` — a TypeScript file
coupled to Next.js — and no Node-side caller existed. The `/self-assessment`
skill instructed the model to "filter, then rank," which worked when the
model happened to handle all operator classes, and silently broke when it
didn't.

The fix has two parts:

| PR | What it does | Stability |
| --- | --- | --- |
| **PR 1 (tactical)** | Documents the full DSL grammar inline in `SKILL.md` so a careful model can evaluate correctly. Stopgap. | Ships immediately |
| **PR 2 (structural)** | Extracts `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, no Next.js coupling), pre-computes the filtered + ranked top-10 in `run-assessment.mjs`, writes `rankedNextActions` to `assessment.json`. The skill becomes a trivial reader. Deletes the PR 1 grammar block. | Lands after PR 1 |

---

## The `satisfiedWhen` DSL

Seven operator classes, evaluated left-to-right against `signalsSummary`:

| Syntax | Semantics |
| --- | --- |
| `path` | Truthy — non-null, non-zero, non-empty string (`"0"` and `"false"` are falsy) |
| `!path` | Falsy check |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison |
| `path=v` or `path=v\|w\|x` | Equality or alternation |
| `path!=v` | Not-equals |
| `path~regex` | Array-of-strings element match (case-insensitive) |
| `A & B` | AND of two or more atoms |

The canonical evaluator is `scripts/predicate.mjs` (post-PR 2) /
`app/lib/assessment.ts` (pre-PR 2). Missing signal fields are treated as
`0` / `false` — conservative: surfaces the action rather than hiding it.
Parse errors also return `false` for the same reason.

`app/lib/assessment.ts` becomes a 1-line passthrough re-export after PR 2
and must stay that way — `app/lib/__tests__/predicate-passthrough.test.ts`
asserts reference equality and fails CI on divergence.

---

## `assessment.json` output schema

PR 2 adds one top-level field. Existing fields are unchanged.

```jsonc
{
  // ... existing fields unchanged ...
  "rankedNextActions": [
    {
      "dimId": "scheduled",
      "actionId": "promote-routine",
      "axis": "platform",
      "weight": 2,
      "deficit": 25,
      "rank": 50,
      "action": "Promote repeating patterns to a Routine — Boris tip 61",
      "effort": "30min",
      "borisTip": 61,
      "satisfiedWhen": "scheduleCommandUses>=1"
    }
    // up to 10 entries, sorted by rank = weight × deficit
  ]
}
```

**Limit:** 10 entries (constant, not configurable). The skill reads
`[0..2]`; the remaining entries give Slack / console room without
recomputing.

### Ranking algorithm

```
rank = weight × deficit
deficit = max(0, 100 − score)   // platform-axis actions use platform score
                                 // execution-axis actions use execution score
```

Tie-breaking (deterministic across identical machine states):

1. `rank` descending
2. axis: `platform` → `execution` → `either`
3. `weight` descending
4. `dimId` ascending (locale)
5. `actionId` ascending (locale)

---

## How `/self-assessment` consumes it

Before PR 2 merges, the skill uses the PR 1 grammar block to evaluate
predicates itself. After PR 2, that block is deleted and replaced with:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and sorted by `weight × deficit`. Report
> verbatim.

The skill never re-implements the filter. If `rankedNextActions` is missing
from `assessment.json` (pre-PR 2 build), the skill falls back to the
grammar block in PR 1's `SKILL.md`.

---

## Tests shipped in PR 2

| File | Coverage |
| --- | --- |
| `scripts/__tests__/predicate.test.mjs` | One test per operator class + edge cases; rubric integration test (every `satisfiedWhen` in `rubric.json` parses without throwing) |
| `scripts/__tests__/rank-next-actions.test.mjs` | Happy path, named regression (`loopCommandUses=14` excludes the `>=1` action), tie-breaking determinism, `limit` slicing, malformed-action skipping |
| `scripts/__tests__/run-assessment.test.mjs` (extended) | `rankedNextActions` is present, length ≤ 10, required keys, snapshot stability |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Reference-equality between TS re-export and MJS source — divergence fails CI |

---

## See also

- [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md) — full architecture, pseudocode, error-handling table, open risks
- `scripts/predicate.mjs` — canonical DSL evaluator (post-PR 2)
- `app/data/rubric.json` — `satisfiedWhen` strings live here, one per next-action
- `app/lib/assessment.ts` — 1-line re-export passthrough (post-PR 2)
- `scripts/rank-next-actions.mjs` — `rankNextActions` function called by `run-assessment.mjs`
- `.claude/skills/self-assessment/SKILL.md` — skill hub; consumes `rankedNextActions`
