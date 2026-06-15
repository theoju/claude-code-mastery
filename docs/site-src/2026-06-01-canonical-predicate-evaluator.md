---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Canonical predicate evaluator and ranked next-actions pipeline

PR #106 consolidated the `satisfiedWhen` DSL evaluator into a single canonical
module and baked the top-10 ranked next-actions into `assessment.json` at score
time. This page describes the contract for both, the CI rule that enforces the
single-source invariant, and the hard rule that no consumer may re-implement the
filter.

## The problem this solved

Before PR #106, the `/self-assessment` skill re-implemented the `satisfiedWhen`
filter from scratch. Because it ran independently of the scorer, the two copies
drifted — already-satisfied actions surfaced as TODOs, and new DSL operators
added to one copy didn't land in the other. PR #106 closes that bug class
permanently: one evaluator, one pre-computed output, every consumer reads from
the snapshot.

---

## `scripts/predicate.mjs` — DSL evaluator

`scripts/predicate.mjs` is the canonical implementation of the `satisfiedWhen`
evaluator. It is pure ESM with no imports — a self-contained function that
takes an expression string and a flat signals object.

### Grammar

| Form | Meaning |
|------|---------|
| `path` | Truthy check (`null`, `0`, `""`, `"0"`, `"false"`, `[]`, `{}` all falsy) |
| `!path` | Negation |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison; both sides coerced via `Number()`. Missing path or non-numeric value NaN-guards to `false`. |
| `path=v` / `path=v\|w\|x` | String equality (via `String()` coercion) or alternation |
| `path!=v` | Not-equals |
| `path~regex` | Array-of-strings: each element tested against `regex` (case-insensitive). Non-array LHS or unparseable regex returns `false`, never throws. |
| `A & B` | AND of two or more atoms (split on `&`, every atom must hold) |

Operator precedence is not defined; `&` is the only combinator and it is always
flat. Nested parentheses are not supported — use separate next-action entries if
you need OR logic.

### Path resolution

`readPath(obj, path)` walks dot-separated keys. A missing intermediate key
returns `undefined`; it does not throw. `a.b.c` on `{ a: {} }` returns `false`
for any truthy/comparison test.

### Exported surface

```js
import { evaluatePredicate } from "./predicate.mjs";

evaluatePredicate("loopCommandUses>=1", signalsSummary); // → boolean
```

`evaluatePredicate(expr, signals)` returns `false` for empty or whitespace-only
expressions. Every `satisfiedWhen` value in `app/data/rubric.json` must parse
without throwing — `scripts/__tests__/predicate.test.mjs` asserts this against
the live rubric on every CI run.

---

## `scripts/rank-next-actions.mjs` — pre-computation pipeline

`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)` iterates every
dimension in `rubric.dimensions`, filters out already-satisfied actions, scores
the remainder by `weight × deficit`, and returns the top `limit` entries sorted
by a deterministic tie-breaking rule.

### Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `rubric` | `{ dimensions: [...] }` | Parsed `rubric.json` |
| `scoreMap` | `Map<dimId, { score, executionScore }>` | Output of `scoreAll()` |
| `signalsSummary` | flat object | Output of `buildSignalsSummary()` in `run-assessment.mjs`; passed verbatim to `evaluatePredicate` |
| `limit` | number | Maximum entries returned (default 10) |

### Filter

An action is excluded when `na.satisfiedWhen` is present **and**
`evaluatePredicate(na.satisfiedWhen, signalsSummary)` returns `true`. Actions
with no `satisfiedWhen` are never filtered — they are unpredicated coaching
entries that always appear until manually resolved. Malformed entries (missing
`action` text) are skipped silently.

### Ranking

```
deficit = max(0, 100 − score)          // platform axis: uses dimension score
       or max(0, 100 − executionScore) // execution axis: uses execution score
rank = weight × deficit
```

Axis defaults: predicated actions (`satisfiedWhen` present) default to
`"platform"`; unpredicated actions default to `"either"`.

Tie-breaking order when `rank` values are equal:

