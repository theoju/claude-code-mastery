---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# `satisfiedWhen` DSL: predicate grammar and ranker contract

## Context

On 2026-05-31, a model running `/self-assessment` hand-wrote a next-action filter
that expected each `satisfiedWhen` field to be a structured object —
`{field, op, value}`. The rubric encodes predicates as flat string expressions
(`"loopCommandUses>=1"`). The mismatch caused every predicate evaluation to
return `null`, bypassing the satisfied-action filter entirely. Already-satisfied
next-actions — including `babysit-loop` with 14 recorded loop uses — surfaced
as top-priority recommendations.

PR #104 is a tactical guard: it adds a 12-line grammar block to `/self-assessment`
SKILL.md so models reading the skill doc can't hallucinate the wrong shape. A
structural fix (PR 2) moves pre-ranked next-actions into
`assessment.json.rankedNextActions`, making the filter a data-read instead of a
model-side predicate evaluation.

## DSL grammar

Every `satisfiedWhen` value in `app/data/rubric.json` is a single string matching
this grammar:

```
expression  ::= field operator value
field       ::= [a-zA-Z][a-zA-Z0-9_]*
operator    ::= ">=" | "<=" | "==" | "!=" | "in" | "not-in" | "bool"
value       ::= number | quoted-string | "[" item,... "]" | "true" | "false"
```

The seven operator classes:

| Operator | Example | Passes when |
| -------- | ------- | ----------- |
| `>=` | `"loopCommandUses>=1"` | field value ≥ threshold |
| `<=` | `"hookCount<=3"` | field value ≤ threshold |
| `==` | `"effortLevel==max"` | field equals value |
| `!=` | `"effortLevel!=default"` | field does not equal value |
| `in` | `"effortLevel in [max,high]"` | field is one of the list members |
| `not-in` | `"model not-in [default]"` | field is not in the list |
| `bool` | `"hasAgents bool true"` | field is truthy/falsy per value |

The canonical evaluator is `scripts/predicate.mjs` (authoritative).
`app/lib/assessment.ts:evaluatePredicate` is a 1-line passthrough re-export —
never re-implement the logic inline. A test
(`app/lib/__tests__/predicate-passthrough.test.ts`) asserts reference equality
between the two; a duplicate implementation fails CI.

## Decision rationale

The grammar-block approach is deliberately narrow:

1. **Tactical, not structural.** Documenting the grammar in SKILL.md prevents
   the hallucination class without changing the scoring contract. It is
   explicitly temporary — it will be removed once the structural fix lands.
2. **No model-side filtering in the final state.** The follow-up PR
   (`scripts/rank-next-actions.mjs` + `assessment.json.rankedNextActions`) moves
   the filter and weight×deficit sort to the scorer. The skill reads a
   pre-computed top-10 list instead of evaluating predicates at runtime.
3. **Single evaluator, no copies.** The DSL has one implementation
   (`scripts/predicate.mjs`). The rule is enforced by CI; parallel
   implementations silently diverge and are disallowed.

## What changes in PR 2

- `scripts/rank-next-actions.mjs` implements the `satisfiedWhen` filter plus
  weight×deficit sort.
- `assessment.json` gains a `rankedNextActions` array (top-10) written on every
  `npm run assess`.
- `/self-assessment` SKILL.md is updated to read from `rankedNextActions`; the
  grammar block is removed.
- CLAUDE.md gains the hard rule: _"Ranked next-actions live in
  `assessment.json.rankedNextActions`. The self-assessment skill must NEVER
  hand-implement the `satisfiedWhen` filter or the weight×deficit ranking."_

Surfacing a satisfied action as a priority recommendation after that contract
lands is a data-layer regression — fix `rank-next-actions.mjs`, not the skill.

## References

- Canonical evaluator: `scripts/predicate.mjs`
- Design spec: `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-31-predicate-ranker.md`
- Source PR: [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)
