---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: predicate evaluator + ranked next-actions

**Date:** 2026-05-31  
**Status:** Approved — PR 1 (tactical) shipped; PR 2 (structural) filed

## Triggering bug

On 2026-05-31, running `/self-assessment` surfaced `Start with one loop: /loop 30m /babysit` as a top-3 priority action even though `signalsSummary.loopCommandUses = 14`. The action's predicate is `loopCommandUses>=1` — clearly satisfied — so it should have been filtered out before ranking.

Root cause: the skill instructed the model to "first filter, then rank" but the canonical DSL evaluator lives in `app/lib/assessment.ts` (TypeScript, Next.js-coupled). No Node-side caller existed. The model running the skill hand-wrote a filter that expected `satisfiedWhen` to be an object with shape `{field, op, value}`. The rubric stores string expressions instead (e.g. `"loopCommandUses>=1"`). The hand-rolled evaluator returned `null` for every string predicate, skipping all filtering, and the already-satisfied action rose to the top of the ranked list.

## Decision

Fix this with two PRs:

1. **PR 1 — Tactical (docs-first stopgap):** Add a DSL grammar reference block to `.claude/skills/self-assessment/SKILL.md` so a model running the skill can evaluate predicates correctly without reimplementing them. Explicitly marked as temporary.
2. **PR 2 — Structural:** Extract `evaluatePredicate` to a Node-shareable `scripts/predicate.mjs`. Pre-compute the filtered and ranked top-10 list in `run-assessment.mjs` and write it to `assessment.json.rankedNextActions`. The skill becomes a trivial reader of a pre-computed field; the grammar block from PR 1 is deleted as obsolete.

## Non-goals

- No dashboard refactor. `/methodology/probes` and `/dimensions/[id]` continue evaluating predicates at request time for per-action ✓/✗ marks — the new field serves the skill, Slack post, and console printer, not the dashboard's existing render paths.
- No Slack-post integration in this pair of PRs.
- No DSL grammar changes. The operator classes stay exactly as they are today; this is a pure extraction and caller migration.
- No probe-tracker count changes. These PRs add no probes.

## Architecture

```
                      ┌─────────────────────────┐
                      │  app/data/rubric.json   │  (DSL strings live here, unchanged)
                      └────────────┬────────────┘
                                   │
                                   ▼
PR 2 →            ┌────────────────────────────┐
                  │   scripts/predicate.mjs    │  ← NEW canonical evaluator (pure ESM)
                  └────────────┬───────────────┘
                               │  imported by ↓
            ┌──────────────────┴───────────────────────┐
            ▼                                          ▼
  scripts/run-assessment.mjs                  app/lib/assessment.ts
  ├ ranks + filters nextActions               └ re-exports evaluatePredicate
  └ writes rankedNextActions[10]                (1-line passthrough; dashboard
                  │                              still re-evals fresh for ✓ marks)
                  ▼
        app/data/assessment.json
        (new top-level field; consumed by SKILL.md)
                  │
                  ▼
PR 1 → SKILL.md tactical block (DSL grammar) — DELETED in PR 2 once field exists
```

Both PRs preserve the existing public surface. `evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean` keeps its signature. `assessment.json`'s existing fields are unchanged; only one new top-level field is added.

## PR 1 — Tactical: SKILL.md DSL grammar block

**Files touched:** `.claude/skills/self-assessment/SKILL.md` (additive only).

The inserted block documents all seven operator classes with a canonical-implementation pointer:

| Operator form | Meaning |
|---|---|
| `path` | truthy check (non-null, non-zero, non-empty; `"0"` and `"false"` are falsy) |
| `!path` | falsy check |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals, or equals one of |
| `path!=v` | not equals |
| `path~regex` | array-of-strings: any element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`. Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to `true` → filter the action out, do not surface as a TODO.

No tests — pure documentation. Verified by the existing skill snapshot tests (if any) passing through the normal `/ship` chain.

## PR 2 — Structural: extract + bake

### New files

| Path | Purpose |
|---|---|
| `scripts/predicate.mjs` | Pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` from `app/lib/assessment.ts`. Exports `evaluatePredicate`. No external dependencies. |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration test. |
| `scripts/__tests__/rank-next-actions.test.mjs` | Fixture-driven tests for the ranker, including a named regression for the `loopCommandUses=14 vs >=1` bug. |

### Modified files

