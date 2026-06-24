---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate ranker — implementation plan

**Date:** 2026-05-31  
**Design spec:** `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`

## Context

`/self-assessment` surfaced `Start with one loop: /loop 30m /babysit` as a
top-3 priority even though `signalsSummary.loopCommandUses=14` should have
filtered it out. The `satisfiedWhen` predicate is `loopCommandUses>=1` — a
string expression. The model running the skill expected a structured object
`{field, op, value}`, found a string, and skipped predicate evaluation
entirely. Every action with a predicate survived the filter.

Root cause: `evaluatePredicate` lives in `app/lib/assessment.ts`, which is
Next.js-coupled. No Node-side caller exists, so the skill has nowhere to
delegate the filter step — it has to re-implement it, and can get it wrong.

Fix: two PRs. PR 1 (tactical) documents the DSL grammar inline in the skill
so a careful model can evaluate correctly. PR 2 (structural) extracts the
evaluator to a Node-shareable module and pre-computes the filtered + ranked
list in `assessment.json`. The skill becomes a trivial reader.

## PR 1 — Done (merged as PR #104)

**Scope:** `.claude/skills/self-assessment/SKILL.md`, additive only.

Inserted the `satisfiedWhen` DSL grammar block beneath the `Top 3 priority
actions` bullet:

- `path` — truthy (non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`.

**This block is temporary.** PR 2 deletes it once `assessment.json.rankedNextActions` exists.

## PR 2 — Structural (extract + bake)

### New files

| Path | Purpose |
| --- | --- |
| `scripts/predicate.mjs` | Pure-ESM port of `evaluatePredicate` and helpers from `app/lib/assessment.ts` lines 165–259. No external dependencies. |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration test (every `satisfiedWhen` in `rubric.json` parses without throwing). |
| `scripts/__tests__/rank-next-actions.test.mjs` | Fixture-driven ranker tests, including a named regression for the `loopCommandUses=14 vs >=1` bug. |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Asserts `fromTs === fromMjs` (reference equality) — fails CI if someone copies instead of re-exports. |

### Modified files

| Path | Change |
| --- | --- |
| `app/lib/assessment.ts` | Replace local `evaluatePredicate` + helpers with a 1-line `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`. Add `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)`. Attach result to written assessment as `rankedNextActions`. |
| `app/data/rubric.json` | Update `$schema` comment: canonical evaluator is now `scripts/predicate.mjs`. |
| `.claude/skills/self-assessment/SKILL.md` | Replace "first filter … then rank" instructions with "Read `assessment.json.rankedNextActions[0..2]`". **Delete the PR 1 grammar block.** |
| `CLAUDE.md` | Add `predicate.mjs` to the file map. Add the "DSL evaluator has one source" hard rule. |

### `rankedNextActions` output shape

`assessment.json` gains one new top-level field. Each entry:

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
  "satisfiedWhen": "scheduleCommandUses>=1"
}
```

`limit` is 10 (constant). Sort key: `rank` descending → axis (`platform` →
`execution` → `either`) → `weight` descending → `dimId` ascending →
`actionId` ascending. Deterministic: same machine state → same list.

### Ranker algorithm

```javascript
function rankNextActions(rubric, scoreMap, signalsSummary, limit = 10) {
  const ranked = [];
  for (const dim of rubric.dimensions) {
    const scored = scoreMap.get(dim.id);
    if (!scored) continue;
    const weight = dim.weight ?? 1;
    const pDeficit = Math.max(0, 100 - scored.score);
    const xDeficit =
      scored.executionScore == null ? 0 : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions ?? []) {
      if (!na.action) continue;
      if (na.satisfiedWhen && evaluatePredicate(na.satisfiedWhen, signalsSummary))
        continue;
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight, deficit,
                    rank: weight * deficit, action: na.action, effort: na.effort,
                    borisTip: na.borisTip, satisfiedWhen: na.satisfiedWhen ?? null });
    }
  }
  ranked.sort((a, b) =>
    b.rank - a.rank || axisOrder(a.axis) - axisOrder(b.axis) ||
    b.weight - a.weight || a.dimId.localeCompare(b.dimId) ||
    a.actionId.localeCompare(b.actionId));
  return ranked.slice(0, limit);
}
```

### Error handling

| Case | Behavior |
| --- | --- |
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept (conservative) |
| Signal field missing | Treated as `0` / `false` → action kept |
| `na.action` text missing | Action skipped silently |
| Dim missing from `scoreMap` | Skip that dim, continue |

### Testing checklist

- [ ] `predicate.test.mjs`: one test per operator class, plus `A & B` multi-atom, nested path, empty expression
- [ ] `predicate.test.mjs`: rubric integration — every `satisfiedWhen` in `rubric.json` parses without throwing
- [ ] `rank-next-actions.test.mjs`: named regression — `loopCommandUses=14` excludes the `loopCommandUses>=1` action
- [ ] `rank-next-actions.test.mjs`: tie-breaking is deterministic on equal `rank`
- [ ] `run-assessment.test.mjs`: `rankedNextActions` field present, is array, length ≤ 10, each entry has all required keys
- [ ] `predicate-passthrough.test.ts`: `fromTs === fromMjs` (reference equality)
- [ ] Existing dashboard render-path tests pass (no evaluator regression)

## Ship sequencing

| # | PR | Estimate |
| --- | --- | --- |
| 1 | T1 — SKILL.md DSL grammar (already merged, PR #104) | done |
| 2 | S1 — Extract evaluator + bake `rankedNextActions` + delete T1 grammar block | ~45–60 min |

PR 2 goes through the full `/ship` chain: test → verify-agent → simplify →
code review → commit → push → PR → Jira. It explicitly removes the SKILL.md
grammar block added in PR 1, so the skill surface settles to a tighter, lower-maintenance
form after both PRs land.

## Done when

- PR 2 merges and `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim.
- The SKILL.md DSL grammar block is gone.
- The named regression test in `rank-next-actions.test.mjs` proves today's specific bug (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) cannot recur.
- `predicate-passthrough.test.ts` pins `app/lib/assessment.ts` as a 1-line re-export forever.
