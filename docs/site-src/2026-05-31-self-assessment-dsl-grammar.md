---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# `satisfiedWhen` DSL grammar

**Date:** 2026-05-31  
**Status:** Resolved — structural fix landed (see PR 2 below)

Each next-action entry in the rubric carries an optional `satisfiedWhen` field.
It is a **string predicate** evaluated against `signalsSummary`; when it returns
`true`, the action is already satisfied and gets dropped from the output before
the skill reads it. The string form is what the canonical evaluator expects.

## Incident

On 2026-05-31 a model running `/self-assessment` hand-wrote its own
`satisfiedWhen` filter. It expected an object shape `{field, op, value}` rather
than the string DSL (e.g. `"loopCommandUses>=1"`). The custom filter returned
`null` for every predicate, bypassing filtering entirely. Result:
`Start with one loop: /loop 30m /babysit` surfaced as a top-3 priority despite
`signalsSummary.loopCommandUses=14` — a field that satisfies `loopCommandUses>=1`
by a factor of 14.

## The grammar

`satisfiedWhen` is a **string**. Evaluate it with
`evaluatePredicate(expr, signalsSummary)`. Seven operator classes:

| Form | Semantics |
|---|---|
| `path` | Truthy: non-null, non-zero, non-empty string. `"0"` and `"false"` are also falsy. |
| `!path` | Falsy: inverse of the above. Missing field → `true`. |
| `path>=N` / `path<=N` / `path>N` / `path<N` | Numeric comparison. Missing field is treated as `0`. |
| `path=v` | String or numeric equality. |
| `path=v\|w\|x` | Equals any of the listed values (pipe-delimited; whitespace around `\|` is tolerated). |
| `path!=v` | Not equal. |
| `path~regex` | LHS must be an array of strings; `true` if any element matches the regex (case-insensitive). Non-array LHS → `false`. Unparseable regex → `false`. |
| `A & B` | AND of two or more atoms. Whitespace around `&` is tolerated. |

### Worked example

```
satisfiedWhen: "loopCommandUses>=1"
signalsSummary.loopCommandUses = 14
```

Evaluates to **`true`** → already satisfied → the action is **not** surfaced as a TODO.

### Error behavior

Unknown operators and missing signal fields do not throw. The evaluator returns
`false`, keeping the action in the output. Conservative: surface rather than hide.

## Fix — two PRs

### PR 1 — tactical (this PR, #104)

Added the grammar block above directly to
`.claude/skills/self-assessment/SKILL.md` beneath the "Top 3 priority actions"
bullet. A model reading the skill before calling `evaluatePredicate` could then
evaluate string predicates correctly. Explicitly temporary — deleted by PR 2.

**Files touched:** `.claude/skills/self-assessment/SKILL.md` (additive only).

### PR 2 — structural

1. Extracted the evaluator from `app/lib/assessment.ts` (lines 165–259) to a
   pure-ESM `scripts/predicate.mjs` with no external dependencies.
2. `app/lib/assessment.ts` became a 1-line re-export:
   `export { evaluatePredicate } from "../../scripts/predicate.mjs"`.
3. `scripts/run-assessment.mjs` imports `evaluatePredicate` and pre-computes
   the filtered + ranked top-10 list, writing it to
   `assessment.json.rankedNextActions`. The skill reads `[0..2]` verbatim — it
   never evaluates DSL strings itself.
4. The PR 1 grammar block in SKILL.md was deleted (now obsolete).
5. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts that
   the TS export and the MJS source are reference-equal, catching any future
   duplication of the implementation.

Design spec: `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`.

## Current state

The canonical evaluator is `scripts/predicate.mjs`.
`app/lib/assessment.ts:evaluatePredicate` is a 1-line passthrough.
`assessment.json.rankedNextActions` is pre-computed on every `npm run assess`
run. The skill is a trivial reader; it does not evaluate predicates.

| Consumer | Behavior |
|---|---|
| `/self-assessment` skill | Reads `assessment.json.rankedNextActions[0..2]` — already filtered and ranked. Does not evaluate DSL strings. |
| `app/methodology/probes` | Re-evaluates predicates at request time to render per-action ✓/✗ marks. |
| `app/dimensions/[id]` | Same — fresh evaluation per page load. |
