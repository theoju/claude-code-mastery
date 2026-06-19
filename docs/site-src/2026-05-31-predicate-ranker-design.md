---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions — design decision

**Date:** 2026-05-31
**Ticket:** CCE-57
**Status:** Approved — PR 1 merged, PR 2 in progress

## The bug this fixes

`/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a
top-3 priority even when `signalsSummary.loopCommandUses=14`. The predicate
`loopCommandUses>=1` was satisfied — the action should have been filtered out.

Root cause: the SKILL.md instructed the model to "first filter, then rank"
but the canonical DSL evaluator (`app/lib/assessment.ts:evaluatePredicate`)
was TS-only and Next.js-coupled. No Node-side caller existed. The model running
the skill hand-wrote a filter that expected an object shape and skipped string
predicates entirely — exactly the kind of DSL re-implementation that produces
silent divergence.

## Fix strategy: two PRs

| PR | Label | Approach |
| -- | ----- | -------- |
| 1 | Tactical | Document the DSL grammar inside SKILL.md so a careful model can evaluate correctly. Stopgap. |
| 2 | Structural | Extract `evaluatePredicate` to `scripts/predicate.mjs`, pre-compute ranked next-actions in `run-assessment.mjs`, write to `assessment.json.rankedNextActions`. The skill becomes a trivial reader; the grammar block from PR 1 is deleted as obsolete. |

PR 2 explicitly removes what PR 1 added, so the SKILL.md surface settles to a
tighter, lower-maintenance form. Both PRs go through `/ship`'s full chain.

## PR 1 — Tactical (SKILL.md DSL grammar)

**Files touched:** `.claude/skills/self-assessment/SKILL.md` only, additive.

The insert beneath the "Top 3 priority actions" bullet documents the eight
operator classes:

| Operator | Meaning |
| -------- | ------- |
| `path` | truthy — non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14`
evaluates to **true** → filter the action out, do not surface as a TODO.

## PR 2 — Structural (extract + bake)

### Architecture

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
            ┌──────────────────┴───────────────────────┐
            ▼                                          ▼
  scripts/run-assessment.mjs                  app/lib/assessment.ts
  ├ ranks + filters nextActions               └ re-exports evaluatePredicate
  └ writes rankedNextActions[10]                (1-line passthrough; dashboard
                  │                              re-evals fresh for ✓ marks)
                  ▼
        app/data/assessment.json
        (new top-level field; consumed by SKILL.md)
