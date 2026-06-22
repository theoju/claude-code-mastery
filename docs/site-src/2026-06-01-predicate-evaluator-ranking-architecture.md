---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Predicate evaluator and next-action ranking — architecture

PR #106 (2026-05-31) extracted the `satisfiedWhen` DSL evaluator into a
Node-shareable module and added a pre-computed ranked next-actions list to
every `npm run assess` output. This page documents the resulting architecture:
the evaluator's grammar, the ranking algorithm, and the single-source contract
that makes duplicating either a CI failure.

Design spec:
[`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](../superpowers/specs/2026-05-31-predicate-ranker-design.md).

---

## Triggering bug

On 2026-05-31 the `/self-assessment` skill reported `Start with one loop —
/loop 30m /babysit` as a top-3 priority even though
`signalsSummary.loopCommandUses` was `14`. The predicate `loopCommandUses>=1`
should have filtered the action as already satisfied. Root cause: the skill
instructed the model to filter and rank, the canonical evaluator lived only in
`app/lib/assessment.ts` (TypeScript, Next.js-coupled), and the model running
the Node-side skill hand-wrote a filter that expected `satisfiedWhen` to be a
structured object `{field, op, value}` — not the string DSL `"loopCommandUses>=1"`.
The filter silently returned `null` for every predicate, nothing was filtered,
and the already-satisfied action appeared as a priority. PR #106 closes the
structural root cause.

---

## Module layout

```
scripts/predicate.mjs          ← canonical evaluator (pure ESM, no deps)
scripts/rank-next-actions.mjs  ← rankNextActions(); imports predicate.mjs
scripts/run-assessment.mjs     ← entry point; calls rankNextActions(); writes
                                  assessment.json.rankedNextActions[10]
app/lib/assessment.ts          ← 1-line re-export of evaluatePredicate (passthrough)
app/data/assessment.json       ← output; top-level field rankedNextActions added
```

The data flow is linear:

```
rubric.json (DSL strings)
      │
      ▼
scripts/predicate.mjs          evaluatePredicate(expr, signalsSummary)
      │
      ├─▶ scripts/rank-next-actions.mjs   filters + ranks
      │         │
      │         ▼
      │   app/data/assessment.json → rankedNextActions[10]
      │         │
      │         ▼
      │   .claude/skills/self-assessment/SKILL.md  (reads pre-computed list)
      │
      └─▶ app/lib/assessment.ts   re-exports evaluatePredicate (1-line passthrough)
                │
                ▼
          app/ dashboard pages (re-evaluate fresh at request time for ✓ marks)
```

The dashboard pages (`/methodology/probes`, `/dimensions/[id]`) still call
`evaluatePredicate` at request time to compute per-action ✓/✗ marks. The
`rankedNextActions` field serves the skill, the console printer, and any future
Slack integration — not the dashboard's existing render paths.

---

## The `satisfiedWhen` DSL

Predicates are plain strings stored in `app/data/rubric.json` under each
`nextAction.satisfiedWhen`. `evaluatePredicate(expr, signals)` returns a
boolean — `true` means the action is already done and should be excluded from
priority lists.

### Grammar

| Form | Meaning |
|------|---------|
| `path` | truthy (`null`, `0`, `""`, `"0"`, `"false"` are falsy) |
| `!path` | falsy |
| `path>=N` / `>N` / `<=N` / `<N` | numeric comparison |
| `path=v` | string equality via `String(value)` coercion |
| `path=v\|w\|x` | equals any one of the pipe-delimited literals |
| `path!=v` | not-equals |
| `path~regex` | array-of-strings: any element matches regex (case-insensitive, `i` flag); non-array LHS or unparseable regex → `false`, never throws |
| `A & B & C` | AND of two or more atoms; short-circuits on first false |

`path` supports dot notation for nested fields: `a.b.c` resolves into the
signals object using successive key lookups. A missing key at any step resolves
to `undefined`. For numeric comparisons, `Number(undefined)` is `NaN` and the
NaN guard returns `false` regardless of operator direction.

### Examples from the production rubric

```
loopCommandUses>=1          # scheduled/babysit-loop
hasFormatterHook            # automation/formatter-hook
skills~^ship$               # automation/ship-skill (case-insensitive)
effortLevel=xhigh           # model-effort/effort-level
skipDangerous=false & autoMode=true   # permissions compound
```

### Canonical source and CI enforcement

`scripts/predicate.mjs` is the only place the evaluator logic lives.
`app/lib/assessment.ts` is a 1-line re-export:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality:

```ts
expect(fromTs).toBe(fromMjs);
```

If the TS file ever duplicates the implementation instead of re-exporting, that
test fails CI immediately. The named regression test in
`scripts/__tests__/predicate.test.mjs` pins the originating bug:

```js
it("named regression: loopCommandUses=14 satisfies loopCommandUses>=1", () => {
  expect(evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14 })).toBe(true);
});
```

---

## Ranking algorithm

`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)` in
`scripts/rank-next-actions.mjs`:

1. **Filter satisfied.** For each `nextAction` with a `satisfiedWhen` string,
   call `evaluatePredicate(na.satisfiedWhen, signalsSummary)`. If it returns
   `true`, skip the action entirely.

2. **Skip malformed.** Actions missing an `action` text field are silently
   skipped (no throw).

3. **Determine axis.** If `na.axis` is set, use it. Otherwise default: actions
   with a `satisfiedWhen` predicate default to `"platform"`; unpredicated
   coaching actions default to `"either"`.

4. **Compute deficit.** `platform` and `either` actions use the Platform Setup
   deficit (`100 - score`); `execution` actions use `100 - executionScore`.
   Either deficit is clamped to `Math.max(0, ...)`.

5. **Compute rank.** `rank = weight × deficit`.

6. **Sort with 5-tier tie-break** (descending rank wins; all ties resolved
   deterministically):

   | Priority | Field | Direction |
   |----------|-------|-----------|
   | 1 | `rank` | desc |
   | 2 | `axisOrder(axis)` — `platform=0`, `execution=1`, `either=2` | asc |
   | 3 | `weight` | desc |
   | 4 | `dimId` | asc (lexicographic) |
   | 5 | `actionId` | asc (lexicographic) |

7. **Slice.** Return the top `limit` entries (default 10). Callers reading from
   `assessment.json.rankedNextActions` receive a pre-computed 10-entry array.

### Output shape

Each entry in the returned array carries:

```ts
{
  dimId:       string,
  actionId:    string,
  axis:        "platform" | "execution" | "either",
  weight:      number,
  deficit:     number,
  rank:        number,         // weight × deficit
  action:      string,
  effort?:     string,
  borisTip?:   number,
  satisfiedWhen: string | null,
}
```

`scripts/run-assessment.mjs` calls `rankNextActions` once during the assessment
pipeline (after scoring, before writing `assessment.json`) and stores the result
as `assessment.json.rankedNextActions`.

---

## What consumers must and must not do

**Must:**
- Read the top-N list from `assessment.json.rankedNextActions`. It is
  pre-filtered (satisfied actions already excluded) and pre-sorted.
- Call `evaluatePredicate` from `scripts/predicate.mjs` (Node) or
  `app/lib/assessment.ts` (Next.js) — never re-implement the DSL.

**Must not:**
- Hand-write a filter or ranker for next-actions. The CLAUDE.md hard rule
  locks this down: the self-assessment skill must read from the pre-computed
  array, never re-implement the filter or ranking logic.
- Treat `satisfiedWhen` as a structured object. It is always a string.
- Import `app/lib/assessment.ts` from Node-side scripts — use
  `scripts/predicate.mjs` directly.

---

## Testing

| File | What it covers |
|------|----------------|
| `scripts/__tests__/predicate.test.mjs` | Full operator coverage; named `loopCommandUses=14` regression; production rubric parse-without-throw sweep |
| `scripts/__tests__/rank-next-actions.test.mjs` | Filtering, tie-breaking, axis defaults, limit slicing, malformed-action skip, named `babysit-loop` regression |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration: `scoreAll` → `buildSignalsSummary` → `rankNextActions` produces a valid ≤10-entry array; determinism across two identical runs |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Reference-equality guard on the TS re-export |
