---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# One predicate evaluator, one ranking function

PR #106 closes the second half of a recurring bug class: the `/self-assessment`
skill re-implementing `satisfiedWhen` filtering and weight×deficit ranking
itself, which meant an already-satisfied rubric action could resurface as a
TODO whenever the skill's copy of the logic drifted from the scorer's. The fix
isn't a smarter re-implementation — it's removing the second implementation
entirely.

## Single canonical evaluator

The `satisfiedWhen` DSL (`path`, `!path`, `>=`/`<=`/`>`/`<`, `=`/`!=` with
`|`-separated literals, `~regex` against string arrays, `&`-joined AND) now
has exactly one implementation: `scripts/predicate.mjs`. Its `evaluatePredicate`
function is a pure-ESM port with no dependency on Node's TypeScript tooling, so
both callers can share it:

- `scripts/rank-next-actions.mjs` and `scripts/run-assessment.mjs` import it
  directly for the Node-side scoring pipeline.
- `app/lib/assessment.ts` no longer contains its own copy. Its `evaluatePredicate`
  export collapses to a one-line passthrough:

  ```ts
  import { evaluatePredicate } from "../../scripts/predicate.mjs";
  export { evaluatePredicate };
  ```

The two can't silently diverge again because
`app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality —
`fromTs` (imported through `@/app/lib/assessment`) and `fromMjs` (imported
directly from `@/scripts/predicate.mjs`) must be the exact same function
object, not just behaviorally equivalent ones. If someone reintroduces a
second implementation, the test fails on `expect(fromTs).toBe(fromMjs)`
rather than waiting for a scoring discrepancy to surface downstream.

CLAUDE.md now states this as a hard rule: `scripts/predicate.mjs` is
canonical, and `evaluatePredicate` in the TS layer "must remain a 1-line
passthrough re-export — never copy the implementation." When the DSL grammar
evolves, the rule says to edit `scripts/predicate.mjs` and the rubric
`$schema` comment — never the TS file.

## Pre-computed ranking, not a client-side re-derivation

The second half of PR #106 is `scripts/rank-next-actions.mjs`, which exports
`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`. It walks every
`rubric.dimensions[].nextActions[]`, drops any action whose `satisfiedWhen`
evaluates true against `signalsSummary` via the shared `evaluatePredicate`,
and ranks what's left by `weight × deficit` — `deficit` being the Platform
Setup gap (`100 - score`) or the Execution gap (`100 - executionScore`),
selected by the action's `axis` (defaulting to `"platform"` if a
`satisfiedWhen` is present, `"either"` otherwise).

Ties are broken deterministically through a five-tier cascade so the same
input always produces the same order:

1. `rank` descending (`weight × deficit`)
2. `axis` (`platform` before `execution` before everything else, including
   unrecognized axis values — the `axisOrder()` helper buckets any unknown
   axis alongside `"either"` rather than ahead of `"platform"`)
3. `weight` descending
4. `dimId` ascending
5. `actionId` ascending

`scripts/__tests__/rank-next-actions.test.mjs` pins this exact cascade,
including a malformed-action case (a `nextActions` entry missing its `action`
field is silently skipped rather than crashing the pipeline) and a dimension
missing from `scoreMap` (skipped, not thrown).

`run-assessment.mjs` wires the function in directly — `main()` builds
`scoreMap` from `scored.scores`, calls
`rankNextActions(rubric, scoreMap, signalsSummary, 10)`, and writes the result
onto `assessment.rankedNextActions` before the file hits disk. Every
`npm run assess` now writes a pre-computed top-10 array; nothing downstream
re-derives it.

`scripts/__tests__/run-assessment-ranking.test.mjs` and
`scripts/__tests__/predicate.test.mjs` cover the wiring and the DSL grammar
respectively, on top of the passthrough and ranking unit tests above.

## What the skill does now

`.claude/skills/self-assessment/SKILL.md` used to filter and sort next-actions
itself. It now just reads the array:

> Top 3 priority actions, noting which axis each falls on. Read
> `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
> actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`. Each entry carries `dimId`, `actionId`,
> `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`,
> `satisfiedWhen`.

CLAUDE.md now carries a matching hard rule under "Ranked next-actions live in
`assessment.json.rankedNextActions`": the self-assessment skill must never
hand-implement the `satisfiedWhen` filter or the weight×deficit ranking again
— read the pre-computed array from the written file. Surfacing a satisfied
action as a TODO is treated as a regression in the data layer, not something
to patch in the report.

## Why this shape

Both fixes follow the same principle: a bug that stems from two
implementations of the same logic drifting apart isn't fixed by correcting
one of them — it's fixed by deleting one of them. `scripts/predicate.mjs`
is the DSL's only implementation, enforced by a reference-equality test.
`rank-next-actions.mjs` is the ranking's only implementation, consumed
pre-computed from `assessment.json` rather than re-derived per-caller. Any
future consumer that needs a top-N next-actions list — a new dashboard
panel, a different slash command — reads the same array instead of writing
a third copy of the filter.
