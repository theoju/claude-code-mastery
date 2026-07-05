---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Fixing a silently-broken next-actions ranker (PR #106)

For a stretch of the v0.9.x cycle, the `/self-assessment` skill's "top 3
priority actions" list could surface an action the user had already
satisfied. The reference case: `babysit-loop` (Boris tip on running `/loop`
autonomously) showed up as a top-3 priority for a user whose
`loopCommandUses` signal was `14`. That's not a near-miss — it's the
opposite of what the rubric's `satisfiedWhen` field exists to prevent.

## What was actually wrong

A prior model had hand-written a next-actions ranker that treated
`satisfiedWhen` as if it were a structured object — something you could
destructure a field off of — rather than what it actually is: a string in
the rubric's own predicate DSL (`app/data/rubric.json`), e.g.
`"loopCommandUses>=1"`. Handed a string, the hand-rolled filter's object-shaped
check failed every time, the "is this already satisfied?" test silently
returned false for everything, and no next-action ever got filtered out —
including ones the user had clearly already adopted.

The bug shipped invisibly because nothing exercised the ranker against the
rubric's real DSL grammar. A fixture built to look like the intended shape
would have passed; only a satisfied real predicate against real
`signalsSummary` data exposed the gap.

## The fix: one evaluator, one ranker, both canonical

PR #106 is the structural close-out (2 of 2 in this cycle) that makes this
bug class structurally hard to reintroduce, by collapsing what had grown
into parallel implementations down to one of each.

**One predicate evaluator.** `scripts/predicate.mjs` is now the sole
implementation of the `satisfiedWhen` grammar — truthy path checks, `!path`
negation, `>=`/`<=`/`>`/`<`/`=`/`!=` comparisons, `path~regex` array
matching, and `&`-joined AND. `app/lib/assessment.ts` no longer contains a
second copy; it re-exports the `.mjs` function as a one-line passthrough:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

That passthrough is enforced, not just documented —
`app/lib/__tests__/predicate-passthrough.test.ts` asserts
`expect(fromTs).toBe(fromMjs)`, i.e. reference equality, not just behavioral
equivalence. If someone reintroduces a second implementation (even a
faithful one), that test fails. CLAUDE.md now states this as a hard rule:
edit `scripts/predicate.mjs` and the rubric `$schema` comment when the DSL
grammar evolves — never the TS file.

**One next-actions ranker.** `scripts/rank-next-actions.mjs` is a new,
narrowly-scoped module: for each rubric dimension, for each `nextAction`
with a `satisfiedWhen`, it calls the canonical `evaluatePredicate` against
`signalsSummary` and `continue`s past anything that evaluates true. What's
left is ranked by `weight × deficit` (`Math.max(0, 100 - score)` per axis,
platform vs. execution), with a fully deterministic tie-break: rank, then
axis order (platform before execution before either), then weight, then
`dimId`, then `actionId` — so two runs against identical signals produce an
identical top-10, never an ordering that depends on object-iteration order
or `Array.sort` stability quirks.

`scripts/run-assessment.mjs` calls `rankNextActions()` once per
`npm run assess` and writes the result into `assessment.json` as
`rankedNextActions` — a pre-computed, already-filtered array of at most 10
entries, each carrying `dimId`, `actionId`, `axis`, `weight`, `deficit`,
`rank`, `action`, `effort`, `borisTip`, and `satisfiedWhen`.

**The skill got simpler, not smarter.** `.claude/skills/self-assessment/SKILL.md`
no longer describes any filtering or ranking logic at all — it just points
at the array: "Read `assessment.json.rankedNextActions[0..2]` — already
filtered (satisfied actions dropped) and ranked by `weight × deficit` by
`scripts/rank-next-actions.mjs`." CLAUDE.md's "Ranked next-actions" rule
makes this a standing prohibition: the skill must never hand-implement the
`satisfiedWhen` filter or the weight×deficit ranking again. Surfacing a
satisfied action as a TODO a second time is a regression in the data layer,
not a documentation gap — fix `rank-next-actions.mjs`, not the skill's
reporting prose.

## Why this shape, specifically

The previous state had two failure surfaces stacked on top of each other:
a duplicated evaluator (drift risk — TS and JS could silently diverge) and
a hand-rolled ranker re-implementing filter+sort logic inline in whatever
consumed it (the exact place the original bug lived). Closing both in the
same PR means there is now exactly one place to fix the DSL and exactly one
place to fix the ranking — no second copy for a future edit to miss.

The test coverage mirrors that split:

- `scripts/__tests__/predicate.test.mjs` — DSL grammar correctness in
  isolation.
- `scripts/__tests__/rank-next-actions.test.mjs` — filtering + ranking
  correctness against a fixture rubric and `signalsSummary`.
- `scripts/__tests__/run-assessment-ranking.test.mjs` — the integration
  seam, confirming `rankedNextActions` actually lands in the written
  `assessment.json`.
- `app/lib/__tests__/predicate-passthrough.test.ts` — the identity
  guarantee that stops a second TS implementation from reappearing.

## Takeaway

If a `satisfiedWhen`-style DSL field looks like it could be modeled as a
plain object, check the schema comment before writing a consumer against
it — `app/data/rubric.json`'s `$schema` comment is the DSL's actual spec.
And when a bug traces to "logic re-implemented ad hoc at the point of use,"
the durable fix is usually to extract a canonical module and make the
single-source-of-truth property test-enforced, not just documented — a
reference-equality test costs one line and catches drift that a behavioral
test alone would miss if the duplicate happened to start out correct.