| Path | Change |
|---|---|
| `app/lib/assessment.ts` | Replace local `evaluatePredicate` + helpers with a 1-line re-export from `scripts/predicate.mjs`. |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`. Add `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)`. Attach result to written assessment under `rankedNextActions`. |
| `app/data/rubric.json` | Update `$schema` comment to note canonical evaluator is `scripts/predicate.mjs`. |
| `.claude/skills/self-assessment/SKILL.md` | Replace "first filter … then rank" instructions with a read of `assessment.json.rankedNextActions[0..2]`. Delete the PR 1 grammar block. |
| `CLAUDE.md` | Add `predicate.mjs` to the file map. Add new hard rule (see below). |

### `rankNextActions` algorithm

```javascript
function rankNextActions(rubric, scoreMap, signalsSummary, limit = 10) {
  const ranked = [];
  for (const dim of rubric.dimensions) {
    const scored = scoreMap.get(dim.id);
    if (!scored) continue;
    const weight = dim.weight ?? 1;
    const pDeficit = Math.max(0, 100 - scored.score);
    const xDeficit =
      scored.executionScore == null
        ? 0
        : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions ?? []) {
      if (!na.action) continue;
      if (na.satisfiedWhen && evaluatePredicate(na.satisfiedWhen, signalsSummary))
        continue;
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      const rank = weight * deficit;
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight,
                    deficit, rank, action: na.action, effort: na.effort,
                    borisTip: na.borisTip, satisfiedWhen: na.satisfiedWhen ?? null });
    }
  }
  ranked.sort(
    (a, b) =>
      b.rank - a.rank ||
      axisOrder(a.axis) - axisOrder(b.axis) ||
      b.weight - a.weight ||
      a.dimId.localeCompare(b.dimId) ||
      a.actionId.localeCompare(b.actionId),
  );
  return ranked.slice(0, limit);
}
```

### Tie-breaking

Sort key in order: (1) `rank` descending, (2) axis (`platform` → `execution` → `either` — platform-axis fixes are typically higher-leverage configuration changes), (3) `weight` descending, (4) `dimId` ascending, (5) `actionId` ascending. This guarantees the same machine state always produces the same list.

### Output schema

`assessment.json` gains one new top-level field:

```jsonc
{
  // ... existing fields unchanged ...
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

`limit` is **10** (constant). Gives Slack/console consumers room to pick without recomputing; cheap at ~3 KB worst case; the skill only reads `[0..2]`.

## Error handling

| Case | Behavior | Rationale |
|---|---|---|
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Conservative: surface rather than hide |
| Signal field missing | Treated as `0`/`false` → action kept | Same |
| `na.action` text missing | Skip the action, no warning | Malformed rubric; not our problem at runtime |
| Rubric dim has no `nextActions` | Skip, continue | Normal case |
| `scoreMap` missing the dim | Skip, continue | Defensive; shouldn't happen in practice |
| Regex parse failure on `~` | Atom returns `false` | Matches existing TS behavior |

## Testing

### `scripts/__tests__/predicate.test.mjs`

One test per operator class plus edge cases (missing signal treated as `0`, nested `a.b.c` path resolution, empty/whitespace expression returns `false`). Includes a rubric integration test: iterate every `satisfiedWhen` value in `app/data/rubric.json` and assert each parses without throwing.

### `scripts/__tests__/rank-next-actions.test.mjs`

Fixture-driven. Key cases:

| Test | Asserts |
|---|---|
| Happy path | First entry has highest `weight × deficit`; length ≤ limit |
| **Named regression:** `loopCommandUses=14` | The `loopCommandUses>=1` action is absent from output |
| Tie-breaking is deterministic | Two equal-rank actions order by axis → weight → dimId → actionId |
| `limit` slices correctly | `limit=3` returns ≤ 3; `limit=0` returns empty |
| Malformed action skipped | Action without `action` text is dropped silently |
| Unpredicated action stays | Action with no `satisfiedWhen` is always included |

### TS ↔ MJS equivalence (`app/lib/__tests__/predicate-passthrough.test.ts`)

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

A future contributor who copies instead of re-exports fails CI immediately.

## Hard rule (added to CLAUDE.md in PR 2)

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Ship sequencing

| # | PR | Estimate |
|---|---|---|
| 1 | T1 — SKILL.md DSL grammar (tactical stopgap) | ~10 min |
| 2 | S1 — Extract evaluator + bake `rankedNextActions` + delete T1 grammar block | ~45–60 min |

PR 2 explicitly removes the grammar block PR 1 added. The SKILL.md surface settles to a tighter form: a single instruction to read `assessment.json.rankedNextActions[0..2]`.

## Open risks

| Risk | Mitigation |
|---|---|
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified during exploration: ESM imports from TS work natively in Next.js 16 / Node 22+. Fallback: a `.mts` shim. |
| Re-rank changes existing snapshot tests on `assessment.json` | Update snapshots in the same PR; document expected diff |
| Dashboard render path inadvertently broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths |
| `rankedNextActions` grows `assessment.json` size | Top-10 cap keeps growth bounded (~3 KB worst case); file is gitignored anyway |

## Done when

- PR 1 merges and `/self-assessment` invocations include the DSL grammar inline.
- PR 2 merges and `/self-assessment` invocations read `assessment.json.rankedNextActions[0..2]` verbatim, with the grammar block gone.
- The specific regression (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) does not recur — proven by the named regression test in `rank-next-actions.test.mjs`.
