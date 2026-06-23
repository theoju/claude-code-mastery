---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions — design

**Date:** 2026-05-31  
**Status:** Approved  
**PR:** [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)

## Triggering bug

On 2026-05-31 a model running `/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority action despite `signalsSummary.loopCommandUses=14` — a value that trivially satisfies the action's `satisfiedWhen` predicate (`loopCommandUses>=1`). Root cause: the skill instructs the model to "first filter, then rank," but the canonical DSL evaluator lives in `app/lib/assessment.ts` (TypeScript, Next.js-coupled by location), and no Node-side caller exists. The model hand-wrote a filter that expected `satisfiedWhen` to be an object `{field, op, value}` rather than a string. It skipped string predicates entirely; `evaluatePredicate` returned `null` for every predicate; filtering was suppressed; and a satisfied action surfaced as a top priority.

## Goal

Eliminate the "model re-implements the DSL" bug class permanently. Two-PR strategy:

1. **Tactical (PR 1):** document the DSL grammar inside the skill so a careful model can evaluate predicates correctly. Stopgap until PR 2 lands.
2. **Structural (PR 2):** extract `evaluatePredicate` to a Node-shareable `scripts/predicate.mjs`, then pre-compute the filtered + ranked top-N list once in `run-assessment.mjs` and write it to `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the DSL grammar block from PR 1 is deleted as obsolete.

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue to evaluate predicates fresh at request time for per-action ✓/✗ marks. The new field serves the skill, the Slack post, and the console printer — not the dashboard's existing render paths.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today; that is a future PR.
- **No DSL grammar changes.** The seven operator classes (see below) stay exactly as today; this is a pure extraction and caller migration.
- **No probe-tracker count changes.** This PR adds no probes; tracker header counts are left alone.

## Architecture

```
                  ┌─────────────────────────┐
                  │  app/data/rubric.json   │  (DSL strings live here, unchanged)
                  └────────────┬────────────┘
                               │
                               ▼
PR 2 →        ┌────────────────────────────┐
              │   scripts/predicate.mjs    │  ← NEW canonical evaluator (pure ESM)
              └────────────┬───────────────┘
                           │  imported by ↓
          ┌────────────────┴──────────────────────────┐
          ▼                                           ▼
scripts/run-assessment.mjs               app/lib/assessment.ts
├ ranks + filters nextActions            └ re-exports evaluatePredicate
└ writes rankedNextActions[10]             (1-line passthrough; dashboard
                │                          still re-evals fresh for ✓ marks)
                ▼
      app/data/assessment.json
      (new top-level field; consumed by SKILL.md)
                │
                ▼
PR 1 → SKILL.md grammar block — DELETED in PR 2 once the field exists
```

Both PRs preserve the existing public surface: `evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean` keeps its signature; `assessment.json`'s existing fields are unchanged; only one new top-level field is added.

## DSL grammar (seven operator classes)

The `satisfiedWhen` field in each rubric next-action is a string evaluated against `signalsSummary`:

| Form | Semantics |
|------|-----------|
| `path` | truthy — non-null, non-zero, non-empty string; `"0"` and `"false"` are also falsy |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals, or equals one of |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation (PR 1): `app/lib/assessment.ts:evaluatePredicate`. After PR 2 merges, the canonical source moves to `scripts/predicate.mjs`; the TS file becomes a one-line re-export.

**Worked example:** `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` → `14 >= 1` → `true` → filter the action out, do not surface as a TODO.

## PR 2 — Structural (extract + bake)

### Files

| Path | Change |
|------|--------|
| `scripts/predicate.mjs` | NEW — pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` from `app/lib/assessment.ts` lines 165–259. Exports `evaluatePredicate`. No external dependencies. |
| `scripts/__tests__/predicate.test.mjs` | NEW — operator-coverage suite + rubric integration test |
| `scripts/__tests__/rank-next-actions.test.mjs` | NEW — fixture-driven ranker tests including named regression |
| `app/lib/assessment.ts` | Replace local `evaluatePredicate` + helpers with `export { evaluatePredicate } from "../../scripts/predicate.mjs"` |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`; add `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)`; attach result to `assessment.json` under `rankedNextActions` |
| `app/data/rubric.json` | Update `$schema` comment to note canonical evaluator is `scripts/predicate.mjs` |
| `.claude/skills/self-assessment/SKILL.md` | Replace "first filter … then rank" with "Read `assessment.json.rankedNextActions[0..2]`"; delete PR 1 grammar block |
| `CLAUDE.md` | File map gains `predicate.mjs` under `scripts/`; new hard rule (see below) |

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

### Tie-breaking rule

Sort key, in priority order:

