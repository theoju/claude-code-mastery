---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions — design

**Date:** 2026-05-31  
**Status:** Approved — PR 1 merged (tactical), PR 2 (structural) in queue

## Triggering bug

On 2026-05-31, a `/self-assessment` run surfaced `Start with one loop: /loop 30m /babysit` as a top-3 priority action. `signalsSummary.loopCommandUses` was `14`, which satisfies the `satisfiedWhen` predicate `loopCommandUses>=1`. The action should have been filtered out.

Root cause: the SKILL.md instructed the model to "first filter satisfied actions, then rank." The canonical DSL evaluator lives in `app/lib/assessment.ts` (TypeScript, Next.js-coupled). No Node-side caller exists. The model running the skill hand-wrote its own filter that expected an object shape — `{ field, op, value }` — instead of the string DSL form (e.g. `"loopCommandUses>=1"`). The evaluator returned `null` for every predicate, bypassing filtering entirely.

## Goal

Eliminate the "model re-implements the DSL" class of bugs by ensuring no future skill invocation ever needs to evaluate a `satisfiedWhen` predicate.

Two PRs:

1. **Tactical (PR 1):** document the DSL grammar inline in the skill as a stopgap so a careful model can evaluate correctly while PR 2 is pending.
2. **Structural (PR 2):** extract `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, Node-importable), pre-compute the filtered + ranked top-10 list in `run-assessment.mjs`, and write it to `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the PR 1 grammar block is deleted as obsolete.

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue to evaluate predicates fresh at request time for per-action ✓/✗ marks.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today.
- **No DSL grammar changes.** The eight operator classes stay exactly as they are.
- **No probe-tracker count changes.** This change adds no probes.

## DSL grammar reference (PR 1 — tactical)

All `satisfiedWhen` values in `app/data/rubric.json` are strings evaluated against `signalsSummary`. The full grammar:

| Form | Meaning |
| --- | --- |
| `path` | truthy — non-null, non-zero, non-empty string; `"0"` and `"false"` are also falsy |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals, or equals one of a pipe-delimited list |
| `path!=v` | not equals |
| `path~regex` | array-of-strings: at least one element matches the regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate` (in PR 2, this becomes a re-export of `scripts/predicate.mjs`).

**Worked example:** `loopCommandUses>=1` with `signalsSummary.loopCommandUses = 14` evaluates to `true` → the action is satisfied → filter it out, do not surface as a TODO.

## Architecture (PR 2 — structural)

```
                      ┌─────────────────────────┐
                      │  app/data/rubric.json   │  (DSL strings live here, unchanged)
                      └────────────┬────────────┘
                                   │
                                   ▼
              ┌────────────────────────────┐
              │   scripts/predicate.mjs    │  ← NEW canonical evaluator (pure ESM)
              └────────────┬───────────────┘
                           │  imported by ↓
            ┌──────────────┴──────────────────────────┐
            ▼                                         ▼
  scripts/run-assessment.mjs               app/lib/assessment.ts
  ├ ranks + filters nextActions            └ re-exports evaluatePredicate
  └ writes rankedNextActions[10]             (1-line passthrough; dashboard
              │                               still re-evals fresh for ✓ marks)
              ▼
    app/data/assessment.json
    (new top-level field; consumed by SKILL.md)
              │
              ▼
  SKILL.md grammar block (PR 1) — DELETED in PR 2 once the field exists
```

`evaluatePredicate` keeps its existing signature: `(expr: string, signals: Record<string, unknown>): boolean`. `assessment.json`'s existing fields are unchanged; only one new top-level field is added.

### Files added (PR 2)

| Path | Purpose |
| --- | --- |
| `scripts/predicate.mjs` | Pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` from `app/lib/assessment.ts` lines 165–259. Exports `evaluatePredicate`. No external dependencies. |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration test. |
| `scripts/__tests__/rank-next-actions.test.mjs` | Fixture-driven tests for the ranker, including the named regression for `loopCommandUses=14 vs >=1`. |

### Files modified (PR 2)

