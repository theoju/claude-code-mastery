---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Predicate evaluator and next-action ranker — architecture

PR #106 closed a class of bug where a model re-implementing the `satisfiedWhen`
filter produced silent failures and surfaced already-satisfied actions as top
priorities. The fix is structural: one canonical evaluator shared between the
script layer and the Next.js app, pre-computed ranked output written to
`assessment.json` so no future consumer ever needs to re-implement the filter,
and CI-enforced reference equality to catch any future drift.

Two files own this system:

| File | Role |
| --- | --- |
| `scripts/predicate.mjs` | Canonical DSL evaluator. Single source of truth. |
| `scripts/rank-next-actions.mjs` | Ranker. Depends on the evaluator; used by the assessment pipeline. |

The TypeScript side (`app/lib/assessment.ts`) re-exports `evaluatePredicate`
as a 1-line passthrough — it contains no logic of its own.

## The `satisfiedWhen` DSL

Every next-action in `app/data/rubric.json` carries an optional
`satisfiedWhen` string. The evaluator treats that string as a predicate over
`signalsSummary`, the flat scalar map produced by `buildSignalsSummary` in
`scripts/run-assessment.mjs`.

### Grammar

Expressions are one or more atoms joined by `&` (logical AND). All atoms
must pass for the expression to be `true`. An empty or whitespace-only
expression returns `false`.

| Form | Matches when… |
| --- | --- |
| `path` | The field at `path` is truthy (non-null, non-zero, non-empty string, non-empty array/object; `"0"` and `"false"` are falsy) |
| `!path` | The field at `path` is falsy |
| `path>=N` | Numeric field ≥ N |
| `path<=N` | Numeric field ≤ N |
| `path>N` | Numeric field > N (strict; false at boundary) |
| `path<N` | Numeric field < N (strict) |
| `path=v` | `String(field) === v` |
| `path=v\|w\|x` | `String(field)` matches any alternative |
| `path!=v` | `String(field) !== v` |
| `path~regex` | LHS is an array-of-strings; at least one element matches the regex (case-insensitive, `i` flag). Non-array LHS or unparseable regex → `false`, never throws. |
| `A & B & C` | AND — all atoms must pass |

Paths resolve by splitting on `.`, so `a.b.c` works for nested objects.
Missing fields: a bare truthy check on a missing path returns `false`; a
numeric comparison on a missing path resolves to `Number(undefined) = NaN`,
which the NaN guard short-circuits to `false` regardless of operator direction
(not "missing → 0" — the tests pin this at `scripts/__tests__/predicate.test.mjs:34`).

Operator matching is greedy-longest-first (`>=` / `<=` / `!=` are tested
before `>` / `<` / `=`), so `x>=5` is never misread as `x>` with `=5` as
the RHS.

### `evaluatePredicate(expr, signals)`

```js
import { evaluatePredicate } from "./predicate.mjs";

evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14 }); // true
evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 0 });  // false
evaluatePredicate("loopCommandUses>=1", {});                      // false (NaN guard)
evaluatePredicate("hasFormatterHook & personalAgents>=1",
  { hasFormatterHook: true, personalAgents: 3 });                 // true
```

The named production regression — `loopCommandUses=14` must satisfy
`loopCommandUses>=1` — is pinned as a named test at
`scripts/__tests__/predicate.test.mjs:111`.

## The ranker

`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)` in
`scripts/rank-next-actions.mjs` walks every `nextAction` in every dimension
and builds a prioritized list.

### Filtering

An action is excluded from the output if:

1. It has no `action` text field (malformed; skipped silently).
2. Its `satisfiedWhen` predicate evaluates to `true` against `signalsSummary`
   — the action is already done.

Unpredicated actions (no `satisfiedWhen`) are never filtered by the predicate
step; they can only be excluded by the `limit` slice.

### Scoring and deficit

```
deficit = Math.max(0, 100 - score)          # platform axis
deficit = Math.max(0, 100 - executionScore) # execution axis
rank    = weight × deficit
```

Each action's `axis` field controls which deficit is used:

| `axis` value | Deficit source |
| --- | --- |
| `"platform"` | `100 - scored.score` |
| `"execution"` | `100 - scored.executionScore` |
| `"either"` (or absent) | `100 - scored.score` (platform) |

If `axis` is absent from the rubric entry, it defaults to `"platform"` when
`satisfiedWhen` is present, or `"either"` when `satisfiedWhen` is absent
(coaching-only actions). This default is computed inline in the ranker, not in
the rubric.

If `executionScore` is `null` (dimension not yet measured on the execution
axis), the execution deficit is treated as 0 — the action still appears but
with a lower rank than it would carry once measurement is available.

### 5-tier tie-break

When two actions share the same `rank`, the sort falls through these tiers in
order:

1. `rank` descending (primary)
2. `axisOrder` ascending — `platform (0)` before `execution (1)` before `either / unknown (2)`
3. `weight` descending
4. `dimId` ascending (lexicographic)
5. `actionId` ascending (lexicographic)

The final two tiers on string fields make the sort fully deterministic: two
runs against identical inputs produce identical output. This is CI-asserted at
`scripts/__tests__/run-assessment-ranking.test.mjs:26`.

### Signature

```js
import { rankNextActions } from "./rank-next-actions.mjs";

const ranked = rankNextActions(
  rubric,        // parsed rubric.json object ({ dimensions: [...] })
  scoreMap,      // Map<dimId, { score, executionScore }>
  signalsSummary,// flat object — passed verbatim to evaluatePredicate
  10             // limit (default)
);
```

Each returned entry carries: `dimId`, `actionId`, `axis`, `weight`, `deficit`,
`rank`, `action`, `effort`, `borisTip` (if set), `satisfiedWhen` (or `null`).

## Wire-up in the assessment pipeline

`scripts/run-assessment.mjs` calls the ranker once per run, immediately after
`scoreAll`, and writes the result into `assessment.json`:

```
signals → buildSignalsSummary → signalsSummary
rubric + scoreAll output → scoreMap
rankNextActions(rubric, scoreMap, signalsSummary, 10) → rankedNextActions[10]
→ written to app/data/assessment.json
```

The `/self-assessment` skill reads `rankedNextActions` directly from the
written file. It must not re-implement the filter or the ranking formula —
`CLAUDE.md` makes this a hard rule: _"The self-assessment skill must NEVER
hand-implement the satisfiedWhen filter or the weight×deficit ranking."_

## TypeScript passthrough contract

`app/lib/assessment.ts` re-exports the evaluator from `scripts/predicate.mjs`
as a 1-line passthrough:

```ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

`app/lib/__tests__/predicate-passthrough.test.ts` asserts the two imports are
reference-equal (`fromTs === fromMjs`). A copy of the implementation in the
TypeScript file fails CI. When the DSL grammar evolves, edit
`scripts/predicate.mjs` only — the TypeScript side picks it up automatically.

## Test coverage

| Test file | What it covers |
| --- | --- |
| `scripts/__tests__/predicate.test.mjs` | Full operator coverage (all 9 forms), NaN guard, nested paths, named production regression (`loopCommandUses>=1`), every `satisfiedWhen` in the production rubric parses without throwing |
| `scripts/__tests__/rank-next-actions.test.mjs` | Sorting, filtering (including named regression `loopCommandUses=14`), tie-break determinism, axis defaulting, malformed action skipping, `limit` slicing, dim-not-in-scoreMap is skipped without crash |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration with `scoreAll` output; determinism across two identical runs |
| `app/lib/__tests__/predicate-passthrough.test.ts` | TS export is reference-equal to the MJS source |
