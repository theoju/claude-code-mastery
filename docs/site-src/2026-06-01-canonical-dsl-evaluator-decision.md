---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Decision: one canonical `satisfiedWhen` evaluator, no model-side reimplementation

**Date:** 2026-06-01
**PR:** [#106](https://github.com/theoju/claude-code-self-assessment/pull/106)

## Context

Every `nextAction` in `app/data/rubric.json` can carry a `satisfiedWhen`
string — a small DSL (`path`, `!path`, `path>=N`, `path=v|w`, `path~regex`,
`A & B`) evaluated against `signalsSummary` to decide whether that action is
already done. Getting this right matters: an action that's actually
satisfied but reported as an open TODO is exactly the kind of noise that
erodes trust in the rubric.

Before this PR, the DSL had two live evaluators — `scripts/predicate.mjs`
was mirrored by hand inside `app/lib/assessment.ts` — and, separately, the
`/self-assessment` skill's reporting step had no code to call at all, so it
was reasoning over the filter/ranking logic in prose each time it summarized
`rankedNextActions`... except `rankedNextActions` didn't exist yet either.
The actual failure that forced this PR: a model reimplementing the
`satisfiedWhen` filter misread the DSL as a structured object instead of a
string expression, silently evaluated it to `null`, and let an
already-satisfied action — `babysit-loop` — surface as a top-priority
next-action. A prior PR (#104) tried to close the gap with a grammar
reference doc. That reduced the odds of misreading the grammar but didn't
remove the reimplementation step itself, which was the actual defect
surface.

## Decision

Collapse to a single source of truth and remove the reimplementation step
entirely, rather than documenting the grammar more thoroughly.

**1. `scripts/predicate.mjs` is canonical.** `app/lib/assessment.ts` no
longer contains a parallel `evaluatePredicate` — it imports and re-exports
the `.mjs` version verbatim:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` enforces this isn't a
copy: it asserts `fromTs` and `fromMjs` are `toBe` (reference-equal), not
merely deep-equal. A future contributor pasting the implementation back
into the TS file fails CI immediately instead of drifting silently.

**2. Filtering and ranking move into tested source, not the skill.**
`scripts/rank-next-actions.mjs` exports `rankNextActions(rubric, scoreMap,
signalsSummary, limit)`, which:

- walks every dimension's `nextActions`,
- drops any action whose `satisfiedWhen` evaluates true via
  `evaluatePredicate` (imported from `predicate.mjs`, not reimplemented),
- computes `deficit` per action (`100 - executionScore` on the `execution`
  axis, `100 - score` otherwise — `axis` defaults to `"platform"` when
  `satisfiedWhen` is present, else `"either"`),
- ranks by `weight × deficit`, and
- breaks ties deterministically: `axisOrder` (platform before execution
  before either) → `weight` descending → `dimId` → `actionId`
  lexicographically. No two runs over identical signals can produce a
  different top-N ordering.

**3. `scripts/run-assessment.mjs` calls it once, at write time.** Every
`npm run assess` run computes `rankedNextActions: rankNextActions(rubric,
scoreMap, signalsSummary, 10)` and writes the top 10 straight into
`assessment.json`. Each entry carries `dimId`, `actionId`, `axis`, `weight`,
`deficit`, `rank`, `action`, `effort`, `borisTip`, and `satisfiedWhen` — so
a consumer can render the reasoning, not just the verdict.

**4. The `self-assessment` skill only reads.** `.claude/skills/self-
assessment/SKILL.md`'s reporting step is now: run `npm run assess`, then
read `assessment.json.rankedNextActions[0..2]` for the top-3 priorities —
"already filtered (satisfied actions dropped) and ranked by `weight ×
deficit` by `scripts/rank-next-actions.mjs`." There is no filter logic left
for the model to get wrong, because there's no filter logic left for the
model to *run*.

## Consequences

- **A whole bug class is closed by construction, not by better docs.** The
  DSL grammar doc from PR #104 is still useful context, but it's no longer
  load-bearing — nothing downstream of `run-assessment.mjs` needs to parse
  or reason about `satisfiedWhen` strings at all.
- **Two new unit-test surfaces enforce the contract going forward**:
  `scripts/__tests__/predicate.test.mjs` covers the DSL evaluator itself;
  `scripts/__tests__/rank-next-actions.test.mjs` and
  `scripts/__tests__/run-assessment-ranking.test.mjs` cover the filter +
  ranking behavior, including the tie-break order. A regression in either
  layer fails CI before it reaches `assessment.json`.
- **CLAUDE.md now states both halves as hard rules** so future work doesn't
  reopen either side: *"DSL evaluator has one source"* (edit
  `scripts/predicate.mjs`, never the TS file) and *"Ranked next-actions live
  in `assessment.json.rankedNextActions`"* (the skill must never hand-
  reimplement the filter or the ranking).
- **This is additive to the rubric schema, not a breaking change.**
  `satisfiedWhen` strings, the `$schema` comment in `rubric.json`, and every
  existing predicate continue to work unmodified — the PR relocates *who
  evaluates* the DSL, not the DSL itself.

## Alternatives considered

- **Better grammar documentation only** (the PR #104 approach, kept as a
  first attempt): reduces misreadings but doesn't remove the
  reimplementation step, so the failure mode — a model hand-rolling the
  filter and getting an edge case wrong — remains structurally possible.
  Superseded by this PR, not replaced; the grammar doc is still the right
  reference for anyone reading or writing a `satisfiedWhen` expression by
  hand.
- **Have the skill call into the TS evaluator via a small CLI shim**:
  rejected in favor of keeping `scripts/predicate.mjs` as pure ESM with no
  TS/Next.js runtime dependency, since `run-assessment.mjs` (a plain Node
  script) needs to call it too. The passthrough re-export gives the
  dashboard the same function without inverting that dependency direction.

## See also

- [Architecture: predicate evaluator and ranked next-actions](2026-06-01-predicate-evaluator-and-ranked-next-actions.md)
- `scripts/predicate.mjs`, `scripts/rank-next-actions.mjs`,
  `scripts/run-assessment.mjs`
- `app/lib/assessment.ts`, `app/lib/__tests__/predicate-passthrough.test.ts`
- `.claude/skills/self-assessment/SKILL.md`
