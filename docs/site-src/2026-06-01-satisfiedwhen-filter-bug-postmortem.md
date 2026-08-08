---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Postmortem: the `satisfiedWhen` filter bug (and why the fix is structural, not tactical)

On 2026-05-31, a top-3 priority action surfaced in a `/self-assessment` run
that was already done. The action was `babysit-loop` (Boris tip 48, "start
with one loop"), scored under the `scheduled` dimension — and the user had
already run `/loop` at least once. It should have been filtered out. It
wasn't.

## Root cause

`rubric.json` next-actions gate on a `satisfiedWhen` field, and that field is
a **string DSL**, not a structured object. The grammar (documented at the top
of `scripts/predicate.mjs`) is small:

```
path                  — truthy
!path                 — falsy
path>=N / <=N / >N / <N — numeric comparison
path=v / path=v|w|x   — equals (or one-of)
path!=v                — not equals
path~regex             — array-of-strings element matches regex
A & B                  — AND of atoms
```

The `babysit-loop` action's actual predicate is the string
`"loopCommandUses>=1"` — confirmed in
`scripts/__tests__/rank-next-actions.test.mjs`, which uses this exact
dimension/action pair as its fixture.

The model that produced the 2026-05-31 report didn't call the shared
evaluator. It hand-wrote its own Node-based ranker, and modeled
`satisfiedWhen` as an object shape (`{field, op, value}`) — a plausible
enough guess for a "predicate," but not what the rubric contains. Handed a
plain string, that evaluator had no matching branch, silently returned
`null`/falsy for "is this satisfied," and the filter step let the action
through. Nothing threw. Nothing logged a shape mismatch. The bug was invisible
until a human noticed the report recommending something already done.

## First attempt: PR #104 (tactical)

The first fix added a grammar note to the `self-assessment` skill's
`SKILL.md`, pointing future runs at the correct string-DSL shape. That closes
the gap for a model that reads the skill file carefully before improvising a
ranker — but it does nothing to stop the next model, or the next session,
from re-deriving its own evaluator from scratch and making the same
structural assumption. The failure mode wasn't "the DSL is undocumented," it
was "there are two independent implementations of the same logic, and only
one of them is exercised by tests."

## The structural fix: PR #106

PR #106 removes the second implementation instead of documenting around it.

**One canonical evaluator.** `scripts/predicate.mjs` is now the single
source of truth for `evaluatePredicate`. `app/lib/assessment.ts` no longer
carries its own copy — it does a one-line passthrough re-export:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` enforces this at the
reference-equality level (`expect(fromTs).toBe(fromMjs)`), not just the
behavioral level — a future contributor who pastes the implementation back
into the TS file (even if the paste is byte-for-byte correct) fails CI
immediately, before any behavioral drift could occur.

**Pre-computed, not re-derived.** The bug happened because a consumer
(a model composing a report) re-implemented the filter/ranking logic
inline, in the moment, under token pressure. PR #106 removes that
temptation by moving the filter-and-rank step out of the consumer
entirely. `scripts/rank-next-actions.mjs` exports `rankNextActions()`,
which:

- iterates every dimension's `nextActions`,
- skips any action whose `satisfiedWhen` evaluates true against
  `signalsSummary` (via the canonical `evaluatePredicate`),
- computes a `weight × deficit` rank per remaining action (deficit taken
  from the Platform or Execution axis depending on `axis`),
- sorts by rank with a deterministic tie-break (axis order, then weight,
  then `dimId`, then `actionId`),
- and returns the top N (default 10).

`scripts/run-assessment.mjs` calls this once per run and writes the result
into `assessment.json` as `rankedNextActions`. Every field a downstream
consumer needs — `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`,
`action`, `effort`, `borisTip`, `satisfiedWhen` — is already resolved and
sitting in the JSON. There is no filter left for a consumer to get wrong,
because there is no filter left for a consumer to write.

The `self-assessment` skill's `SKILL.md` now points directly at this
contract: report the top 3 priority actions by reading
`assessment.json.rankedNextActions[0..2]`, described there as "already
filtered (satisfied actions dropped) and ranked by `weight × deficit`."

## Why this closes the bug class, not just the instance

The tactical fix (#104) reduced the *probability* of recurrence by making the
correct grammar easier to find. The structural fix (#106) removes the
*opportunity* for recurrence: there is exactly one evaluator, it's
reference-equality-tested against duplication, and the one place that used to
need a bespoke ranking implementation now reads a precomputed array instead.
A model can no longer mismodel `satisfiedWhen` while producing a
self-assessment report, because producing that report no longer involves
evaluating `satisfiedWhen` at all.

This is now a repo-level rule (see the project's `CLAUDE.md`, "Ranked
next-actions live in `assessment.json.rankedNextActions`"): the
`self-assessment` skill must never hand-implement the `satisfiedWhen` filter
or the weight × deficit ranking again. Surfacing a satisfied action as a
TODO is treated as a data-layer regression, not a report-writing mistake —
fix `scripts/rank-next-actions.mjs` or `scripts/predicate.mjs`, never the
report.

## Verification

- `scripts/__tests__/predicate.test.mjs` exercises the DSL grammar directly
  (truthy/falsy, comparisons, equals/one-of, array-regex, AND-of-atoms).
- `scripts/__tests__/rank-next-actions.test.mjs` reproduces the original
  incident's shape as a fixture: a `scheduled` dimension with a
  `babysit-loop` action gated on `loopCommandUses>=1`, asserting it's
  dropped once the signal is satisfied.
- `scripts/__tests__/run-assessment-ranking.test.mjs` feeds
  `run-assessment.mjs`'s own `buildSignalsSummary()` output through
  `scoreAll()` and `rankNextActions()` together, asserting the pipeline
  produces ≤10 well-shaped entries and that ranking is deterministic
  across repeated runs on identical input.
- `app/lib/__tests__/predicate-passthrough.test.ts` guards against the
  duplication regressing.