1. `rank` descending
2. Axis order: `platform` (0) → `execution` (1) → `either` / unknown (2)
3. `weight` descending
4. `dimId` ascending (lexicographic)
5. `actionId` ascending (lexicographic)

The sort is deterministic — two identical runs return identical arrays. This is
tested by `scripts/__tests__/run-assessment-ranking.test.mjs`.

### Output shape

Each entry in the returned array carries:

```json
{
  "dimId": "scheduled",
  "actionId": "babysit-loop",
  "axis": "platform",
  "weight": 2,
  "deficit": 25,
  "rank": 50,
  "action": "Start with one loop — Boris tip 48",
  "effort": "5min",
  "borisTip": 48,
  "satisfiedWhen": "loopCommandUses>=1"
}
```

`satisfiedWhen` is `null` for unpredicated entries. `borisTip` and `effort` are
present when the rubric entry carries them.

### Where the output lands

`scripts/run-assessment.mjs` calls `rankNextActions` after `scoreAll` and writes
the result to `assessment.json` under the key `rankedNextActions`:

```js
import { rankNextActions } from "./rank-next-actions.mjs";
// ...
const ranked = rankNextActions(rubric, scoreMap, signalsSummary, 10);
// written into the assessment snapshot
snapshot.rankedNextActions = ranked;
```

The `/self-assessment` skill reads `assessment.json.rankedNextActions[0..2]` for
the top-3 priority block. The dashboard's dimension drilldown pages read the
full array for the unsatisfied next-action list.

---

## Passthrough re-export — `app/lib/assessment.ts`

The Next.js dashboard imports `evaluatePredicate` through
`app/lib/assessment.ts`. That file contains exactly one line for the evaluator:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

This is a structural constraint, not a convention. **Do not copy the
implementation into the TypeScript file.** The canonical source is
`scripts/predicate.mjs`; `assessment.ts` is a re-export shim so the Next.js
build can resolve the same module that the Node scoring pipeline uses.

### CI enforcement

`app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality:

```ts
it("TS export is reference-equal to the MJS source", () => {
  expect(fromTs).toBe(fromMjs);
});
```

If `assessment.ts` ever duplicates or wraps the implementation, `fromTs !== fromMjs`
and the test fails. A duplicate evaluator is a CI failure, not a lint warning.

---

## Hard rule: skills must not re-implement satisfiedWhen filtering

The `/self-assessment` skill (`SKILL.md`) reads the pre-computed array:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
> actions dropped) and ranked by `weight × deficit` by `scripts/rank-next-actions.mjs`.

This is non-negotiable. The skill **must never**:

- Re-evaluate `satisfiedWhen` predicates against the signals object
- Re-implement the `weight × deficit` ranking inline
- Filter `rubric.json` next-actions directly

If a satisfied action reappears as a TODO, the bug is in the data layer
(the predicate in `rubric.json`, the signal in `signalsSummary`, or the
`rankNextActions` call in `run-assessment.mjs`) — fix it there, not in the
skill. Duplicating the filter in the skill means the two copies will drift
again.

The named regression test in `scripts/__tests__/rank-next-actions.test.mjs`
pins the original production bug:

```js
it("NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action", () => {
  // loopCommandUses=14 SATISFIES "loopCommandUses>=1"
  // so babysit-loop must not appear in the ranked output
});
```

If that test breaks, the filter is wrong — not the skill.

---

## File map

| File | Role |
|------|------|
| `scripts/predicate.mjs` | Canonical DSL evaluator — single source of truth |
| `scripts/rank-next-actions.mjs` | Pre-computation: filter + rank → top-N |
| `scripts/run-assessment.mjs` | Calls `rankNextActions`; writes result to `assessment.json` |
| `app/lib/assessment.ts` | 1-line re-export shim; **never a duplicate** |
| `app/lib/__tests__/predicate-passthrough.test.ts` | CI: reference-equality guard |
| `scripts/__tests__/predicate.test.mjs` | Operator coverage + rubric integration |
| `scripts/__tests__/rank-next-actions.test.mjs` | Filter, ranking, tie-breaking, named regression |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration: full pipeline determinism |
| `app/data/rubric.json` | Source of `satisfiedWhen` predicates and `nextActions` |
