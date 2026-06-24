---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate ranker design — pre-computing ranked next-actions

**Date:** 2026-05-31  
**Status:** Approved

## The bug

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority despite `signalsSummary.loopCommandUses=14` satisfying the action's `satisfiedWhen` predicate (`loopCommandUses>=1`).

Root cause: the skill instructs the model to "first filter, then rank," but the canonical DSL evaluator lives in `app/lib/assessment.ts` — TypeScript, Next.js-coupled by location — with no Node-side caller. The model hand-wrote a substitute filter expecting an object shape `{field, op, value}`, not a string expression. Every string predicate returned `null`; the filter was bypassed entirely; satisfied actions surfaced as top priorities.

## Decision

Two-phase fix:

1. **Tactical (PR 1 — #104):** insert a DSL grammar reference block inside SKILL.md so a careful model can evaluate predicates correctly. Stopgap.
2. **Structural (PR 2):** extract `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, Node-shareable), pre-compute the filtered + ranked top-N list once in `run-assessment.mjs`, and write it to `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the PR 1 grammar block is deleted as obsolete.

The structural fix eliminates the failure class entirely — no model needs to evaluate predicates at runtime.

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue evaluating predicates fresh at request time for per-action ✓/✗ marks. The new `rankedNextActions` field serves the skill, Slack post, and console — not the existing dashboard render paths.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today; that's a future PR.
- **No DSL grammar changes.** The operator classes stay exactly as-is; this is a pure extraction and caller migration.
- **No probe-tracker count changes.** This PR adds no probes; the tracker header is left alone.

## DSL grammar reference

Predicates are stored as string expressions in `app/data/rubric.json` and evaluated against `signalsSummary`. Operator classes:

| Form | Meaning |
| --- | --- |
| `path` | truthy — non-null, non-zero, non-empty-string; `"0"` and `"false"` are falsy |
| `!path` | falsy |
| `path>=N` / `path<=N` / `path>N` / `path<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals one of the listed values |
| `path!=v` | not equals |
| `path~regex` | array-of-strings — any element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation after PR 2: `scripts/predicate.mjs:evaluatePredicate` (also re-exported 1-line from `app/lib/assessment.ts`).

Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` → **true** → action is filtered out, not surfaced as a TODO.

## Architecture (PR 2)

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
```

The existing public surface is preserved: `evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean` keeps its signature. `assessment.json`'s existing fields are unchanged; only one new top-level key is added.

## `rankedNextActions` output schema

`assessment.json` gains one new top-level field, capped at 10 entries:

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
    // ... up to 10 entries, sorted by weight × deficit
  ]
}
```

Limit is **10** (constant, not configurable). The skill consumes `[0..2]`; the cap gives Slack and console room without recomputing.

## Ranking algorithm

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
        continue; // already satisfied — drop
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      const rank = weight * deficit;
      ranked.push({
        dimId: dim.id, actionId: na.id, axis, weight, deficit, rank,
        action: na.action, effort: na.effort, borisTip: na.borisTip,
        satisfiedWhen: na.satisfiedWhen ?? null,
      });
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

function axisOrder(a) {
  return a === "platform" ? 0 : a === "execution" ? 1 : 2;
}
```

Tie-breaking order: `rank` desc → axis (`platform` → `execution` → `either`) → `weight` desc → `dimId` asc → `actionId` asc. The deterministic sort ensures the same machine state always produces the same ordered list.

## Error handling

| Case | Behavior | Rationale |
| --- | --- | --- |
| Predicate parse error / unknown operator | Returns `false` → action kept | Matches existing TS behavior; conservative |
| Signal field missing | Treated as `0` / `false` → action kept | Same: surface, don't hide |
| `na.action` text missing | Skip silently | Malformed rubric; not a runtime concern |
| Dim has no `nextActions` | Skip, continue | Normal case |
| `scoreMap` missing the dim | Skip, continue | Defensive; shouldn't occur in practice |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior exactly |

## Testing

### `scripts/__tests__/predicate.test.mjs` (new)

One test per operator class plus edge cases: missing signals treated as zero, nested paths (`a.b.c`), `"0"` / `"false"` as falsy strings, empty/whitespace expressions. Rubric integration test iterates every `satisfiedWhen` value in `app/data/rubric.json` and asserts each parses without throwing — proves the production rubric is fully supported by the extracted evaluator.

### `scripts/__tests__/rank-next-actions.test.mjs` (new)

Fixture: 3 dimensions, 5 actions (mix of predicated, unpredicated, axis-tagged), plus a synthetic `scoreMap` and `signalsSummary`. Includes a **named regression**: `loopCommandUses=14` must exclude the `loopCommandUses>=1` action even when its `weight × deficit` would otherwise make it the top result. Also covers tie-breaking determinism, `limit` slicing, malformed-action skipping, and unpredicated actions always staying in.

### `app/lib/__tests__/predicate-passthrough.test.ts` (new)

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

A contributor who copies the implementation instead of re-exporting it fails CI.

## Hard rule (ships in PR 2)

`CLAUDE.md` gains under `## Hard rules`:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Ship sequencing

| PR | Scope | Estimate |
| --- | --- | --- |
| 1 — #104 | SKILL.md DSL grammar block (tactical stopgap) | ~10 min |
| 2 | Extract evaluator → `scripts/predicate.mjs`; bake `rankedNextActions` in `run-assessment.mjs`; delete PR 1 grammar block from SKILL.md | ~45–60 min |

PR 2 removes the grammar block PR 1 added, so SKILL.md settles to a tighter form: "Read `assessment.json.rankedNextActions[0..2]` — already filtered and ranked."

## Open risks

| Risk | Mitigation |
| --- | --- |
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified during exploration: ESM imports from TS work in Next.js 16 / Node 22+. Fallback: `.mts` shim |
| Re-rank changes existing `assessment.json` snapshot tests | Update snapshots in the same PR; document expected diff |
| Dashboard render path broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths |
| `rankedNextActions` field grows `assessment.json` size | Top-10 cap → ~3 KB worst case; the file is gitignored anyway |

## Done when

- PR 1 merges: `/self-assessment` invocations show the DSL grammar inline.
- PR 2 merges: `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim; SKILL.md grammar block is gone.
- The specific bug (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) does not recur — proven by the named regression test in `rank-next-actions.test.mjs`.
