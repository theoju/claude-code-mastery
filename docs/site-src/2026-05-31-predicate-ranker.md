---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions

**Date:** 2026-05-31  
**Status:** Approved — PR 1 (tactical) shipped; PR 2 (structural) queued

## Problem

`/self-assessment` was surfacing already-satisfied next-actions as high-priority work. Specifically: it reported `/loop 30m /babysit` as a top-3 item even when `signalsSummary.loopCommandUses=14` — a value that trivially satisfies the `loopCommandUses>=1` predicate guarding that action.

**Root cause.** The skill instructed the model to "filter satisfied actions, then rank." But the canonical `evaluatePredicate` implementation lived in `app/lib/assessment.ts`, which is Next.js-coupled and unavailable at runtime when the skill runs. The model hand-wrote a filter, that filter expected an object-shape predicate and silently skipped every string-form `satisfiedWhen` expression. String predicates are the common case in `rubric.json`.

## Decision

Fix in two PRs; both ship through the full `/ship` chain.

| PR | Shape | Description |
|----|-------|-------------|
| PR 1 (tactical) | Documentation | Insert a 12-line DSL grammar block into `SKILL.md` so a careful model can evaluate string predicates correctly. Stopgap until PR 2 lands. |
| PR 2 (structural) | Code | Extract `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, no external deps). Pre-compute filtered + ranked next-actions in `run-assessment.mjs` and write them to `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the PR 1 grammar block is deleted as obsolete. |

The structural fix eliminates the bug class, not just the instance. The skill no longer has to evaluate predicates at all.

## Architecture after PR 2

```
app/data/rubric.json          (DSL strings live here, unchanged)
         │
         ▼
scripts/predicate.mjs         ← NEW canonical evaluator (pure ESM)
         │
    ┌────┴──────────────────────────┐
    ▼                               ▼
scripts/run-assessment.mjs    app/lib/assessment.ts
├ ranks + filters nextActions  └ re-exports evaluatePredicate
└ writes rankedNextActions        (1-line passthrough; dashboard still
         │                         re-evals fresh for ✓ marks)
         ▼
app/data/assessment.json
(new rankedNextActions field; consumed by SKILL.md)
```

`app/lib/assessment.ts` becomes a one-line re-export:

```typescript
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

The dashboard's existing render paths (`/methodology/probes`, `/dimensions/[id]`) are untouched — they continue evaluating predicates fresh at request time for per-action ✓/✗ marks.

## `rankNextActions` algorithm

Pre-computed once per `npm run assess` run in `run-assessment.mjs`:

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
        continue;                          // ← satisfied: filtered out
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight,
                    deficit, rank: weight * deficit, action: na.action,
                    effort: na.effort, borisTip: na.borisTip,
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
```

**Tie-breaking order:** `rank` desc → axis (`platform` → `execution` → `either`) → `weight` desc → `dimId` asc → `actionId` asc. Deterministic on identical machine state, matching the project's "same state → same number" invariant.

**Limit:** 10 (constant). Gives Slack/console room without recomputing; the skill reads only `[0..2]`.

## Output schema addition

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
      "action": "Promote repeating patterns to a Routine (cloud-hosted, laptop-closed) — Boris tip 61",
      "effort": "30min",
      "borisTip": 61,
      "satisfiedWhen": "scheduleCommandUses>=1"
    }
    // ... up to 10 entries, sorted by rank desc
  ]
}
```

## Error handling

| Case | Behavior | Rationale |
|------|----------|-----------|
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Conservative: surface rather than hide |
| Signal field missing | Treated as `0` / `false` → action kept | Same |
| `na.action` text missing | Action skipped silently | Malformed rubric entry |
| Dim has no `nextActions` | Skip, continue | Normal case |
| `scoreMap` missing the dim | Skip, continue | Defensive |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior |

## Tests

Three new test files in PR 2:

**`scripts/__tests__/predicate.test.mjs`** — one test per operator class (`>=`, `<=`, `>`, `<`, `=`, `=v|w|x`, `!=`, `~regex`, `!path`, bare `path`, `A & B`), plus edge cases for missing fields, empty expressions, and nested paths. Also a rubric integration test: iterate every `satisfiedWhen` in `app/data/rubric.json` and assert none throw — proves the production rubric is fully supported.

**`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven: 3 dimensions, 5 actions. Includes a **named regression** for the triggering bug: with `loopCommandUses=14` the `loopCommandUses>=1`-gated action must not appear in output even if its rank would otherwise be highest.

**`app/lib/__tests__/predicate-passthrough.test.ts`** — reference-equality check:

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality — a copy fails CI
});
```

## Non-goals

- **No dashboard refactor.** Probes page and dimension drilldowns continue evaluating predicates at request time.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today; that is a future PR.
- **No DSL grammar changes.** The seven operator classes are unchanged; this is a pure extraction + caller migration.
- **No probe-tracker count changes.** No new probes are added.

## Hard rule (added in PR 2)

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Done when

- PR 1 merged: `/self-assessment` invocations show the DSL grammar inline in SKILL.md.
- PR 2 merged: `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim; SKILL.md grammar block gone.
- Named regression test (`loopCommandUses=14` vs `>=1`) passes and `/loop` no longer appears in top 3 when already adopted.
