---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions — design decision

**Date:** 2026-05-31  
**Status:** Approved — PR 1 of 2 shipped

## The bug

`/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority action despite `signalsSummary.loopCommandUses=14`, which satisfies its `satisfiedWhen` predicate (`loopCommandUses>=1`). The satisfied action should have been filtered out.

Root cause: the skill instructed the model to "first filter, then rank" but the canonical DSL evaluator lived in `app/lib/assessment.ts` — TypeScript-only, Next.js-coupled by location. No Node-side caller existed. The model running the skill hand-wrote its own filter, expected an object shape, and silently skipped string predicates entirely.

This is a repeating bug class, not a one-off: any model executing the skill can re-implement the DSL differently. The fix needs to be structural.

## Two-part approach

### PR 1 — Tactical (shipped)

Add a DSL grammar block to `.claude/skills/self-assessment/SKILL.md` so a careful model can evaluate `satisfiedWhen` predicates correctly while the structural fix is in flight. Stopgap only — the grammar block is explicitly deleted in PR 2.

**Files touched:** `.claude/skills/self-assessment/SKILL.md` (additive only, one new sub-block under the `Top 3 priority actions` bullet).

No tests — pure documentation. The bug is architectural; a test of the skill prompt wouldn't catch the structural failure.

### PR 2 — Structural (planned)

Extract `evaluatePredicate` + helpers (`readPath`, `isTruthy`, `evaluateAtomic`) from `app/lib/assessment.ts` lines 165–259 into a new `scripts/predicate.mjs` (pure ESM, no external dependencies). Pre-compute the filtered and ranked top-N list once per assessment run inside `scripts/run-assessment.mjs` and write it to `assessment.json` as `rankedNextActions`. The skill becomes a trivial reader of pre-computed data; the DSL grammar block from PR 1 is deleted as obsolete.

**Files added:**

| Path | Purpose |
|---|---|
| `scripts/predicate.mjs` | Canonical evaluator — pure ESM port of TS helpers |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration test |
| `scripts/__tests__/rank-next-actions.test.mjs` | Fixture-driven ranker tests, including named regression |

**Files modified:**

| Path | Change |
|---|---|
| `app/lib/assessment.ts` | Replace local implementation with `export { evaluatePredicate } from "../../scripts/predicate.mjs"` (1-line passthrough) |
| `scripts/run-assessment.mjs` | Import evaluator; add `rankNextActions`; attach result to written assessment |
| `app/data/rubric.json` | Update `$schema` comment to note canonical evaluator is `scripts/predicate.mjs` |
| `.claude/skills/self-assessment/SKILL.md` | Replace filter/rank instructions with a read of `assessment.json.rankedNextActions[0..2]`; delete PR 1 grammar block |
| `CLAUDE.md` | Add `predicate.mjs` to file map; add new DSL hard rule |

## DSL grammar

The `satisfiedWhen` field in `app/data/rubric.json` uses these operator classes, evaluated against `signalsSummary`:

| Operator | Example | Semantics |
|---|---|---|
| bare `path` | `loopCommandUses` | truthy — non-null, non-zero, non-empty-string; `"0"` and `"false"` are falsy |
| `!path` | `!hookCount` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | `loopCommandUses>=1` | numeric comparison |
| `path=v` | `effortLevel=max` | string equality |
| `path=v\|w\|x` | `effortLevel=max\|normal` | matches any of the listed values |
| `path!=v` | `effortLevel!=default` | not equal |
| `path~regex` | `agentNames~deploy` | at least one element of an array matches (case-insensitive); non-array LHS → false |
| `A & B` | `loopCommandUses>=1 & scheduleCommandUses>=1` | AND of two or more atoms |

Missing signal fields are treated as `0` / `false`. Unknown operators or malformed expressions return `false` (conservative — surface the action rather than hiding it).

The example from the triggering bug: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to **true** — the action is satisfied and must not appear in the output.

## `rankNextActions` algorithm

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
      if (!na.action) continue; // skip malformed
      if (na.satisfiedWhen && evaluatePredicate(na.satisfiedWhen, signalsSummary))
        continue; // filter satisfied actions
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      const rank = weight * deficit;
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight, deficit, rank,
                    action: na.action, effort: na.effort, borisTip: na.borisTip,
                    satisfiedWhen: na.satisfiedWhen ?? null });
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

function axisOrder(a) { return a === "platform" ? 0 : a === "execution" ? 1 : 2; }
```

**Tie-breaking order:** `rank` descending → `platform` before `execution` before `either` → `weight` descending → `dimId` ascending → `actionId` ascending. Deterministic across runs on identical machine state, matching the project's "same machine state → same number" promise.

## Output field: `rankedNextActions`

`assessment.json` gains one new top-level array. The limit is **10** (constant; not configurable). The skill reads `[0..2]`; Slack post and console have room to grow without recomputing.

```jsonc
{
  // ...existing fields unchanged...
  "rankedNextActions": [
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
    // ...up to 10 entries, sorted by rank
  ]
}
```

## Testing

**`scripts/__tests__/predicate.test.mjs`** — one test per operator class, edge cases (missing fields, `"0"` falsy, nested paths, empty expressions), plus a rubric integration test that iterates every `satisfiedWhen` value in `app/data/rubric.json` and asserts each parses without throwing.

**`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven against a small 3-dimension rubric with 5 actions. Includes a named regression: `loopCommandUses=14` must exclude `loopCommandUses>=1` from output even if its rank would otherwise be highest.

**`app/lib/__tests__/predicate-passthrough.test.ts`** — reference-equality assertion:

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

This prevents a future contributor from copying the implementation instead of re-exporting — a copy fails CI.

## New hard rule

PR 2 adds to `CLAUDE.md`:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue to evaluate predicates fresh at request time for per-action ✓/✗ marks. The new field serves the skill, Slack post, and console — not the dashboard's existing render paths.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today; adding that is a future PR.
- **No DSL grammar changes.** The eight operator classes stay exactly as today; this is a pure extraction and caller migration.
- **No probe-tracker count changes.** No probes are added; the tracker header is left alone.

## Open risks

| Risk | Mitigation |
|---|---|
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified: ESM imports from TS work in Next.js 16 / Node 22+. Fallback: `.mts` shim. |
| Re-rank changes existing snapshot tests on `assessment.json` | Update snapshots in same PR; document expected diff |
| Dashboard render broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths |
| `rankedNextActions` field grows `assessment.json` size | Top-10 cap bounds growth (~3 KB worst case); file is gitignored |

## Ship sequencing

| # | PR | Estimate |
|---|---|---|
| 1 | SKILL.md DSL grammar (tactical stopgap) — **shipped** | ~10 min |
| 2 | Extract evaluator + bake `rankedNextActions` + delete PR 1 grammar block | ~45–60 min |

PR 2 explicitly removes what PR 1 added, so the SKILL.md surface settles to a lower-maintenance form: one line pointing at pre-computed data instead of a 12-line grammar the model must interpret correctly.

## Done when

- PR 1 merged — `/self-assessment` invocations include the DSL grammar inline.
- PR 2 merged — `/self-assessment` invocations read `assessment.json.rankedNextActions[0..2]` verbatim; SKILL.md grammar block gone.
- The specific regression (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) does not recur — proven by the named regression test in `rank-next-actions.test.mjs`.
