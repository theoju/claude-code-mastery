---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# One predicate evaluator, precomputed once

PR #106 closes out a bug class that had already needed one tactical patch
(PR #104) before it got a structural fix. The short version: a model
hand-wrote a Node ranker for the self-assessment skill that misread
`satisfiedWhen` as a `{field, op, value}` object. The rubric's actual grammar
is a string DSL — `"loopCommandUses>=1"` — so the misreading silently
returned `null`, skipped the filter, and surfaced an already-satisfied action
(`babysit-loop`, with `loopCommandUses` at 14) as a top-3 priority. PR #104
patched the immediate symptom with a grammar block in `SKILL.md`. PR #106 is
the fix that makes the mistake structurally hard to repeat.

## One evaluator, not two

`scripts/predicate.mjs` is now the single canonical implementation of the
`satisfiedWhen` DSL. It's a pure-ESM module with no dependencies, and it
handles the whole grammar in one function:

- `path` — truthy check (`isTruthy` treats `null`/`undefined`/`0`/`""`/`"0"`/`"false"` as false)
- `!path` — negation
- `path>=N`, `<=N`, `>N`, `<N` — numeric comparison (operators matched longest-first so `>=` never parses as `>`)
- `path=v` or `path=v|w|x` — equals one of; `path!=v` — not-equals
- `path~regex` — case-insensitive regex match against elements of an array-valued path
- `A & B` — AND of two or more atoms (`.every()` over the atoms)

`app/lib/assessment.ts` no longer carries its own TypeScript implementation.
It re-exports the mjs module directly:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

That's a 1-line passthrough, not a reimplementation, and it's held there by a
dedicated test: `app/lib/__tests__/predicate-passthrough.test.ts` imports
`evaluatePredicate` from both `@/app/lib/assessment` and
`@/scripts/predicate.mjs` and asserts `toBe` (reference equality, not just
behavioral equivalence). If someone reintroduces a duplicate TS
implementation, this test fails immediately rather than waiting for scores to
drift apart.

CLAUDE.md now states this as a hard rule: **`scripts/predicate.mjs` is
canonical. Never copy the implementation** — when the DSL grammar evolves,
edit `scripts/predicate.mjs` and the rubric's `$schema` comment, not the TS
file.

## The ranking moved out of the skill, into the data

The second half of the fix is `scripts/rank-next-actions.mjs`. Before this
PR, "what are the top 3 next actions" was something the self-assessment skill
worked out at read time — which is exactly the surface where the buggy
hand-rolled ranker lived. Now `rankNextActions(rubric, scoreMap,
signalsSummary, limit)` runs once, inside `run-assessment.mjs`, right after
scoring:

- Walks every dimension's `nextActions`, skipping any action whose
  `satisfiedWhen` evaluates true against `signalsSummary` (via the same
  canonical `evaluatePredicate`).
- Computes a per-dimension deficit — `100 - score` for platform-axis actions,
  `100 - executionScore` for execution-axis actions — and ranks by
  `weight × deficit`.
- Ties break, in order: axis (platform before execution before either),
  then weight, then `dimId`, then `actionId` — deterministic output for
  identical input, no incidental ordering from object iteration.
- Returns the top `limit` (default 10) entries, each carrying `dimId`,
  `actionId`, `axis`, `weight`, `deficit`, `rank`, `action`, `effort`,
  `borisTip`, and `satisfiedWhen`.

The result is written straight into `assessment.json.rankedNextActions`.
`SKILL.md` now tells the skill to *read* that array's first three entries
rather than recompute anything:

> Top 3 priority actions, noting which axis each falls on. Read
> `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
> actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

CLAUDE.md carries the corresponding hard rule: the self-assessment skill
must never hand-implement the `satisfiedWhen` filter or the weight×deficit
ranking — read the precomputed list from the written file. Surfacing a
satisfied action as a TODO again would be a regression in the data layer,
not a one-off skill bug, and should be fixed there.

## Why this shape, not a smaller patch

The tactical fix (PR #104) — adding a grammar block to `SKILL.md` — reduced
the odds of the mistake recurring but didn't remove the opportunity: a
future skill invocation (or a different agent entirely) could still
hand-write a ranker against the rubric's `nextActions` and get the grammar
wrong again, because nothing stopped it from trying. Centralizing evaluation
in one module and precomputing the ranked list removes the reimplementation
surface itself — there's no ranking logic left in the skill to get wrong.

Test coverage lands at both layers: `scripts/__tests__/predicate.test.mjs`
exercises the DSL directly, `scripts/__tests__/rank-next-actions.test.mjs`
covers the filter/sort/limit contract, and
`scripts/__tests__/run-assessment-ranking.test.mjs` checks the field wired
end-to-end into the written `assessment.json`.

## Where this belongs longer-term

This page lives at the root of the `core` lens because no `architecture`
section exists yet under `docs/site-src/core/` — only an `images/`
directory. If an architecture section gets scaffolded, this content (the
canonical-`predicate.mjs` rule and the TS-passthrough contract) is a good
candidate to fold into an evergreen architecture reference page rather than
staying pinned to a single PR's dateline.
