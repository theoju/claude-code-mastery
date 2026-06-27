---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: predicate evaluator extraction + pre-computed ranked next-actions

**Date:** 2026-05-31
**Triggering bug:** `/self-assessment` surfaced `Start with one loop: /loop 30m /babysit`
as a top-3 priority action despite `signalsSummary.loopCommandUses=14` — a satisfied
predicate (`loopCommandUses>=1`) that should have been filtered out.

## What went wrong

The `/self-assessment` skill told the model to "first filter, then rank" next-actions
against their `satisfiedWhen` predicates. The canonical DSL evaluator lived in
`app/lib/assessment.ts:evaluatePredicate` — TypeScript-only, Next.js-coupled by
location — with no Node-side caller. When the model ran the skill it hand-wrote a
filter that expected `satisfiedWhen` to be an object shape rather than a string DSL
(e.g. `"loopCommandUses>=1"`). String predicates fell through the filter unchanged,
so every already-satisfied action remained in the output. The `/babysit` loop action
ranked first despite being satisfied 14 times over.

This is a "model re-implements the DSL" bug class: the correct evaluator existed, but
the model couldn't reach it from inside the skill and invented a faulty substitute.

## Decision

Fix it in two sequential PRs — a tactical stopgap now and a structural extraction that
makes the stopgap obsolete.

### PR 1 — Tactical: document the grammar inside SKILL.md

Add a `satisfiedWhen` DSL grammar block directly to `.claude/skills/self-assessment/SKILL.md`
so a careful model can evaluate predicates correctly without guessing the shape. The
seven operator classes:

| Form | Meaning |
|------|---------|
| `path` | truthy (non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals, or equals one of |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

This is a stopgap. It removes the ambiguity about predicate shape; it does not change
how the skill invokes the scorer.

### PR 2 — Structural: extract evaluator + bake ranked next-actions

The real fix eliminates the model-evaluation path entirely. After PR 2:

1. **`scripts/predicate.mjs`** — a pure-ESM port of `evaluatePredicate` and its helpers
   (`readPath`, `isTruthy`, `evaluateAtomic`) from `app/lib/assessment.ts:165–259`. No
   external dependencies; importable from any Node.js caller.

2. **`scripts/run-assessment.mjs`** — imports `evaluatePredicate`, calls
   `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)` after scoring, and
   writes the result to `assessment.json` under `rankedNextActions`.

3. **`app/lib/assessment.ts`** — replaces the local implementation with a 1-line
   re-export: `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. The
   dashboard's per-action ✓/✗ evaluation stays the same; it just calls through to the
   shared source.

4. **SKILL.md** — the skill's next-actions block is replaced with a single read
   instruction: "Read `assessment.json.rankedNextActions[0..2]` — already filtered
   and sorted by `weight × deficit`." The PR 1 grammar block is deleted as obsolete.

The model is now a reader of pre-computed data, not an evaluator of predicate strings.

## Architecture after PR 2

```
app/data/rubric.json           (DSL strings live here, unchanged)
          │
          ▼
scripts/predicate.mjs          ← canonical evaluator (pure ESM)
          │
     ┌────┴────────────────────────────┐
     ▼                                 ▼
scripts/run-assessment.mjs        app/lib/assessment.ts
├ rankNextActions()                └ 1-line re-export (passthrough)
└ writes rankedNextActions[10]
          │
          ▼
app/data/assessment.json        (new field; consumed by SKILL.md)
```

## `rankNextActions` algorithm (key properties)

- Iterates every `dim.nextActions` entry in the rubric.
- Skips actions where `satisfiedWhen && evaluatePredicate(satisfiedWhen, signalsSummary)`.
- Computes `rank = weight × deficit`, where `deficit` is `100 - score` for the action's
  axis (`platform` → setup score deficit; `execution` → execution score deficit).
- Sort key: rank descending → axis (`platform` → `execution` → `either`) → weight
  descending → `dimId` ascending → `actionId` ascending. Fully deterministic: same
  machine state → same ordering.
- Slices to `limit=10`. The skill reads `[0..2]`; the cap gives Slack/console room to
  expand without recomputing.

## What's in `assessment.json.rankedNextActions`

Each entry carries the fields the skill and any future Slack integration need:

```jsonc
{
  "dimId": "scheduled",
  "actionId": "promote-routine",
  "axis": "platform",
  "weight": 2,
  "deficit": 25,
  "rank": 50,
  "action": "Promote repeating patterns to a Routine (cloud-hosted, laptop-closed) — Boris tip 61",
  "effort": "30min",
  "borisTip": 61,
  "satisfiedWhen": "scheduleCommandUses>=1"
}
```

## Error handling philosophy

Predicate parse errors and missing signal fields both return `false` from `evaluatePredicate`,
which keeps the action in the output. Conservative: surface unexpected actions rather
than silently hiding them. This matches the existing TS behavior exactly.

## Hard rule shipped in PR 2

CLAUDE.md `## Hard rules` gains:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export
> — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts`
> asserts the two are reference-equal; a duplicate fails CI.

## Tests

PR 2 adds three test surfaces:

- **`scripts/__tests__/predicate.test.mjs`** — one test per operator class plus a
  rubric integration test (every `satisfiedWhen` in `rubric.json` must parse without
  throwing).
- **`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven ranker tests
  including a named regression for the `loopCommandUses=14 vs >=1` bug.
- **`app/lib/__tests__/predicate-passthrough.test.ts`** — asserts `fromTs === fromMjs`
  at reference equality so a future copy of the implementation fails CI.

## Non-goals

- No dashboard refactor. The `/methodology/probes` and `/dimensions/[id]` pages
  continue to evaluate predicates fresh at request time for per-action ✓/✗ marks.
- No Slack-post integration — `scripts/slack.mjs` does not render next-actions today.
- No DSL grammar changes. The seven operator classes are unchanged; this is a pure
  extraction and caller migration.

## The specific bug this prevents recurring

`loopCommandUses=14` satisfies `loopCommandUses>=1`. After PR 2, `rankNextActions`
evaluates the predicate server-side and excludes the action before writing
`rankedNextActions`. The model never sees it. The named regression test in
`rank-next-actions.test.mjs` locks this in: a future scorer change that accidentally
surfaces a satisfied action fails CI.

Full spec: [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md).
