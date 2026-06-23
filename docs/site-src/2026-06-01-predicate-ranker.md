---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Predicate Evaluator & Next-Action Ranker

**PR #106 — 2026-06-01**

Every `satisfiedWhen` field in `app/data/rubric.json` is a small DSL expression.
Before PR #106, the dashboard and the scorer each had their own interpretation of
that grammar. A production bug on 2026-05-31 showed what happens when those
interpretations diverge: a model hand-rolled a Node ranker that treated the
string `"loopCommandUses>=1"` as a structured `{field, op, value}` object; the
evaluator silently returned `null`, nothing was filtered, and the already-satisfied
`babysit-loop` action surfaced as the top priority despite
`signalsSummary.loopCommandUses = 14`.

PR #106 closes the gap permanently: one evaluator, pre-computed results, no
in-model re-implementation.

## Architecture

Three components work in sequence on every `npm run assess` run:

```
scripts/predicate.mjs          ← canonical DSL evaluator
scripts/rank-next-actions.mjs  ← filters + ranks via the evaluator
scripts/run-assessment.mjs     ← calls rankNextActions(), writes assessment.json
```

The Next.js dashboard reads the pre-computed `rankedNextActions` array from
`assessment.json`. It never re-derives the ranking at render time.

## DSL grammar (`scripts/predicate.mjs`)

The grammar is defined in the file header and mirrors the `$schema` comment in
`app/data/rubric.json`:

| Form | Semantics |
|---|---|
| `path` | Truthy check on the resolved value. `null`, `undefined`, `0`, `""`, `"0"`, `"false"`, `[]`, `{}` are falsy. |
| `!path` | Negation of the truthy check. |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison. Both sides coerced with `Number()`; if either is `NaN`, the predicate returns `false`. |
| `path=v` / `path=v\|w\|x` | Equality (or any-of). Comparison is `String(value) === literal`. |
| `path!=v` | Not-equals. |
| `path~regex` | Array-of-strings element match (case-insensitive). Returns `false` for non-array LHS or unparseable regex — never throws. |
| `A & B` | AND of two or more atoms. Splits on `&` first, evaluates each atom independently. |

The `path` segment supports dotted access (`a.b.c`) resolved via `readPath()`.
Operator matching is longest-first so `>=` is not accidentally parsed as `>`.

The evaluator lives in `scripts/predicate.mjs` as a pure-ESM module with no
dependencies. `app/lib/assessment.ts` re-exports it as a one-line passthrough:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

A reference-identity test in
`app/lib/__tests__/predicate-passthrough.test.ts` asserts
`expect(fromTs).toBe(fromMjs)` — a duplicate implementation fails CI.

## Ranker (`scripts/rank-next-actions.mjs`)

`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)` produces the
pre-computed priority list:

1. **Filter satisfied actions.** For each `nextAction` in each rubric dimension,
   evaluate `na.satisfiedWhen` against `signalsSummary` using the canonical
   `evaluatePredicate`. Actions where the predicate returns `true` are dropped.
   Actions with no `satisfiedWhen` (coaching entries) are never dropped.
   Malformed entries with no `action` text are silently skipped.

2. **Compute rank.** `rank = weight × deficit`. The deficit is
   `max(0, 100 − score)` for `axis === "platform"` or `"either"` actions, and
   `max(0, 100 − executionScore)` for `axis === "execution"` actions.

3. **Axis default.** If an action has no explicit `axis`, predicated actions
   default to `"platform"`, unpredicated coaching actions default to `"either"`.

4. **Five-tier tie-break** (all deterministic):
   1. `rank` descending
   2. `axisOrder` ascending — `platform = 0`, `execution = 1`, `either = 2`
   3. `weight` descending
   4. `dimId` ascending (alphabetical)
   5. `actionId` ascending (alphabetical)

5. **Slice to limit.** Default 10.

The output shape for each entry:

```
{ dimId, actionId, axis, weight, deficit, rank, action, effort, borisTip, satisfiedWhen }
```

## Integration point

`scripts/run-assessment.mjs` calls `rankNextActions()` after `scoreAll()` and
writes the result to `assessment.json` under `rankedNextActions`. Every consumer
reads from there:

- **`/self-assessment` skill** (`SKILL.md`) reads
  `assessment.json.rankedNextActions[0..2]` to report the top 3 priority actions.
  It must not hand-implement the filter or ranking.
- **`app/lib/assessment.ts` loader** exposes `rankedNextActions: RankedNextAction[]`
  via the `Assessment` interface; the dashboard reads it directly.

## Named regression

The named regression test (`scripts/__tests__/rank-next-actions.test.mjs`,
"NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action") fixes the
2026-05-31 incident:

```js
const signals = { loopCommandUses: 14 };
const result = rankNextActions(rubric, scoreMap, signals, 10);
expect(result.map(a => a.actionId)).not.toContain("babysit-loop");
```

`loopCommandUses >= 1` evaluates to `true` at `14`, so `babysit-loop` is
filtered. Before the canonical evaluator, the model-authored ranker silently
treated the string DSL as an object literal, returned `null` for every
`satisfiedWhen`, and surfaced the already-done action as priority #1.

## Test coverage

Thirty tests across three files:

| File | What it covers |
|---|---|
| `scripts/__tests__/predicate.test.mjs` | All DSL operators, boundary cases, NaN guards, the `loopCommandUses=14` regression, every production `satisfiedWhen` parses without throwing |
| `scripts/__tests__/rank-next-actions.test.mjs` | Sort order, filtering, malformed-entry skip, axis defaults, tie-break determinism, `limit` slicing |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Reference-identity equivalence between the TS re-export and the MJS source |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration: `scoreAll()` → `rankNextActions()` pipeline produces a stable, well-formed result against the fixture rubric |

## Hard rules (from `CLAUDE.md`)

Two rules were added to `CLAUDE.md` to pin these contracts:

- **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
  `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
  re-export — never copy the implementation. The reference-identity test
  enforces this; a duplicate fails CI.

- **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
  self-assessment skill must never hand-implement the `satisfiedWhen` filter or
  the `weight × deficit` ranking. Read the pre-computed top-10 from the written
  file. Surfacing a satisfied action as a TODO is a regression — fix the data
  layer, not the report.
