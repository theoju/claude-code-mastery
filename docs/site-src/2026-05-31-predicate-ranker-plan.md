---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions — implementation plan

**Date:** 2026-05-31  
**Design spec:** [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)  
**Triggered by:** `/self-assessment` wrongly surfaced `/loop 30m /babysit` as a top-3 priority when `signalsSummary.loopCommandUses=14` already satisfied the `loopCommandUses>=1` predicate. The skill's model hand-wrote a filter that expected an object shape; the actual DSL is a string. Every string predicate was silently skipped.

## Two-PR fix

The fix ships in two sequential PRs so the bug stops immediately (PR 1) before the structural remedy lands (PR 2).

| # | PR | Shape | Estimate |
|---|----|----|---|
| 1 | T1 — SKILL.md DSL grammar | additive-only doc change | ~10 min |
| 2 | S1 — Extract evaluator + bake `rankedNextActions` | code + tests + SKILL.md cleanup | ~45–60 min |

PR 2 explicitly removes what PR 1 added. Once PR 2 is merged, the SKILL.md surface is strictly smaller than before either PR.

---

## PR 1 — Tactical: document the DSL grammar in SKILL.md

**Goal:** stop the skill from hand-implementing a wrong filter while PR 2 is in flight.

**File touched:** `.claude/skills/self-assessment/SKILL.md` — one additive edit beneath the existing `Top 3 priority actions` bullet.

Insert the following sub-block:

```
**`satisfiedWhen` DSL grammar** (string predicates evaluated against `signalsSummary`):

- `path` — truthy (non-null, non-zero, non-empty-string; "0" and "false" are also falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

Canonical implementation: app/lib/assessment.ts:evaluatePredicate.
Example: loopCommandUses>=1 with signalsSummary.loopCommandUses=14 → true → filter out, do not surface as a TODO.
```

**Tests:** none — this is pure documentation.  
**Done when:** PR 1 merges and subsequent `/self-assessment` runs report the grammar inline.

---

## PR 2 — Structural: extract the evaluator, pre-compute the ranked list

**Goal:** eliminate the "model re-implements the DSL" bug class permanently. The skill becomes a trivial reader of a pre-computed field; no model ever needs to evaluate predicates itself.

### New files

| Path | Purpose |
|---|---|
| `scripts/predicate.mjs` | Pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` from `app/lib/assessment.ts` (lines 165–259). Exports `evaluatePredicate`. No external dependencies. |
| `scripts/rank-next-actions.mjs` | `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)` — filters satisfied actions, ranks by `weight × deficit`, returns top-N with deterministic tie-breaking. |
| `scripts/__tests__/predicate.test.mjs` | Operator-coverage suite + rubric integration test (every `satisfiedWhen` value in `rubric.json` parses without throwing). |
| `scripts/__tests__/rank-next-actions.test.mjs` | Fixture-driven tests including the named regression: `loopCommandUses=14` must exclude the `loopCommandUses>=1` action. |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Asserts `evaluatePredicate` from TS and from MJS are reference-equal — a copy instead of a re-export fails CI. |

### Modified files

| Path | Change |
|---|---|
| `app/lib/assessment.ts` | Replace local `evaluatePredicate` + helpers (lines 165–259) with `export { evaluatePredicate } from "../../scripts/predicate.mjs"`. |
| `scripts/run-assessment.mjs` | Import `evaluatePredicate`; call `rankNextActions`; attach result to `assessment.json` as `rankedNextActions`. |
| `app/data/rubric.json` | Update `$schema` comment: canonical evaluator is now `scripts/predicate.mjs`. |
| `.claude/skills/self-assessment/SKILL.md` | Replace filter instructions + **delete PR 1 grammar block**. New text: "Read `assessment.json.rankedNextActions[0..2]` — already filtered and sorted by `weight × deficit`." |
| `CLAUDE.md` | File map gains `predicate.mjs` under `scripts/`. Hard rule added: DSL evaluator has one source. |

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
      scored.executionScore == null ? 0 : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions ?? []) {
      if (!na.action) continue;
      if (na.satisfiedWhen && evaluatePredicate(na.satisfiedWhen, signalsSummary)) continue;
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

Tie-breaking order: rank desc → axis (`platform` → `execution` → `either`) → weight desc → `dimId` asc → `actionId` asc. Deterministic on identical machine state.

### Output schema (`assessment.json` new field)

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
      "action": "Promote repeating patterns to a Routine — Boris tip 61",
      "effort": "30min",
      "borisTip": 61,
      "satisfiedWhen": "scheduleCommandUses>=1"
    }
    // ...up to 10 entries
  ]
}
```

`limit` is 10 — constant, not configurable. Gives Slack/console room; the skill consumes only `[0..2]`.

### Error handling

| Case | Behavior | Rationale |
|---|---|---|
| Predicate parse error / unknown operator | `evaluatePredicate` returns `false` → action kept | Conservative: surface, don't hide |
| Signal field missing | Treated as `0` / `false` → action kept | Same |
| `na.action` text missing | Skip, no warning | Malformed rubric |
| Rubric dim has no `nextActions` | Skip that dim | Normal |
| `scoreMap` missing the dim | Skip that dim | Defensive |
| Regex parse failure on `~` | Atom returns `false` | Matches TS behavior |

### Test plan

**`predicate.test.mjs`** — one test per operator class, plus: missing signal treated as 0/false, nested path reads (`a.b.c`), empty expression returns `false`, and the rubric integration test (every `satisfiedWhen` in production `rubric.json` parses cleanly).

**`rank-next-actions.test.mjs`** — named regression test: fixture with `loopCommandUses=14` against `loopCommandUses>=1` action must exclude that action even if its rank would otherwise be highest. Also covers: happy-path ordering, tie-breaking determinism, `limit` slicing, malformed-action skip, unpredicated-action inclusion.

**`run-assessment.test.mjs`** (extend existing) — asserts `rankedNextActions` is present and is an array, length ≤ 10, each entry carries all required keys, and a snapshot test pins a fixed input to a fixed output.

**`predicate-passthrough.test.ts`** — `expect(fromTs).toBe(fromMjs)` (reference equality).

### Hard rule added to CLAUDE.md

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

**Done when:** PR 2 merges, `/self-assessment` reads `rankedNextActions[0..2]` verbatim, the grammar block from PR 1 is gone, and the named regression test in `rank-next-actions.test.mjs` passes in CI.

---

## Open risks

| Risk | Mitigation |
|---|---|
| Next.js 16 cross-module-system import surprises (TS importing `.mjs`) | Verified during exploration: ESM imports from TS work natively in Next.js 16 / Node 22+. Fallback: `.mts` shim. |
| Re-rank changes existing `assessment.json` snapshots | Update snapshots in the same PR; document expected diff. |
| Dashboard render path broken by `evaluatePredicate` move | Equivalence test pins reference identity; existing dashboard tests cover render paths. |
| `rankedNextActions` grows `assessment.json` size | Top-10 cap keeps growth ~3 KB worst case; file is gitignored anyway. |
