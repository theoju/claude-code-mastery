---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate evaluator and ranked next-actions — design

**Date:** 2026-05-31  
**Status:** Tactical fix (PR 1) merged; structural extraction (PR 2) pending.

On 2026-05-31, the `/self-assessment` skill surfaced `Start with one loop:
/loop 30m /babysit` as a top-3 priority despite `signalsSummary.loopCommandUses
= 14` satisfying its own `satisfiedWhen` predicate (`loopCommandUses>=1`). The
cause was a DSL mismatch: the model running the skill hand-wrote a filter that
expected `satisfiedWhen` to be an object `{field, op, value}`, while the rubric
stores it as a plain string (`"loopCommandUses>=1"`). The canonical evaluator
returned `null` for every string predicate, bypassing the filter entirely —
every action, satisfied or not, appeared as a candidate.

This page records the design that fixes it in two PRs.

## Root cause

The filtering instruction in `SKILL.md` said "first filter out satisfied
actions, then rank by weight × deficit" but gave no description of the DSL
format. A model reading only that instruction had no contract to lean on and
improvised an object-shaped parser that silently failed on all real rubric
entries. The canonical evaluator lived only inside the Next.js app
(`app/lib/assessment.ts`), unreachable from the skill's Node context.

## Fix strategy

Two PRs, applied in order:

| PR | Scope | What it does |
| --- | --- | --- |
| **PR 1 — Tactical** | `SKILL.md` (docs only) | Documents the DSL grammar inline so a model invoking the skill can evaluate predicates correctly without re-implementing the evaluator. Stopgap only. |
| **PR 2 — Structural** | `scripts/predicate.mjs` + `run-assessment.mjs` + `assessment.json` | Extracts the evaluator to a Node-shareable module, pre-computes ranked next-actions at score time, and writes `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the PR 1 grammar block is deleted. |

PR 2 makes the class of bug impossible: the skill never filters predicates at
all — it reads a pre-ranked, pre-filtered list produced by the scorer.

## `satisfiedWhen` DSL grammar

The rubric stores predicates as strings evaluated against `signalsSummary`.
Every operator class:

| Form | Meaning |
| --- | --- |
| `path` | Truthy: non-null, non-zero, non-empty string. Strings `"0"` and `"false"` are also falsy. |
| `!path` | Falsy negation of the above. |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison. Missing field is treated as `0`. |
| `path=v` or `path=v\|w\|x` | Equals, or equals one of a pipe-separated list. |
| `path!=v` | Not equals. |
| `path~regex` | Array-of-strings: at least one element matches the regex (case-insensitive). Non-array LHS → `false`. Unparseable regex → `false`. |
| `A & B` | AND of two or more atoms (whitespace around `&` is ignored). |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate` (to be
re-homed to `scripts/predicate.mjs` in PR 2 and re-exported from the TS
file as a 1-line passthrough).

**Example.** Predicate `loopCommandUses>=1` with
`signalsSummary.loopCommandUses = 14` evaluates to **true** — the action is
already satisfied and must not appear in the output.

## PR 2 architecture

```
                    ┌─────────────────────────┐
                    │  app/data/rubric.json   │  (DSL strings live here, unchanged)
                    └────────────┬────────────┘
                                 │
                                 ▼
          ┌────────────────────────────────────┐
          │   scripts/predicate.mjs            │  ← NEW canonical evaluator (pure ESM)
          └──────────┬─────────────────────────┘
                     │  imported by ↓
        ┌────────────┴──────────────────────────┐
        ▼                                       ▼
scripts/run-assessment.mjs            app/lib/assessment.ts
├ ranks + filters nextActions         └ re-exports evaluatePredicate
└ writes rankedNextActions[10]          (1-line passthrough; dashboard
                │                       still re-evals fresh for ✓ marks)
                ▼
      app/data/assessment.json
      (new top-level field; consumed by SKILL.md)
```

### `rankNextActions` algorithm

```javascript
function rankNextActions(rubric, scoreMap, signalsSummary, limit = 10) {
  const ranked = [];
  for (const dim of rubric.dimensions) {
    const scored = scoreMap.get(dim.id);
    if (!scored) continue;
    const weight   = dim.weight ?? 1;
    const pDeficit = Math.max(0, 100 - scored.score);
    const xDeficit = scored.executionScore == null
      ? 0
      : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions ?? []) {
      if (!na.action) continue;                               // malformed
      if (na.satisfiedWhen && evaluatePredicate(na.satisfiedWhen, signalsSummary))
        continue;                                             // already satisfied
      const axis   = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
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

Tie-breaking order: rank desc → axis (`platform` → `execution` → `either`) →
weight desc → dimId asc → actionId asc. Fully deterministic: same machine state
→ same list.

### Output schema

`assessment.json` gains one new top-level field. Existing fields are untouched.

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
    // ... up to 10 entries total
  ]
}
```

The limit is **10** (constant). The skill reads `[0..2]`; Slack / console have
headroom without recomputing. The field is gitignored (it lives inside
`app/data/assessment.json`).

## Error handling

| Case | Behavior |
| --- | --- |
| Parse error / unknown operator | `evaluatePredicate` returns `false` → action is kept (conservative) |
| Signal field missing | Treated as `0` / `false` → action is kept |
| `na.action` text missing | Action skipped silently |
| Dim has no `nextActions` | Dim skipped, loop continues |
| `scoreMap` missing the dim | Dim skipped, loop continues |
| Regex parse failure on `~` | Atom returns `false` |

## Test coverage

**`scripts/__tests__/predicate.test.mjs`** — one test per operator class, plus
edge cases for missing fields, nested paths, empty expressions, and whitespace
tolerance. A rubric integration test iterates every `satisfiedWhen` value in
`app/data/rubric.json` and asserts each parses without throwing.

**`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven tests
including a named regression for the specific `loopCommandUses=14 vs >=1` bug:
the satisfied action must not appear in the output regardless of its raw rank.

**`app/lib/__tests__/predicate-passthrough.test.ts`** — asserts reference
equality between the TS re-export and the MJS source. A copy-instead-of-reexport
fails CI.

## Hard rule (lands in PR 2)

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation. Test
> `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
> reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit
> `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS
> file.

## Done when

- PR 1 merges → `/self-assessment` invocations include the DSL grammar inline in the skill.
- PR 2 merges → `/self-assessment` reads `assessment.json.rankedNextActions[0..2]` verbatim; the PR 1 grammar block is deleted.
- The named regression test confirms `loopCommandUses=14` excludes the `loopCommandUses>=1` action from the output.

Full design spec: [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)  
Implementation plan: [`docs/superpowers/plans/2026-05-31-predicate-ranker.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-05-31-predicate-ranker.md)
