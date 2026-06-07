---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Canonical predicate evaluator and ranked next-actions

PR #106 fixes a recurring bug class: the `satisfiedWhen` DSL was being
re-implemented in multiple places, and each re-implementation could drift
from the scorer's canonical logic. The fix is a single authoritative
module, a machine-enforced passthrough in the app layer, and pre-computed
output stored in `assessment.json` so every consumer reads the same result.

## What changed

**`scripts/predicate.mjs`** is now the one source of truth for the
`satisfiedWhen` DSL evaluator. All evaluation goes through this module.

**`scripts/rank-next-actions.mjs`** is a new module that exposes:

```js
rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)
```

It filters next-actions to those not yet satisfied, ranks by
`weight × deficit`, and returns the top `limit` entries. Called once at
assessment time; the result is written to `assessment.json` as
`rankedNextActions`.

**`app/lib/assessment.ts`** is reduced to a one-line passthrough
re-export of the canonical evaluator. It no longer contains any DSL
logic of its own:

```ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

A CI test (`predicate-passthrough.test.ts`) asserts the two exports are
reference-equal. If the TS file ever grows its own implementation, the
test fails.

**The self-assessment skill** (`SKILL.md`) now reads
`assessment.json.rankedNextActions[0..2]` directly instead of
re-implementing the filter and ranking inline.

## Why this matters

The self-assessment skill had a recurring failure mode: the model
hand-reimplemented the `satisfiedWhen` filter when composing its report,
producing rankings that could diverge from what the scorer computed. A
satisfied next-action could surface as a TODO; an unsatisfied one could
be silently dropped.

The fix removes the root cause. `rankNextActions` runs once at
`npm run assess` time, stores its output, and every downstream
consumer — skill, dashboard, methodology page — reads that pre-computed
list. There is no second ranking path.

## Regression test

A named test covers the specific failure that prompted this: given a
signal of `loopCommandUses=14`, the `babysit-loop` next-action must be
absent from the ranked output (because the predicate is satisfied). The
test name is `loopCommandUses=14 excludes babysit-loop from ranked
output`.

## Contract: what must not drift

| Rule | Enforcement |
| --- | --- |
| `app/lib/assessment.ts` is a passthrough re-export | `predicate-passthrough.test.ts` (CI) |
| DSL grammar changes go through `scripts/predicate.mjs` only | Same test + code review |
| Pre-computed `rankedNextActions` is the source for all consumers | Skill reads `assessment.json` directly; dashboard has no inline ranker |

If you find yourself implementing `satisfiedWhen` logic outside
`scripts/predicate.mjs`, that's the bug. Read the stored result instead.

## File map

| Path | Role |
| --- | --- |
| `scripts/predicate.mjs` | Canonical DSL evaluator — single source of truth |
| `scripts/rank-next-actions.mjs` | Ranker: `rankNextActions(rubric, scoreMap, signalsSummary, limit)` |
| `app/lib/assessment.ts` | One-line passthrough re-export of the evaluator |
| `scripts/__tests__/predicate-passthrough.test.ts` | CI guard: asserts reference equality |
| `app/data/assessment.json` → `rankedNextActions` | Pre-computed top-10 written by `npm run assess` |
| `.claude/commands/self-assessment.md` | Reads `rankedNextActions[0..2]`; no inline ranker |
