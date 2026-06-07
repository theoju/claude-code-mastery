---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate ranker — design overview

**Date:** 2026-05-31  
**PR:** [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)  
**Full spec:** `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`

## The problem

`/self-assessment` was surfacing already-satisfied next-actions as top
priorities. The specific trigger: `/loop 30m /babysit` appeared in the top-3
list even though `signalsSummary.loopCommandUses=14` — the `loopCommandUses>=1`
predicate was satisfied.

Root cause: the skill instructed the model to "first filter, then rank" using
the `satisfiedWhen` DSL, but no Node-side evaluator existed. The model
hand-wrote its own filter, which silently dropped string predicates and
only handled object-shape comparisons. The rubric's canonical evaluator
lived in `app/lib/assessment.ts` — TS-only, Next.js-coupled, unreachable
from the skill runtime.

## Two-PR fix

| PR | Name | What it does |
|----|------|--------------|
| 1 (tactical) | SKILL.md DSL grammar | Documents all 7 operator classes inline so a careful model can evaluate correctly. Stopgap. |
| 2 (structural) | Extract + bake | Extracts `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM). Pre-computes filtered + ranked top-10 in `run-assessment.mjs` and writes them to `assessment.json.rankedNextActions`. The skill becomes a trivial reader of the pre-ranked list. |

PR 2 deletes the grammar block PR 1 added — it's no longer needed once the
pre-ranked field exists.

## DSL grammar (7 operator classes)

These are the `satisfiedWhen` operators evaluated against `signalsSummary`:

| Syntax | Meaning |
|--------|---------|
| `path` | Truthy — non-null, non-zero, non-empty string; `"0"` and `"false"` are also falsy |
| `!path` | Falsy |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison |
| `path=v` or `path=v\|w\|x` | Equals (or equals one of) |
| `path!=v` | Not equals |
| `path~regex` | Array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates
to **true** → action is satisfied → filter it out, don't surface as a TODO.

## Architecture after PR 2

```
app/data/rubric.json  (DSL strings live here, unchanged)
         │
         ▼
scripts/predicate.mjs          ← NEW canonical evaluator (pure ESM)
         │
   ┌─────┴────────────────────┐
   ▼                          ▼
scripts/run-assessment.mjs    app/lib/assessment.ts
├ ranks + filters nextActions  └ re-exports evaluatePredicate
└ writes rankedNextActions[10]   (1-line passthrough; dashboard
         │                        re-evals fresh for ✓ marks)
         ▼
app/data/assessment.json
(new field: rankedNextActions)
         │
         ▼
SKILL.md reads [0..2] verbatim
```

## `rankedNextActions` output schema

Each entry in the new top-level `assessment.json.rankedNextActions` array
carries:

```jsonc
{
  "dimId": "scheduled",
  "actionId": "promote-routine",
  "axis": "platform",
  "weight": 2,
  "deficit": 25,
  "rank": 50,           // weight × deficit
  "action": "Promote repeating patterns to a Routine…",
  "effort": "30min",
  "borisTip": 61,
  "satisfiedWhen": "scheduleCommandUses>=1"
}
```

Limit is **10** (constant). The skill consumes `[0..2]`.

Sort order: `rank` descending → axis (`platform` → `execution` → `either`) →
`weight` descending → `dimId` ascending → `actionId` ascending. Deterministic
across runs on identical machine state.

## Hard rule introduced in PR 2

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation. Test
> `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
> reference-equal; a duplicate fails CI.

## Testing

Three new test files ship with PR 2:

- **`scripts/__tests__/predicate.test.mjs`** — one test per operator class,
  plus a rubric integration test that iterates every `satisfiedWhen` in
  `rubric.json` and asserts each parses without throwing.
- **`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven ranker
  tests including a named regression for the `loopCommandUses=14 vs >=1` bug.
- **`app/lib/__tests__/predicate-passthrough.test.ts`** — reference-equality
  check between the TS re-export and the MJS source.

The existing `run-assessment` tests are extended to assert `rankedNextActions`
is written with the required keys and length ≤ 10.