| Path | Change |
| --- | --- |
| `app/lib/assessment.ts` | Replace local `evaluatePredicate` + helpers (lines 165–259) with `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`; add `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)`; attach result to written assessment under `rankedNextActions`. |
| `app/data/rubric.json` | Update `$schema` comment: canonical evaluator is now `scripts/predicate.mjs`. |
| `.claude/skills/self-assessment/SKILL.md` | Replace "first filter … then rank" instructions with "Read `assessment.json.rankedNextActions[0..2]`"; delete PR 1 grammar block. |
| `CLAUDE.md` | File map gains `predicate.mjs`; new hard rule added (see below). |

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
      ranked.push({
        dimId: dim.id,
        actionId: na.id,
        axis,
        weight,
        deficit,
        rank,
        action: na.action,
        effort: na.effort,
        borisTip: na.borisTip,
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
```

### Tie-breaking order

1. `rank` descending (primary: `weight × deficit`)
2. axis: `platform` → `execution` → `either` (configuration changes are usually higher-leverage)
3. `weight` descending
4. `dimId` ascending (locale-aware)
5. `actionId` ascending (locale-aware)

Deterministic across runs on identical machine state — matching the "same machine state → same number" contract.

### Output schema

`assessment.json` gains one new top-level field. Limit is **10** (constant, not configurable) — gives the Slack post and console room without recomputing; the skill only reads `[0..2]`.

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
    // ... up to 10 entries, sorted by rank
  ]
}
```

## Error handling

| Case | Behavior | Rationale |
| --- | --- | --- |
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Matches TS behavior; conservative (surface, don't hide) |
| Signal field missing | Treated as `0` / `false` → action kept | Same: conservative |
| `na.action` text missing | Skip silently | Malformed rubric; not a runtime concern |
| Dim has no `nextActions` | Skip, continue | Normal case |
| `scoreMap` missing the dim | Skip, continue | Defensive; shouldn't happen in practice |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior exactly |

## Testing (PR 2)

### `scripts/__tests__/predicate.test.mjs`

One test per operator class plus edge cases: all eight forms, nested path resolution (`a.b.c`), missing intermediates, empty/whitespace expressions, and a rubric integration test (iterate every `satisfiedWhen` in `app/data/rubric.json` and assert it parses without throwing).

### `scripts/__tests__/rank-next-actions.test.mjs`

Fixture: 3 dimensions, 5 actions (mix of predicated, unpredicated, axis-tagged), synthetic `scoreMap` and `signalsSummary`. Tests include:

- Happy path: first entry has highest `weight × deficit`; length ≤ limit
- **Named regression:** `loopCommandUses=14` excludes `loopCommandUses>=1` action (the specific bug this design fixes)
- Tie-breaking is deterministic
- `limit` slices correctly; `limit=0` returns empty
- Malformed action (missing `action` text) is dropped silently
- Unpredicated action stays regardless of signals

### TS ↔ MJS equivalence test (`app/lib/__tests__/predicate-passthrough.test.ts`)

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

A future contributor who copies the implementation instead of re-exporting it fails CI.

## Hard rule (lands in PR 2)

Added to `CLAUDE.md`:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Ship sequencing

| # | PR | Estimate |
| --- | --- | --- |
| 1 | SKILL.md DSL grammar (tactical, additive) | ~10 min |
| 2 | Extract evaluator + bake `rankedNextActions` + delete PR 1 grammar block | ~45–60 min |

PR 2 explicitly removes what PR 1 added. The SKILL.md surface settles to its final tighter form only after PR 2 lands.

## Open risks

| Risk | Mitigation |
| --- | --- |
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified: ESM imports from TS work natively in Next.js 16 / Node 22+. Fallback: `.mts` shim. |
| Re-rank changes existing `assessment.json` snapshot tests | Update snapshots in the same PR; document expected diff. |
| Dashboard render path broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths. |
| `rankedNextActions` grows `assessment.json` size | Top-10 cap keeps growth bounded (~3 KB worst case); gitignored anyway. |

## Done when

- PR 1 merges: `/self-assessment` invocations include the DSL grammar inline.
- PR 2 merges: `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim; SKILL.md grammar block is gone.
- Today's specific bug (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) does not recur, proven by the named regression test in `rank-next-actions.test.mjs`.
