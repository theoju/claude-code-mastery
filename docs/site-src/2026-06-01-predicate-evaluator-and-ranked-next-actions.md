---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# One evaluator, one ranking step: closing the satisfiedWhen reimplementation bug

PR #106 removes a whole bug class by making it structurally impossible to
hand-reimplement the rubric's `satisfiedWhen` filter. There is now exactly
one predicate evaluator in the repo, and exactly one place that produces the
ranked next-actions list consumers read.

## What went wrong

`satisfiedWhen` is a small string DSL — things like `loopCommandUses>=1` or
`effortLevel=xhigh` — evaluated against `signalsSummary` (see the grammar
comment at the top of `scripts/predicate.mjs`). A model dispatched to
summarize a self-assessment run misread that DSL as an object shape
(`{field, op, value}`) instead of a string to parse. The mismatch didn't
throw — it just made the evaluator return `null`, which silently skipped
filtering. The `babysit-loop` next-action, already satisfied according to
`signalsSummary`, surfaced in the top-3 priority list anyway. A prior PR
(#104) tried to patch this by adding a tactical grammar block to
`SKILL.md`. That helped a reader who happened to open the block, but it
didn't stop a future reimplementation — the grammar still lived only as
documentation, not as code the skill was forced to call.

## The structural fix

**One evaluator.** `scripts/predicate.mjs` is now the canonical
implementation of the DSL (truthy checks, `!`, `>=`/`<=`/`>`/`<`,
`=`/`!=` with `|`-separated alternatives, `~regex` against string arrays,
and `&`-joined AND). `app/lib/assessment.ts`'s `evaluatePredicate` export is
a one-line re-export of the `.mjs` version — not a parallel
implementation. This is enforced, not just documented:
`app/lib/__tests__/predicate-passthrough.test.ts` imports both the TS and
MJS exports and asserts `toBe` (reference equality). If a future change
forks the TS side back into its own copy, that test fails CI immediately.

**One ranking step.** The weight×deficit filtering and sorting that used to
live inline wherever a next-actions list was needed now lives in
`scripts/rank-next-actions.mjs`, called once from `run-assessment.mjs`
alongside `scoreAll`. `rankNextActions(rubric, scoreMap, signalsSummary, limit)`
walks every dimension's `nextActions`, drops any action whose
`satisfiedWhen` evaluates true against `signalsSummary` (via the same
canonical `evaluatePredicate`), computes `rank = weight × deficit` (deficit
is `100 - executionScore` for `axis: "execution"` actions, otherwise
`100 - score`), and sorts by `rank` descending with axis, weight, and
id as tie-breakers. The result is written straight to
`assessment.json.rankedNextActions` — a pre-computed array, not something a
consumer derives.

`.claude/skills/self-assessment/SKILL.md` was updated to point at this
array explicitly: report the top 3 priority actions by reading
`assessment.json.rankedNextActions[0..2]`, described as "already filtered
(satisfied actions dropped) and ranked by `weight × deficit`." The skill is
told what fields each entry carries (`dimId`, `actionId`, `axis`, `weight`,
`deficit`, `rank`, `action`, `effort`, `borisTip`, `satisfiedWhen`) so there's
no ambiguity about what to read versus what to compute.

## Why this shape and not another patch

The root cause wasn't a wrong grammar block — #104 already had a correct
one. The root cause was that correctness lived in two places (the DSL
semantics, and the ranking arithmetic) that a model could reach without
going through code. Moving both into single, tested, imported modules means
a future reimplementation attempt doesn't have anywhere to diverge from:
there's one file to import, and one array to read. CLAUDE.md now states
this as a hard rule — "the self-assessment skill must NEVER hand-implement
the `satisfiedWhen` filter or the weight×deficit ranking... surfacing a
satisfied action as a TODO again is a regression — fix the data layer, not
the report."

## What this does not change

The DSL grammar itself is unchanged — this PR is a structural relocation,
not a semantics change. `app/data/rubric.json`'s `$schema` comment and
`scripts/predicate.mjs`'s header comment are the two places the grammar is
documented; per the repo's hard rules, evolving the grammar means editing
`scripts/predicate.mjs` and that schema comment, never the TS file.

Test coverage for the new shape lives in
`scripts/__tests__/predicate.test.mjs` (evaluator semantics),
`scripts/__tests__/rank-next-actions.test.mjs` (filter/sort behavior in
isolation), and `scripts/__tests__/run-assessment-ranking.test.mjs`
(end-to-end: the ranked array actually lands in the written
`assessment.json`).
