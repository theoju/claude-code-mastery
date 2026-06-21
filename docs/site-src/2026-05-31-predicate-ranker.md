---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: predicate evaluator extraction + ranked next-actions

**Date:** 2026-05-31
**Status:** PR 1 merged; PR 2 pending

## The bug

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority action despite `signalsSummary.loopCommandUses = 14`. The `satisfiedWhen` predicate for that action is `loopCommandUses>=1` — satisfied, so the action should have been filtered out entirely.

Root cause: the `/self-assessment` skill instructed the model to "first filter, then rank" next-actions by evaluating `satisfiedWhen` predicates, but the canonical DSL evaluator (`app/lib/assessment.ts:evaluatePredicate`) is TypeScript and Next.js-coupled — no Node-side caller existed. The model hand-wrote a filter that expected an object shape `{field, op, value}` instead of the DSL string `"loopCommandUses>=1"`, so every string predicate silently returned null and every action was passed through unsatisfied.

## Decision

Two PRs, sequenced tactical-then-structural.

**PR 1 (tactical, stopgap):** Insert the DSL grammar into `.claude/skills/self-assessment/SKILL.md` so a model running the skill can evaluate predicates correctly without re-implementing them. No code changes.

**PR 2 (structural, eliminates the bug class):** Extract `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, no external dependencies). Pre-compute the filtered and ranked top-10 list once inside `scripts/run-assessment.mjs` and write it to `assessment.json.rankedNextActions`. The skill becomes a trivial reader of that pre-computed field. The PR 1 grammar block is deleted as obsolete.

## DSL grammar (PR 1 documentation block)

The `satisfiedWhen` field in `app/data/rubric.json` is a string expression evaluated against `signalsSummary`. Seven operator classes:

| Pattern            | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `path`             | truthy (non-null, non-zero, non-empty; `"0"` and `"false"` are falsy)  |
| `!path`            | falsy                                                                   |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison                                       |
| `path=v`           | equals (string or numeric)                                              |
| `path=v\|w\|x`    | equals one of                                                           |
| `path!=v`          | not equals                                                              |
| `path~regex`       | array-of-strings element matches regex (case-insensitive)               |
| `A & B`            | AND of two or more atoms                                                |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`. Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to `true` → filter the action out, do not surface as a TODO.

## PR 2 architecture

```
app/data/rubric.json   (DSL strings live here, unchanged)
        │
        ▼
scripts/predicate.mjs          ← NEW canonical evaluator (pure ESM)
        │  imported by ↓
        ├─ scripts/run-assessment.mjs
        │    ├ ranks + filters nextActions
        │    └ writes rankedNextActions[10] → app/data/assessment.json
        │
        └─ app/lib/assessment.ts
             └ 1-line re-export (dashboard still re-evals fresh for ✓ marks)
```

Both existing public surfaces are preserved: `evaluatePredicate(expr, signals)` keeps its signature; `assessment.json`'s existing fields are unchanged; only one new top-level field is added.

### `rankNextActions` algorithm

For each dimension in `rubric.json`:

1. Compute `pDeficit = max(0, 100 − platformScore)` and `xDeficit = max(0, 100 − executionScore)`.
2. For each `nextAction` in the dimension: skip if `na.action` is missing; skip if `na.satisfiedWhen` evaluates to `true` against `signalsSummary`.
3. `rank = weight × deficit` where `deficit` is `xDeficit` for execution-axis actions, `pDeficit` otherwise.
4. Sort by `rank` descending, then by axis (`platform → execution → either`), then `weight` descending, then `dimId` / `actionId` ascending for full determinism.
5. Slice to 10.

### Output schema

`assessment.json` gains one new top-level field:

```jsonc
{
  "rankedNextActions": [
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
      "satisfiedWhen": "scheduleCommandUses>=1"
    }
    // ... up to 10 entries, sorted by rank
  ]
}
```

## Error handling

| Case                              | Behavior                              |
| --------------------------------- | ------------------------------------- |
| Predicate parse error             | Returns `false` → action is kept (conservative) |
| Signal field missing              | Treated as `0` / `false` → action kept |
| `na.action` text missing          | Action skipped silently               |
| Regex parse failure on `~`        | Atom returns `false`                  |

## Testing

PR 2 ships three new test files:

- **`scripts/__tests__/predicate.test.mjs`** — one test per operator class, plus a rubric integration test that iterates every `satisfiedWhen` in `app/data/rubric.json` and asserts none throws.
- **`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven ranker tests, including a named regression: `loopCommandUses=14` must exclude the `loopCommandUses>=1` action.
- **`app/lib/__tests__/predicate-passthrough.test.ts`** — asserts `evaluatePredicate` from the TS re-export and from `scripts/predicate.mjs` are the same reference. A contributor who copies instead of re-exports fails CI.

## Hard rule added in PR 2

`CLAUDE.md` gains under `## Hard rules`:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## What changes for the `/self-assessment` skill

After PR 2 merges, the skill reads `assessment.json.rankedNextActions[0..2]` directly — already filtered (satisfied actions dropped) and ranked by `weight × deficit`. The skill no longer needs to evaluate predicates or rank actions itself; the DSL grammar block from PR 1 is deleted.

## What does not change

- `/methodology/probes` and `/dimensions/[id]` continue to evaluate predicates fresh at request time for per-action ✓/✗ marks.
- `scripts/slack.mjs` does not render next-actions; that is future work.
- The DSL grammar itself: the eight operator classes are unchanged.
- The probe tracker: this pair of PRs adds no probes.

## Open risks

| Risk | Mitigation |
| ---- | ---------- |
| Next.js 16 TS importing `.mjs` surprises | ESM imports from TS work natively in Next.js 16 / Node 22+; fallback to `.mts` shim if build errors surface |
| Re-rank changes existing `assessment.json` snapshot tests | Update snapshots in PR 2; document expected diff |
| `rankedNextActions` grows assessment.json size | Top-10 cap keeps growth to ~3 KB worst case; file is gitignored |

## Done when

- PR 1 merged: `/self-assessment` invocations inline the DSL grammar; the `loopCommandUses` misfire does not recur.
- PR 2 merged: the skill reads `rankedNextActions[0..2]` verbatim; the grammar block is gone; the named regression test in `rank-next-actions.test.mjs` proves the original bug is closed.
