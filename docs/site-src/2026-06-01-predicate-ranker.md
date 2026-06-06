---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Predicate DSL and ranked next-actions (PR #106)

`npm run assess` now pre-computes a ranked, filtered `rankedNextActions[10]`
array directly into `app/data/assessment.json`. The `/self-assessment` skill
reads that list instead of re-evaluating predicates at runtime — which is
what the previous skill did, incorrectly, and why already-satisfied actions
kept surfacing as top priorities.

## What broke and why

The `/self-assessment` skill contained a hand-rolled Node-side filter for
`satisfiedWhen`. It expected an object shape like
`{ field: "loopCommandUses", op: ">=", value: 1 }`, but the rubric stores
predicates as plain strings (`"loopCommandUses>=1"`). The evaluator
silently returned `null` for every predicate, no actions were filtered, and
the skill treated every action as unsatisfied — so `babysit-loop` appeared
as a top-3 priority even when `loopCommandUses` was 14.

The fix eliminates the re-implementation pattern entirely: one canonical
evaluator runs at score time, and the skill becomes a trivial reader.

## What changed

### Canonical DSL evaluator: `scripts/predicate.mjs`

The predicate evaluator is extracted into its own module. It handles the
full string DSL used in `rubric.json`:

```
"loopCommandUses>=1"
"hasShipCommand && hookCount>=1"
"permissionsDenyCount>=5 || hasDangerousTools"
```

The TypeScript surface in `app/lib/assessment.ts` is now a two-line
re-export:

```ts
// app/lib/assessment.ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

A reference-identity test (`app/lib/__tests__/predicate-passthrough.test.ts`)
asserts the two are the same function object. If you copy the implementation
instead of re-exporting, CI fails.

### Ranker: `scripts/rank-next-actions.mjs`

`rankedNextActions` is computed by a `weight × deficit` scorer with a
deterministic 5-tier tie-break:

| Tier | Tie-break key            |
| ---- | ------------------------ |
| 1    | `weight × deficit` score |
| 2    | Dimension weight         |
| 3    | Deficit magnitude        |
| 4    | Dimension id             |
| 5    | Action id                |

Actions whose `satisfiedWhen` predicate evaluates to `true` against the
current signals are excluded before ranking. The output is the top 10
unsatisfied actions ordered by leverage.

### Assessment pipeline wire-up

`scripts/run-assessment.mjs` calls `rankNextActions(signals, rubric)` after
scoring and writes the result to `app/data/assessment.json` under
`rankedNextActions`. The `Assessment` TypeScript interface gained a typed
field:

```ts
rankedNextActions: Array<{
  id: string;
  dimensionId: string;
  label: string;
  score: number; // weight × deficit
}>;
```

### `/self-assessment` skill

The skill now reads `assessment.json.rankedNextActions` directly. There is
no predicate logic in the skill itself — reading the pre-computed list is
the whole job. The field is written on every `npm run assess` run, so the
skill always sees a fresh ranking.

## Test coverage

Thirty new tests cover:

- **Evaluator** — all DSL operators (`>=`, `<=`, `>`, `<`, `==`, `!=`),
  boolean `&&` / `||`, unknown fields (return `false`, not `null`), and
  malformed input.
- **Ranker** — `weight × deficit` ordering, tie-break determinism, and
  the filter-before-rank contract.
- **Wire-up** — `assessment.json` shape after a full assess run includes
  `rankedNextActions` with ≤ 10 entries, all unsatisfied.
- **Named regression** — `loopCommandUses=14` produces a signals snapshot
  where `babysit-loop` is absent from the ranked output.

Run them:

```bash
npx vitest run scripts/__tests__/predicate.test.mjs
npx vitest run scripts/__tests__/rank-next-actions.test.mjs
```

## Rule this enforces

> Ranked next-actions live in `assessment.json.rankedNextActions`. The
> self-assessment skill must NEVER hand-implement the `satisfiedWhen`
> filter or the `weight × deficit` ranking. Read the pre-computed top-10
> from the written file. Surfacing a satisfied action as a TODO again is a
> regression — fix the data layer, not the report.

This rule is now in `CLAUDE.md` (§ Hard rules). The regression test
(`loopCommandUses=14` → `babysit-loop` absent) is the machine-enforced
form of it.
