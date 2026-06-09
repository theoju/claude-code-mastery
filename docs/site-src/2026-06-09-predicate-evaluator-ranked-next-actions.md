---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Decision: Canonical DSL Evaluator and Pre-computed `rankedNextActions`

**Date:** 2026-06-09  
**PR:** [#106](https://github.com/theoju/claude-code-self-assessment/pull/106)  
**Status:** Accepted

## Context

On 2026-05-31 a production bug surfaced in the `/self-assessment` skill. A model tasked with reporting top priority actions hand-wrote its own `satisfiedWhen` evaluator, treating the DSL string (e.g. `"loopCommandUses>=1"`) as if it were a structured object. The evaluator silently returned `null` for every probe. No actions were filtered as satisfied, and the babysit-loop next-action appeared as a top-3 priority despite `loopCommandUses=14` — an already-satisfied action dressed up as urgent work.

The root cause was structural: the `satisfiedWhen` predicate logic lived in `app/lib/assessment.ts` as a TypeScript implementation, and any consuming code (a skill, a future script, an LLM reasoning over the schema) could independently re-derive it. The string DSL had no single authoritative home. Two implementations, or zero, were equally possible.

## Decision

### 1. One evaluator, `scripts/predicate.mjs`

The canonical `satisfiedWhen` DSL evaluator lives in `scripts/predicate.mjs`. It is a byte-faithful port of the logic that previously lived in `app/lib/assessment.ts`. The TypeScript file is now a two-line passthrough re-export:

```ts
// app/lib/assessment.ts (collapsed)
export { evaluatePredicate } from '../../scripts/predicate.mjs';
```

A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts the two are reference-equal. A copy of the implementation in the TS file fails CI. When the DSL grammar needs to change, you edit `scripts/predicate.mjs` — not the TypeScript file, not a skill, not inline logic in a consumer.

The DSL grammar itself is unchanged: `"field>=N"`, `"field==true"`, `"field1>=1 && field2>=1"`, etc. What changed is that it has exactly one implementation, and that implementation is the evaluator the scoring pipeline uses at runtime.

### 2. Pre-computed `rankedNextActions` in `assessment.json`

`scripts/rank-next-actions.mjs` filters and ranks next-actions at assessment time:

1. Evaluates every next-action's `satisfiedWhen` predicate against the current signals snapshot using `scripts/predicate.mjs`.
2. Drops already-satisfied actions.
3. Ranks the remainder by `weight × deficit` with a deterministic 5-tier tie-break (score tier → weight → dimension → action index → alphabetic).
4. Writes the top-10 as `rankedNextActions` into `app/data/assessment.json`.

`scripts/run-assessment.mjs` calls `rank-next-actions.mjs` on every `npm run assess`, so the array is fresh in every snapshot.

### 3. Consumers read the pre-computed list; they do not re-implement the filter

The `/self-assessment` SKILL.md was simplified to read directly from `assessment.json.rankedNextActions`. **No consuming code should re-implement the `satisfiedWhen` filter or the `weight × deficit` ranking.** If a satisfied action appears in a report, the bug is in the data layer — fix `rank-next-actions.mjs`, not the reporter.

## Named regression test

A regression test pins the originating production bug:

```
loopCommandUses=14 → babysit-loop must NOT appear in rankedNextActions
```

This test runs as part of `npx vitest run` and will fail if the evaluator ever again returns a falsy value for a satisfied loop probe.

## Hard rules (permanent)

These rules are committed to `CLAUDE.md` and apply to all future work:

- **`scripts/predicate.mjs` is canonical.** `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export. Never copy the implementation. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment.
- **Ranked next-actions live in `assessment.json.rankedNextActions`.** The self-assessment skill must NEVER hand-implement the `satisfiedWhen` filter or the `weight × deficit` ranking. Read the pre-computed top-10 from the written file. Surfacing a satisfied action as a TODO again is a regression — fix the data layer, not the report.

## Files changed

| File | Change |
| ---- | ------ |
| `scripts/predicate.mjs` | New — canonical DSL evaluator (ported from `app/lib/assessment.ts`) |
| `app/lib/assessment.ts` | Collapsed to 2-line passthrough re-export |
| `scripts/rank-next-actions.mjs` | New — filters + ranks next-actions at assessment time |
| `scripts/run-assessment.mjs` | Wires in `rank-next-actions.mjs`; writes `rankedNextActions[10]` to snapshot |
| `.claude/commands/self-assessment.md` | Simplified to read from pre-computed list |
| `app/lib/__tests__/predicate-passthrough.test.ts` | CI guard: asserts reference equality of the two exports |

## Consequences

- A model, script, or future capability that needs to evaluate a `satisfiedWhen` predicate imports `evaluatePredicate` from `scripts/predicate.mjs` (or the TS re-export). It does not parse the string itself.
- The `/self-assessment` skill's output is now as reliable as `assessment.json`: if the snapshot is current, the ranked list is correct. The skill's job is presentation, not scoring.
- Any new next-action added to `rubric.json` that includes a `satisfiedWhen` predicate is automatically filtered and ranked on the next `npm run assess` — no changes to consuming code required.
