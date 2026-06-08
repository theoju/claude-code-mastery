---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Predicate evaluator and ranked next-actions

PR #106 closed a production regression where the `/self-assessment` skill
surfaced an already-satisfied next-action as a top priority. The fix has two
parts: a single canonical `satisfiedWhen` DSL evaluator that both the scoring
pipeline and any consumer must import, and a pre-computed
`assessment.json.rankedNextActions` array so consumers never need to
re-implement the filter or ranking logic.

---

## Background: the 2026-05-31 regression

`/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a
top-3 priority even though `signalsSummary.loopCommandUses=14` — far above the
`loopCommandUses>=1` threshold that marks the action satisfied. The root cause:
the skill instructed the model to "first filter, then rank" but the only
`evaluatePredicate` implementation lived in `app/lib/assessment.ts`, which is
Next.js-coupled and unreachable from a Node-side caller. The model hand-wrote a
replacement filter that expected an object shape (`{field, op, value}`) rather
than the string DSL (`"loopCommandUses>=1"`), so the evaluator silently returned
`null` and skipped all filtering entirely.

PR #104 patched the skill with an inline DSL grammar block as a stopgap.
PR #106 is the structural close-out.

---

## The DSL evaluator — `scripts/predicate.mjs`

`scripts/predicate.mjs` is the **canonical, sole-source** implementation of the
`satisfiedWhen` DSL. It is a pure-ESM port of the logic that previously lived in
`app/lib/assessment.ts` — same byte-faithful logic, no external dependencies.

**Export:**

```js
import { evaluatePredicate } from "./scripts/predicate.mjs";

// Returns true when the predicate is satisfied (action should be filtered out).
evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean
```

**DSL grammar** — `expr` is evaluated against the `signalsSummary` object:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals any of the listed values |
| `path!=v` | not equals |
| `path~regex` | any element of an array-of-strings matches the regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

**Example:** `"loopCommandUses>=1"` with `signalsSummary.loopCommandUses=14`
evaluates to `true` — the action is satisfied, filter it out, do **not** surface
it as a TODO.

### TypeScript passthrough

`app/lib/assessment.ts` re-exports the function as a 1-line passthrough:

```ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

It must stay a passthrough. The dashboard's `/methodology/probes` and
`/dimensions/[id]` pages call it at request time to render per-action ✓/✗
marks; they import from `app/lib/assessment.ts` rather than directly from
`scripts/predicate.mjs` for path convenience. A CI test
(`app/lib/__tests__/predicate-passthrough.test.ts`) asserts that the two
exports are reference-equal — a duplicate implementation fails the build.

---

## `rankNextActions` — the ranker

`scripts/rank-next-actions.mjs` exports `rankNextActions`. It is called once
per `npm run assess` run from `scripts/run-assessment.mjs`.

**Signature:**

```js
import { rankNextActions } from "./scripts/rank-next-actions.mjs";

rankNextActions(
  rubric,          // parsed app/data/rubric.json
  scoreMap,        // Map<dimId, { score, executionScore }>
  signalsSummary,  // output of buildSignalsSummary()
  limit = 10       // how many entries to return
): RankedNextAction[]
```

**Algorithm:**

1. For each dimension in `rubric.dimensions`, resolve its `score` (Platform
   Setup) and `executionScore` (Execution) from `scoreMap`.
2. For each `nextAction` in `dim.nextActions`:
   - Skip if `na.satisfiedWhen` is set **and** `evaluatePredicate(na.satisfiedWhen, signalsSummary)` returns `true`.
   - Determine the relevant deficit: `execution`-axis actions use `max(0, 100 - executionScore)`; all others use `max(0, 100 - score)`.
   - Compute `rank = weight × deficit`.
3. Sort by the 5-tier tie-break (see below).
4. Return the top `limit` entries.

**Tie-break order** (all ties broken deterministically):

| Priority | Key | Direction |
| --- | --- | --- |
| 1 | `rank` | descending |
| 2 | axis (`platform` → `execution` → `either`) | ascending index |
| 3 | `weight` | descending |
| 4 | `dimId` | ascending (locale) |
| 5 | `actionId` | ascending (locale) |

Platform-axis actions sort above execution-axis actions at equal rank because
they typically represent uninstalled configuration — higher leverage per unit
effort than behavioral changes.

**Output shape per entry:**

```jsonc
{
  "dimId": "scheduled",
  "actionId": "promote-routine",
  "axis": "platform",
  "weight": 2,
  "deficit": 25,
  "rank": 50,
  "action": "Promote repeating patterns to a Routine — Boris tip 61",
  "effort": "30min",
  "borisTip": 61,
  "satisfiedWhen": "scheduleCommandUses>=1"  // null when no predicate
}
```

---

## `assessment.json.rankedNextActions` — consumer contract

Every `npm run assess` writes a `rankedNextActions` array (default length 10)
as a top-level field of `app/data/assessment.json`. All existing fields are
unchanged; this is an additive addition.

```jsonc
{
  // ... existing fields ...
  "rankedNextActions": [ /* up to 10 RankedNextAction objects */ ]
}
```

**Reading it from the `/self-assessment` skill:**

```
Read assessment.json.rankedNextActions[0..2] — already filtered
(satisfied actions are dropped) and sorted by weight × deficit.
```

You do not need to re-filter or re-rank. The list is pre-computed from the
exact same signal state that produced the rest of `assessment.json`.
Re-implementing the filter in the skill is the root cause of the regression
this design closes.

---

## Hard rules

Two rules are now CI-enforced:

1. **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
   `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
   re-export — never copy the implementation.
   (`app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality.)

2. **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
   `/self-assessment` skill must never hand-implement the `satisfiedWhen` filter
   or the `weight × deficit` ranking. Read the pre-computed top-10 from the
   written file. Surfacing a satisfied action as a TODO again is a regression —
   fix the data layer, not the report.

---

## Related files

| Path | Role |
| --- | --- |
| `scripts/predicate.mjs` | Canonical DSL evaluator |
| `scripts/rank-next-actions.mjs` | `rankNextActions` implementation |
| `scripts/run-assessment.mjs` | Calls ranker; writes `rankedNextActions` |
| `app/lib/assessment.ts` | Re-exports `evaluatePredicate` (passthrough only) |
| `app/data/rubric.json` | Declares `satisfiedWhen` strings and `nextActions` |
| `app/data/assessment.json` | Receives `rankedNextActions` on every run (gitignored) |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration |
| `scripts/__tests__/rank-next-actions.test.mjs` | Ranker tests, including `loopCommandUses=14 vs >=1` regression |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Asserts TS export === MJS export |
| `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md` | Full design spec |
| `docs/superpowers/plans/2026-05-31-predicate-ranker.md` | Implementation plan |
