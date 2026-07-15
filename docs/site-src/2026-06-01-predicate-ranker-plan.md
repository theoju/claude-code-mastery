---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: retire the hand-rolled next-action filter

## The bug

`/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a
top-3 priority action despite `signalsSummary.loopCommandUses=14` clearly
satisfying that action's `satisfiedWhen` predicate (`loopCommandUses>=1`).

Root cause: the skill's instructions told the model to "first filter, then
rank" the rubric's `nextActions` itself, in-context. The canonical DSL
evaluator (`evaluatePredicate`) lived only in `app/lib/assessment.ts` —
TS-only, Next.js-coupled by location, with no Node-side caller the skill
could invoke. So the model hand-wrote its own filter, assumed an object
shape for `satisfiedWhen`, and skipped string predicates like
`loopCommandUses>=1` entirely. A satisfied action surfaced as a TODO.

## Decision

Stop asking the model to re-implement the DSL. Two PRs, tactical then
structural:

- **Tactical (PR #104):** document the `satisfiedWhen` grammar inline in
  `.claude/skills/self-assessment/SKILL.md` — an explicit reference for the
  eight operator classes (`path`, `!path`, `>=`/`<=`/`>`/`<`, `=`/`=v|w|x`,
  `!=`, `~regex`, `A & B`) so a careful model has a chance of evaluating
  predicates correctly by hand. This is a stopgap, not a fix — it reduces
  the odds of the bug recurring but doesn't remove the class.
- **Structural (follow-up PR):** extract `evaluatePredicate` out of
  `app/lib/assessment.ts` into a dependency-free, Node-shareable
  `scripts/predicate.mjs`. `scripts/run-assessment.mjs` then imports it,
  pre-computes the filtered + weight×deficit-ranked top-10 list once per
  run, and writes it to a new `assessment.json.rankedNextActions` field.
  The skill becomes a trivial reader of that field instead of an
  implementer of the DSL. Once the field exists, the PR #104 grammar block
  is deleted from `SKILL.md` as obsolete — the model no longer needs to
  know the grammar at all.

`app/lib/assessment.ts:evaluatePredicate` becomes a 1-line passthrough
re-export of `scripts/predicate.mjs`, never a second copy. This is now a
CLAUDE.md hard rule, enforced by
`app/lib/__tests__/predicate-passthrough.test.ts` asserting reference
equality between the two exports — a future contributor who copies instead
of re-exporting fails CI.

## Why this shape, not a dashboard fix

The dashboard's own render paths (`/methodology/probes`, `/dimensions/[id]`)
keep evaluating predicates fresh at request time for per-action ✓/✗ marks —
that's unchanged. `rankedNextActions` is a new, separate field that serves
only the skill, a future Slack-post integration, and console output. No DSL
grammar changes ship in either PR; this is a pure extraction plus a new
caller, not a semantics change.

## `rankNextActions` in one paragraph

For every rubric dimension, walk its `nextActions`. Skip any action whose
`satisfiedWhen` predicate evaluates true against `signalsSummary` — that's
the fix for the `/loop` bug, now backed by a named regression test. For
everything left, compute `rank = weight × deficit` (deficit pulled from
`executionScore` when the action is execution-axis, `score` otherwise), sort
descending by rank, then break ties deterministically — axis
(`platform` → `execution` → `either`), then weight, then `dimId`, then
`actionId`, both alphabetically. Slice to the top 10. Same machine state
always produces the same ranked list, matching the project's determinism
promise.

## Current state

The structural PR has landed: `.claude/skills/self-assessment/SKILL.md`
now instructs "Read `assessment.json.rankedNextActions[0..2]` — already
filtered (satisfied actions dropped) and ranked by `weight × deficit`," and
the PR #104 grammar block is gone from the skill. `scripts/predicate.mjs`
is the canonical evaluator; `app/lib/assessment.ts` re-exports it.

## Reference

Full design and testing plan:
[`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md).
