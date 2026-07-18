---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# One evaluator, one ranked list: closing the `satisfiedWhen` re-implementation gap

PR #106 removes a bug class rather than a single bug. The tactical fix
(PR #104, SKILL.md grammar documentation) had already landed; this PR is the
structural close-out that makes the mistake impossible to repeat by deleting
the second implementation and precomputing the one artifact any consumer
actually needs.

## What went wrong

The rubric's `satisfiedWhen` field is a small string DSL — `"loopCommandUses>=1"`,
`"permissionsDefaultMode=auto & !skipDangerous"` — evaluated against the flat
`signalsSummary` object to decide whether a next-action is already done. A
model re-implementing that filter guessed the wrong shape: it treated the
string as an object literal (`{field, op, value}`) instead of parsing the
DSL. The evaluator silently returned null, the filter did nothing, and an
already-satisfied action (`babysit-loop`, with `loopCommandUses=14`) surfaced
as a top-3 priority next-action anyway.

Two structural conditions made that guess possible: the evaluator existed in
two places, and no consumer was forced to use either of them — the ranked
list itself didn't exist yet, so anyone downstream (the `/self-assessment`
skill) had to hand-roll the filter/rank logic from the raw rubric.

## The fix: one evaluator, reference-checked

`scripts/predicate.mjs` is now the **only** implementation of the DSL
grammar — atom splitting on `&`, the `!`/`>=`/`<=`/`!=`/`=`/`>`/`<`/`~`
operators, truthy fallback for a bare path. `app/lib/assessment.ts` no longer
contains a parallel implementation; it does exactly this:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

That's enforced, not just conventional.
`app/lib/__tests__/predicate-passthrough.test.ts` imports `evaluatePredicate`
from both the TS module and the `.mjs` source and asserts they're
**reference-equal** (`expect(fromTs).toBe(fromMjs)`) — a copy-pasted
duplicate would still pass a behavioral test suite but fails this one
immediately, because a duplicate function is never `===` the original. If
the DSL grammar evolves, the rule (per CLAUDE.md) is: edit
`scripts/predicate.mjs` and the rubric's `$schema` comment — never the TS
file.

## The fix: precompute the ranked list, don't let consumers re-derive it

The other half closes the actual attack surface: even a correct evaluator
doesn't help if every consumer re-implements the *filter and rank* logic
around it. `scripts/rank-next-actions.mjs` now does that once, at
assessment-write time, and the result is stored in
`assessment.json.rankedNextActions`.

`rankNextActions(rubric, scoreMap, signalsSummary, limit)` walks every
dimension's `nextActions`, skips actions whose `satisfiedWhen` evaluates
true against `signalsSummary`, computes `rank = weight × deficit` (deficit
drawn from the dimension's Platform Setup or Execution score depending on
the action's `axis`), and returns the sorted, limited array. The tie-break
chain is deterministic: `rank → axis order (platform, execution, either) →
weight → dimId → actionId` — so the same signals always produce the same
top-10, byte for byte. Malformed entries (no `action` text) are skipped
silently rather than crashing the run.

`scripts/__tests__/rank-next-actions.test.mjs` pins the regression by name:
a `loopCommandUses>=1` predicate given `loopCommandUses: 14` must exclude
`babysit-loop` from the output — the exact scenario that shipped as a
top-3 priority in the original incident.

Downstream, the `/self-assessment` skill's contract changed from "compute
the priority list" to "read the precomputed one":

> Top 3 priority actions, noting which axis each falls on. Read
> `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
> actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`. Each entry carries `dimId`, `actionId`,
> `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`,
> `satisfiedWhen`.

There is no longer a code path where the skill (or any future consumer —
the `/methodology` page, a CLI report) hand-implements the `satisfiedWhen`
filter. It reads an array.

## Why this shape, not a lighter touch

The instinct after a bug like this is to patch the guess — teach the model
the correct DSL shape via better docs (that's what PR #104 did) — and stop.
CLAUDE.md's framing of this pattern is explicit about why that's
insufficient on its own: a documentation fix reduces the *probability* of
the same mistake; removing the second implementation and precomputing the
output removes the *opportunity*. As long as two evaluators existed, a
future re-implementation could still diverge from either one and no test
would catch it structurally — the passthrough test only exists because the
duplicate was deleted, not the other way around. And as long as the ranked
list wasn't a first-class artifact, every consumer was one hand-rolled
filter away from repeating the incident, DSL correctness notwithstanding.

## Reference

- Evaluator: `scripts/predicate.mjs`
- Passthrough + enforcement test:
  `app/lib/assessment.ts`,
  `app/lib/__tests__/predicate-passthrough.test.ts`
- Ranking: `scripts/rank-next-actions.mjs`,
  `scripts/__tests__/rank-next-actions.test.mjs`
- Write-time wiring: `scripts/run-assessment.mjs`
  (`rankNextActions(...)` → `assessment.json.rankedNextActions`)
- Consumer contract: `.claude/skills/self-assessment/SKILL.md`