1. `rank` descending
2. axis: `platform` → `execution` → `either` (platform-axis fixes are usually higher-leverage configuration changes)
3. `weight` descending
4. `dimId` ascending (locale-aware)
5. `actionId` ascending (locale-aware)

This guarantees "same machine state → same number" across runs — the project's core determinism promise.

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
      "action": "Promote repeating patterns to a Routine (cloud-hosted, laptop-closed) — Boris tip 61",
      "effort": "30min",
      "borisTip": 61,
      "satisfiedWhen": "scheduleCommandUses>=1"
    }
    // ... up to 10 entries, sorted by rank
  ]
}
```

`limit` is 10 (constant, not configurable). This gives the Slack post and console room without recomputing; the skill only reads `[0..2]`.

## Error handling

| Case | Behavior | Rationale |
|------|----------|-----------|
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Conservative: surface, don't hide |
| Signal field missing | Treated as `0` / `false` → action kept | Same: conservative |
| `na.action` text missing | Skip the action, no warning | Malformed rubric; not a runtime problem |
| Rubric dim has no `nextActions` | Skip that dim, continue | Normal case |
| `scoreMap` missing the dim | Skip that dim, continue | Defensive; shouldn't happen |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior exactly |

## Testing

### `scripts/__tests__/predicate.test.mjs`

One test per operator class, plus edge cases:

| Operator | Test cases |
|----------|-----------|
| `>=` `<=` `>` `<` | true above/below threshold, false at boundary for strict comparators, missing signal treated as 0 |
| `=` single | string-equality, numeric-equality |
| `=v\|w\|x` alternation | matches first, last, none; whitespace around `\|` |
| `!=` | true/false/missing |
| `~regex` | array element match, no match, non-array LHS → false, unparseable regex → false |
| `!path` | falsy/truthy negation, missing field → true (because path is falsy) |
| `A & B` | both true, one false, three atoms, whitespace tolerance |
| bare `path` | non-null number → true, `0` → false, `""` → false, missing → false |
| nested path | `a.b.c` correctly read, missing intermediate → falsy |
| empty / whitespace expr | returns `false` |

**Rubric integration test:** iterate every `satisfiedWhen` value in `app/data/rubric.json` and assert each parses without throwing. Proves production rubric is fully supported by the extracted evaluator.

### `scripts/__tests__/rank-next-actions.test.mjs`

Fixture: a small rubric with 3 dimensions, 5 actions (mix of predicated, unpredicated, axis-tagged), plus a synthetic `scoreMap` and `signalsSummary`.

| Test | Asserts |
|------|---------|
| Happy path: returns ranked top-N | First entry has highest `weight × deficit`; length ≤ limit |
| **Named regression:** `loopCommandUses=14` excludes `loopCommandUses>=1` action | The satisfied action is NOT in the output, even though its rank would otherwise be highest |
| Tie-breaking is deterministic | Two actions with equal rank order by axis → weight → dimId → actionId |
| `limit` slices correctly | `limit=3` returns at most 3; `limit=0` returns empty |
| Malformed action skipped | Action missing `action` text is dropped silently |
| Unpredicated action stays | Action with no `satisfiedWhen` is included regardless of signals |

### TS ↔ MJS equivalence (`app/lib/__tests__/predicate-passthrough.test.ts`)

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

A future contributor who copies the implementation instead of re-exporting it fails CI immediately.

## Hard rule added to CLAUDE.md (PR 2)

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Open risks

| Risk | Mitigation |
|------|-----------|
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified during exploration: ESM imports from TS work natively in Next.js 16 / Node 22+. If a build error surfaces, fallback to a `.mts` shim. |
| Re-rank changes existing snapshot tests on `assessment.json` | Update snapshots in the same PR; document expected diff |
| Dashboard render path inadvertently broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths |
| `rankedNextActions` field grows `assessment.json` size | Top-10 cap keeps growth bounded (~3 KB worst case); gitignored anyway |

## Ship sequencing

| # | PR | Estimate |
|---|----|----|
| 1 | T1 — SKILL.md DSL grammar (additive only; `.claude/skills/self-assessment/SKILL.md`) | ~10 min |
| 2 | S1 — Extract evaluator + bake `rankedNextActions` + delete T1 grammar block | ~45–60 min |

PR 2 explicitly removes the SKILL.md grammar block PR 1 added, so the skill's surface settles to a tighter, lower-maintenance form after both land.

## Done when

- PR 1 merges and `/self-assessment` invocations document the DSL grammar inline.
- PR 2 merges and `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim, with the SKILL.md grammar block gone.
- The specific triggering bug (`/loop 30m /babysit` in top 3 despite `loopCommandUses=14`) does not recur — proven by the named regression test in `rank-next-actions.test.mjs`.
