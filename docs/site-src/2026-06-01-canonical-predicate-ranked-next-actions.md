---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Canonical Predicate Evaluator and Ranked Next-Actions

PR #106 established two contracts that every contributor and consumer of the
scoring pipeline must respect: a single canonical DSL evaluator for
`satisfiedWhen` predicates, and a pre-computed `rankedNextActions` array
written into `assessment.json` on every `npm run assess` run.

## The one-evaluator rule

`scripts/predicate.mjs` is the **only** implementation of the `satisfiedWhen`
DSL. `app/lib/assessment.ts` re-exports it as a one-line passthrough — never
a copy. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts
the two are reference-equal; a duplicate implementation fails CI.

When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric
`$schema` comment. Never touch the TypeScript file beyond keeping the
re-export current.

## rankedNextActions contract

Every `npm run assess` run writes a `rankedNextActions` field into
`app/data/assessment.json`. Its shape:

```json
{
  "rankedNextActions": [
    {
      "id": "string",
      "title": "string",
      "dimension": "string",
      "weight": 1,
      "deficit": 42,
      "score": 58,
      "satisfied": false
    }
  ]
}
```

The array contains **at most 10 entries**. It is pre-filtered to unsatisfied
actions only (`satisfied === false`) and sorted descending by `weight ×
deficit`. Satisfied actions are excluded before ranking — a
previously-satisfied action appearing in the list is a data-layer bug in
`scripts/rank-next-actions.mjs`, not a display concern for the consumer.

### Ranking formula

```
priority = weight × deficit
deficit  = 100 − normalizedScore
```

`weight` comes from `app/data/rubric.json` (1–3 per dimension).
`normalizedScore` is the per-dimension Platform Setup score
(`clamp(round(rawScore / target × 100))`). Higher-weighted, lower-scoring
dimensions sort first.

## How to consume the list

Read `rankedNextActions` directly from `assessment.json`. Do not re-implement
the filter or the ranking formula:

```ts
import assessment from "@/data/assessment.json";

// already filtered (unsatisfied only), ranked (weight × deficit desc), top-10
const topActions = assessment.rankedNextActions;
```

The self-assessment skill (`.claude/commands/self-assessment.md`) follows
this pattern — it reads the pre-computed top-10 rather than applying
`satisfiedWhen` predicates at report time. Callers that hand-implement the
ranking risk surfacing satisfied actions as TODOs, or producing a sort order
that diverges from what the dashboard displays.

## What not to do

- **Don't copy the DSL evaluator.** `app/lib/assessment.ts` is the
  proof: one line, one re-export. A second implementation will drift.
- **Don't re-filter or re-rank at call time.** `rankedNextActions` is
  authoritative at the point `npm run assess` writes it. If the order
  looks wrong, fix `scripts/rank-next-actions.mjs` or the rubric weights —
  not the consumer.
- **Don't hand-implement `satisfiedWhen` filtering in a skill or slash
  command.** The pre-computed list was introduced precisely to remove that
  pattern from the self-assessment skill. Reintroducing it is a regression
  against the CLAUDE.md hard rule: _"Ranked next-actions live in
  `assessment.json.rankedNextActions`. The self-assessment skill must NEVER
  hand-implement the satisfiedWhen filter or the weight×deficit ranking."_

## Files involved

| File | Role |
| ---- | ---- |
| `scripts/predicate.mjs` | Canonical DSL evaluator — sole source of truth |
| `app/lib/assessment.ts` | Thin passthrough re-export (one line) |
| `app/lib/__tests__/predicate-passthrough.test.ts` | CI guard: asserts reference equality |
| `scripts/rank-next-actions.mjs` | Filters unsatisfied actions, sorts by `weight × deficit`, returns top-10 |
| `scripts/run-assessment.mjs` | Calls `rank-next-actions.mjs`; writes result into `assessment.json` |
| `app/data/assessment.json` | Output: `rankedNextActions[10]` present after every `npm run assess` |
| `app/data/rubric.json` | Source of `weight` values used in the ranking formula |
