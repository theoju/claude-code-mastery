---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: predicate evaluator extraction + ranked next-actions

**Date:** 2026-05-31  
**Status:** Approved — structural fix landed in PR 2 (follows PR 104)

## The bug

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority action despite `signalsSummary.loopCommandUses=14`. The action's `satisfiedWhen` predicate is `loopCommandUses>=1` — fourteen uses clearly satisfies it, so the action should have been filtered out, not surfaced.

Root cause: the skill instructs the model to "first filter, then rank" but the canonical DSL evaluator lived at `app/lib/assessment.ts:evaluatePredicate`, which is TypeScript-only and Next.js-coupled by its location. No Node-side caller existed. The model running the skill hand-wrote a filter that expected `satisfiedWhen` to be an object `{field, op, value}` — the predicate strings in `rubric.json` are the string DSL format (e.g. `"loopCommandUses>=1"`), not objects. The hand-written filter returned `null` for every predicate, no filtering occurred, and a satisfied action ranked first.

## Decision

Two-PR fix:

**PR 1 (tactical, merged):** Add a DSL grammar block to `.claude/skills/self-assessment/SKILL.md` so a model reading the skill knows the seven operator classes and can evaluate correctly. Stopgap until PR 2 lands; explicitly marked temporary.

**PR 2 (structural):** Extract `evaluatePredicate` to `scripts/predicate.mjs` (pure ESM, no external dependencies), pre-compute the filtered and ranked top-N list once in `run-assessment.mjs`, and write it to `assessment.json` as `rankedNextActions`. The skill becomes a trivial reader; the PR 1 grammar block is deleted as obsolete.

## Why not just document the DSL?

Documentation fixes the immediate instance — a model that reads the block will evaluate correctly. But the underlying risk remains: any future implementation of the filter re-opens the same failure mode whenever the DSL grammar or the block diverge. The structural fix eliminates the failure class entirely. The skill changes from "filter and rank" to "read index zero through two from a pre-computed list."

## Architecture after PR 2

```
app/data/rubric.json
        │
        ▼
scripts/predicate.mjs          ← canonical evaluator (pure ESM)
        │
        ├─── scripts/run-assessment.mjs
        │         ranks + filters nextActions
        │         writes rankedNextActions[10] to assessment.json
        │
        └─── app/lib/assessment.ts
                  1-line re-export only
                  (dashboard still re-evals fresh for per-action ✓ marks)
```

`app/lib/assessment.ts` becomes a passthrough: `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts reference equality between the two exports — a copy-instead-of-re-export fails CI immediately.

## DSL grammar (the seven operator classes)

All `satisfiedWhen` values are strings evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Missing signal fields are treated as `0` / `false` (conservative — surface the action, don't hide it). Parse errors return `false` for the same reason.

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
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight, deficit,
                    rank: weight * deficit, action: na.action, effort: na.effort,
                    borisTip: na.borisTip, satisfiedWhen: na.satisfiedWhen ?? null });
    }
  }
  ranked.sort((a, b) =>
    b.rank - a.rank ||
    axisOrder(a.axis) - axisOrder(b.axis) ||
    b.weight - a.weight ||
    a.dimId.localeCompare(b.dimId) ||
    a.actionId.localeCompare(b.actionId)
  );
  return ranked.slice(0, limit);
}
```

Tie-breaking order: `rank` descending → axis (`platform` → `execution` → `either`) → `weight` descending → `dimId` ascending → `actionId` ascending. Deterministic across runs on identical machine state, matching the project's "same machine state → same number" invariant.

The top-10 cap keeps the stored field bounded (~3 KB worst case). The skill reads only `[0..2]`; Slack and console have room for the full ten without recomputing.

## `assessment.json` schema addition

One new top-level field; all existing fields are unchanged:

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

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue to evaluate predicates fresh at request time for per-action ✓/✗ marks. `rankedNextActions` serves the skill, Slack post, and console printer only.
- **No DSL grammar changes.** The operator classes stay exactly as today; this is a pure extraction and caller migration.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions today; that is a separate future PR.
- **No probe-tracker count changes.** No new probes are added; the tracker header is left alone.

## Hard rule added in PR 2

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Done when

- PR 1 merged: `/self-assessment` invocations show the DSL grammar inline so a model can filter correctly as a stopgap.
- PR 2 merged: `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim, SKILL.md grammar block deleted, `evaluatePredicate` passthrough test green.
- Named regression test in `scripts/__tests__/rank-next-actions.test.mjs` confirms `loopCommandUses=14` with predicate `loopCommandUses>=1` produces no output entry for that action — the specific 2026-05-31 bug does not recur.
