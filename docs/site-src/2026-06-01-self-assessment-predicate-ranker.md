---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate ranker: `satisfiedWhen` DSL and ranked next-actions

**2026-06-01 · PR [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)**

## Problem

The `/self-assessment` skill was hand-implementing the `satisfiedWhen` filter
instead of using the scorer's own evaluator. The hand-rolled version handled
truthy-path checks but skipped string-form numeric comparisons, treating them
as bare signal names. Because any non-empty string is truthy, every predicate
written as `"loopCommandUses >= 1"` evaluated to _unsatisfied_ regardless of
the actual counter value.

The concrete failure: `/loop` surfaced in the top-3 priority list despite
`loopCommandUses=14` satisfying its predicate. The skill was producing false
positives — reporting satisfied next-actions as open gaps.

## Fix strategy (two PRs)

**PR #104 — documentation stopgap.**
Add an authoritative DSL grammar block to `.claude/skills/self-assessment/SKILL.md`
so the model can evaluate any predicate form correctly at inference time.
Reduces false positives immediately while the structural fix is built.

**PR 2 — structural fix.**
Move evaluation entirely out of the skill's inference context:

1. Extract `evaluatePredicate` to `scripts/predicate.mjs` as the single
   canonical evaluator. `app/lib/assessment.ts` becomes a 1-line passthrough
   re-export — no copy of the logic.
2. Pre-compute ranked next-actions in `run-assessment.mjs` right after scoring:
   filter to unsatisfied predicates, rank by weight × deficit, take top 10.
3. Write the result to `assessment.json` under `rankedNextActions`.
4. Reduce the skill to a trivial reader: pull `rankedNextActions[0..2]` from
   the file. No filter logic, no ranking, no predicate evaluation.

After PR 2, the skill cannot re-introduce false positives by misreading operator
forms. Ranking and filtering happen at score-write time, not at report time.

## `satisfiedWhen` DSL

The rubric's `satisfiedWhen` fields use a seven-class operator grammar. All
evaluation must go through `scripts/predicate.mjs` — never re-implement it
inline.

```
satisfiedWhen ::= truthy-path | falsy-path | numeric-compare | equality
               | membership | conjunction | version-check

truthy-path     ::= "<signal>"                 // signal is truthy / non-zero
falsy-path      ::= "!<signal>"                // signal is falsy or absent
numeric-compare ::= "<signal> <op> <N>"        // op: > >= < <= ==
equality        ::= "<signal> == <string>"     // string equality
membership      ::= "<signal> in [v1,v2,…]"   // set membership
conjunction     ::= "<expr> && <expr>"         // both must hold
version-check   ::= "<signal> semver <range>"  // semver range (rare)
```

The root cause of the original bug: a predicate like `"loopCommandUses >= 1"`
is a string, so the hand-rolled evaluator read it as a truthy-path check against
a signal named literally `"loopCommandUses >= 1"`. That signal doesn't exist,
so it returned `undefined` — which JavaScript coerces to falsy — making the
predicate appear unsatisfied regardless of the counter's value.

## Invariants enforced after PR 2

- `scripts/predicate.mjs` is the evaluator. `app/lib/assessment.ts:evaluatePredicate`
  re-exports it with a 1-line passthrough. A CI test
  (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts the two are
  reference-equal; a copied implementation fails the suite.
- `assessment.json.rankedNextActions` is always the pre-computed source of truth.
  The skill reads from it directly and must never hand-implement filtering or
  ranking logic. Surfacing a satisfied action as a TODO again is a scorer bug,
  not a skill bug — fix the data layer.
- When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric
  `$schema` comment. Never edit the TS re-export.
