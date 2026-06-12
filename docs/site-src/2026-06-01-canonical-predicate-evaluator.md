---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Canonical predicate evaluator (PR #106)

**Problem.** The `/self-assessment` skill was re-implementing the `satisfiedWhen` filter in-model. When signals changed the satisfied/unsatisfied boundary, the in-model logic drifted and resurfaced actions the user had already completed as open TODOs. There was no single place where the predicate grammar was defined — it lived implicitly in two places and diverged.

**Decision.** One source. One pre-computed result. Nothing else evaluates predicates.

## The one-source rule

`scripts/predicate.mjs` is the canonical implementation of the `satisfiedWhen` DSL evaluator. Every other layer that needs to evaluate a predicate re-exports or imports from it — never copies it.

```
scripts/predicate.mjs          ← authoritative DSL evaluator
  ↑ imported by
scripts/rank-next-actions.mjs  ← filters + ranks at assessment time
  ↑ imported by
scripts/run-assessment.mjs     ← calls rankNextActions once; writes result to assessment.json

app/lib/assessment.ts          ← re-exports evaluatePredicate as a 1-line passthrough
```

`app/lib/assessment.ts` does nothing but re-export:

```ts
export { evaluatePredicate } from "@/scripts/predicate.mjs";
```

A CI test in `app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality:

```ts
it("TS export is reference-equal to the MJS source", () => {
  expect(fromTs).toBe(fromMjs);
});
```

If someone copies the implementation instead of re-exporting it, that `toBe` assertion fails. The enforcement is structural, not doctrinal.

## DSL grammar

The `satisfiedWhen` field in each rubric next-action is a string expression evaluated against `signalsSummary` — the flat scalar object `buildSignalsSummary()` derives from the signals snapshot at assessment time.

| Form | Meaning |
|---|---|
| `path` | truthy (non-null, non-zero, non-empty, non-`"false"`) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` | string equality (via `String()` coercion) |
| `path=v\|w\|x` | equals one of the pipe-separated literals |
| `path!=v` | not equals |
| `path~regex` | array-of-strings — any element matches `regex` (case-insensitive) |
| `A & B & C` | AND of two or more atoms |

Two edge cases worth knowing:

- **Missing numeric signal.** When a path resolves to `undefined`, numeric comparisons NaN-guard to `false` for both `>=1` and `<=0` directions — not the `0` the rubric schema comment suggested. The behavior matches the code, not the comment.
- **Unparseable regex.** `path~[invalid` returns `false` and never throws. Guard is inside `evaluateAtomic`.

## The `rankedNextActions` contract

`scripts/rank-next-actions.mjs` exports a single pure function:

```js
rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)
```

It iterates every rubric dimension, evaluates each next-action's `satisfiedWhen` predicate against `signalsSummary`, discards the satisfied ones, computes `rank = weight × deficit`, and sorts. `deficit` is `max(0, 100 - score)` on the platform axis or `max(0, 100 - executionScore)` on the execution axis.

Tie-breaking is deterministic: `rank desc → axis order (platform < execution < either) → weight desc → dimId asc → actionId asc`.

`scripts/run-assessment.mjs` calls `rankNextActions` once per run and writes the top-10 array to `assessment.json` under `rankedNextActions`. Each entry carries:

```
dimId, actionId, axis, weight, deficit, rank, action, effort, borisTip, satisfiedWhen
```

The `/self-assessment` skill reads `assessment.json.rankedNextActions[0..2]` directly. It does not call `evaluatePredicate`, does not inspect `satisfiedWhen`, does not re-rank. The data layer owns the ranking; the skill owns the report.

## Why pre-compute instead of evaluate on read

The alternative — evaluate predicates at dashboard render or skill invocation time — has the same divergence risk as the original bug. Any place that adds its own filter logic can drift. Pre-computing at assessment time means there is exactly one moment where filtering happens, the result is durable in `assessment.json`, and the skill's job is data retrieval, not logic.

The cost is that `rankedNextActions` is stale until the next `npm run assess` run. That is acceptable: the signal inputs it depends on (`signalsSummary`) are also only updated per-run.

## Files

| File | Role |
|---|---|
| `scripts/predicate.mjs` | DSL evaluator — the only implementation |
| `scripts/rank-next-actions.mjs` | Filters + ranks; imports from `predicate.mjs` |
| `scripts/run-assessment.mjs` | Calls `rankNextActions`; writes `rankedNextActions` |
| `app/lib/assessment.ts` | Re-exports `evaluatePredicate` as a passthrough |
| `app/lib/__tests__/predicate-passthrough.test.ts` | CI enforcement of the one-source rule |
| `scripts/__tests__/predicate.test.mjs` | Full operator coverage + rubric integration test |
| `scripts/__tests__/rank-next-actions.test.mjs` | Unit tests including named regression for `loopCommandUses>=1` |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration: `scoreAll` output → `rankNextActions` → stability check |