```

Both PRs preserve the existing public surface: `evaluatePredicate(expr: string,
signals: Record<string, unknown>): boolean` keeps its signature; `assessment.json`'s
existing fields are unchanged.

### New and modified files

| Path | Change |
| ---- | ------ |
| `scripts/predicate.mjs` | **New.** Pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` from `app/lib/assessment.ts` lines 165–259. No external dependencies. |
| `scripts/__tests__/predicate.test.mjs` | **New.** Operator-coverage suite + rubric integration test. |
| `scripts/__tests__/rank-next-actions.test.mjs` | **New.** Fixture-driven tests including a named regression for the `loopCommandUses=14 vs >=1` bug. |
| `app/lib/assessment.ts` | Replace `evaluatePredicate` + helpers (lines 165–259) with `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`. Add `rankNextActions()`. Attach result to written assessment under `rankedNextActions`. |
| `app/data/rubric.json` | Update `$schema` comment: canonical evaluator is now `scripts/predicate.mjs`. |
| `.claude/skills/self-assessment/SKILL.md` | Replace "first filter … then rank" with "read `assessment.json.rankedNextActions[0..2]`". Delete the PR 1 grammar block. |
| `CLAUDE.md` | File map gains `predicate.mjs`. New hard rule on DSL evaluator uniqueness. |

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
      ranked.push({ dimId: dim.id, actionId: na.id, axis, weight, deficit,
                    rank, action: na.action, effort: na.effort,
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

**Tie-breaking sort key (in order):**

1. `rank` descending
2. axis: `platform` → `execution` → `either`
3. `weight` descending
4. `dimId` ascending (locale-aware)
5. `actionId` ascending (locale-aware)

Rationale: deterministic across runs on identical machine state, matching the
project's "same machine state → same number" promise.

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
    // ... up to 10 entries, sorted by rank
  ]
}
```

`limit` is **10** (constant, not configurable). Top-10 gives Slack post / console
room without recomputing; cheap to store; the skill only reads `[0..2]`.

### Error handling

| Case | Behavior | Rationale |
| ---- | -------- | --------- |
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Conservative: surface, don't hide |
| Signal field missing | Treated as `0` / `false` → action kept | Same |
| `na.action` text missing | Skip action silently | Malformed rubric; not a runtime concern |
| Rubric dim has no `nextActions` | Skip dim, continue | Normal case |
| `scoreMap` missing the dim | Skip dim, continue | Defensive |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior exactly |

### Test coverage

**`scripts/__tests__/predicate.test.mjs`** — one test per operator class plus edge cases:

| Operator | Cases covered |
| -------- | ------------- |
| `>=` `<=` `>` `<` | true above/below threshold; false at boundary for strict comparators; missing signal treated as 0 |
| `=` single | string-equality, numeric-equality |
| `=v\|w\|x` alternation | matches first, last, none; whitespace around `\|` |
| `!=` | true / false / missing |
| `~regex` | array element match; no match; non-array LHS → false; unparseable regex → false |
| `!path` | falsy/truthy negation; missing field → true |
| `A & B` | both true; one false; three atoms; whitespace tolerance |
| bare `path` | non-null number → true; `0` → false; `""` → false; missing → false |
| nested path | `a.b.c` read correctly; missing intermediate → falsy |
| empty / whitespace expr | returns `false` |

Rubric integration test: iterate every `satisfiedWhen` value in `app/data/rubric.json`
and assert each parses without throwing. Proves the production rubric is fully supported.

**`scripts/__tests__/rank-next-actions.test.mjs`:**

| Test | Asserts |
| ---- | ------- |
| Happy path | First entry has highest `weight × deficit`; length ≤ limit |
| **Named regression: `loopCommandUses=14`** | The satisfied action is NOT in output even though its rank would be highest |
| Tie-breaking is deterministic | Two equal-rank actions order by axis → weight → dimId → actionId |
| `limit` slices correctly | `limit=3` returns at most 3; `limit=0` returns empty |
| Malformed action skipped | Action missing `action` text is dropped silently |
| Unpredicated action stays | Action with no `satisfiedWhen` is included regardless of signals |

**`app/lib/__tests__/predicate-passthrough.test.ts`** (new):

```typescript
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

it("TS export is a literal passthrough of the MJS source", () => {
  expect(fromTs).toBe(fromMjs); // reference equality
});
```

Proves the TS re-export never silently duplicates the implementation. A contributor
who copies instead of re-exports fails CI.

## Hard rule (lands in PR 2)

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation. Test
> `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
> reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit
> `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## Non-goals

- **No dashboard refactor.** `/methodology/probes` and `/dimensions/[id]` continue
  to evaluate predicates fresh at request time for per-action ✓/✗ marks.
- **No Slack-post integration.** `scripts/slack.mjs` does not render next-actions
  today; adding that is a future PR.
- **No DSL grammar changes.** The eight operator classes stay exactly as today;
  this is a pure extraction + caller migration.
- **No probe-tracker count changes.** No probes are added; the tracker header
  is left alone.

## Open risks

| Risk | Mitigation |
| ---- | ---------- |
| Next.js 16 cross-module-system import surprises (TS `.ts` importing `.mjs`) | Verified during exploration: ESM imports from TS work natively in Next.js 16 / Node 22+. Fallback: a `.mts` shim. |
| Re-rank changes existing snapshot tests on `assessment.json` | Update snapshots in the same PR; document expected diff. |
| Dashboard render path broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths. |
| `rankedNextActions` grows `assessment.json` size | Top-10 cap keeps growth bounded (~3 KB worst case); gitignored anyway. |

## Done when

- PR 1 merged: `/self-assessment` invocations include the DSL grammar inline.
- PR 2 merged: `/self-assessment` reads `assessment.json.rankedNextActions[0..2]`
  verbatim; the grammar block is gone from SKILL.md.
- The specific regression (`/loop 30m /babysit` surfaced despite `loopCommandUses=14`)
  does not recur — proven by the named regression test in `rank-next-actions.test.mjs`.
