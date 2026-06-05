---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Predicate evaluator and next-action ranker

PR #106 (2026-06-01) extracted a canonical `satisfiedWhen` DSL evaluator into
`scripts/predicate.mjs` and wired a pre-computed ranked next-action list into
every `npm run assess` run. Together they close out a bug class where a model
hand-re-implementing the filter logic would surface already-satisfied actions as
priorities.

---

## The predicate DSL

Every rubric next-action may carry a `satisfiedWhen` field — a string expression
evaluated against the flat `signalsSummary` object to decide whether the action
is already done. Examples from `app/data/rubric.json`:

```
loopCommandUses>=1
hasShipCommand
effortLevel=max
!skipDangerousModePermissionPrompt & permissionsDenyCount>=1
```

The grammar (defined in `scripts/predicate.mjs`):

| Form | Meaning |
|------|---------|
| `path` | truthy: non-null, non-zero, non-empty; `"0"` and `"false"` count as falsy |
| `!path` | falsy check |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` / `path=v\|w\|x` | string equality (or one-of) |
| `path!=v` | string inequality |
| `path~regex` | any element of a string array matches `regex` (case-insensitive) |
| `A & B` | AND of two or more atoms |

### Single authoritative source

`scripts/predicate.mjs` is the canonical implementation. The TypeScript copy at
`app/lib/assessment.ts::evaluatePredicate` is a **passthrough re-export** — one
line, no logic:

```ts
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts the two
exports are reference-equal. Any change to the grammar goes in
`scripts/predicate.mjs` only. A duplicate implementation in the TS file fails
CI immediately.

> **Why it matters:** on 2026-05-31 a model hand-implemented the filter during a
> `/self-assessment` run, treating the DSL string `"loopCommandUses>=1"` as a
> structured object. The evaluator returned null (no-op), no actions were
> filtered, and `babysit-loop` appeared as a top-3 priority despite
> `loopCommandUses=14`. Having a single pre-evaluated list removes the
> opportunity for the re-implementation entirely.

---

## The ranker: `rankNextActions`

`scripts/rank-next-actions.mjs` exports one function:

```js
rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)
```

| Argument | Type | Description |
|----------|------|-------------|
| `rubric` | object | Parsed `app/data/rubric.json` |
| `scoreMap` | `Map<dimId, { score, executionScore }>` | Output of `scripts/score.mjs` |
| `signalsSummary` | object | Flat signals object passed to the predicate evaluator |
| `limit` | number | Maximum entries returned (default `10`) |

### What it does

1. Iterates every `nextAction` across all rubric dimensions.
2. Skips any action whose `satisfiedWhen` evaluates to `true` against
   `signalsSummary` — the action is already done.
3. Computes `rank = weight × deficit`, where `deficit` is `max(0, 100 - score)`
   on the action's axis (`platform` → Platform Setup score; `execution` →
   Execution score; `either` → Platform Setup score).
4. Sorts by a deterministic 5-tier tie-break:

| Priority | Criterion |
|----------|-----------|
| 1st | `rank` descending (weight × deficit) |
| 2nd | axis order: `platform` before `execution` before `either` |
| 3rd | `weight` descending |
| 4th | `dimId` ascending (alphabetical) |
| 5th | `actionId` ascending (alphabetical) |

Returns at most `limit` entries.

---

## `assessment.json.rankedNextActions`

`scripts/run-assessment.mjs` calls `rankNextActions` on every `npm run assess`
run and writes the result as `rankedNextActions` in `app/data/assessment.json`.
Shape of each entry:

```jsonc
{
  "dimId": "automation",
  "actionId": "ship-command",
  "axis": "platform",
  "weight": 3,
  "deficit": 100,
  "rank": 300,
  "action": "Author a personal /ship slash command …",
  "effort": "medium",
  "borisTip": 5,
  "satisfiedWhen": "hasShipCommand"   // null when no predicate
}
```

### How skills must consume it

Read `assessment.json.rankedNextActions` directly. **Never re-implement the
filter or ranking logic** in a skill or slash command — the pre-computed array
is the contract. CLAUDE.md pins this as a hard rule:

> Ranked next-actions live in `assessment.json.rankedNextActions`. The
> self-assessment skill must NEVER hand-implement the satisfiedWhen filter or
> the weight×deficit ranking. Read the pre-computed top-10 from the written
> file.

The `/self-assessment` SKILL.md was simplified to a single bullet reflecting
this: it reads `rankedNextActions` from the file rather than sorting or
filtering rubric data in-session.

---

## The originating bug class

The architectural problem was **DSL re-implementation at consumption time**: a
model reading `rubric.json` saw `satisfiedWhen: "loopCommandUses>=1"` and tried
to evaluate it inline. The string grammar was opaque enough that the inline
implementation silently misfired (returned `null`), no actions were pruned, and
a satisfied action appeared as a high-priority recommendation.

The close-out has three layers:

| Layer | Mechanism | Enforced by |
|-------|-----------|-------------|
| Single evaluator | `scripts/predicate.mjs` only — no inline copies | CI reference-equality test |
| Pre-computed output | `rankedNextActions` written at assess time | `run-assessment.mjs` always calls `rankNextActions` |
| Skill contract | SKILL.md reads the array, never re-ranks | CLAUDE.md hard rule + regression test |

The regression test (included in PR #106) pins the originating bug: it asserts
`babysit-loop` does not appear in the ranked output when `loopCommandUses=14`.

---

## Related files

| Path | Role |
|------|------|
| `scripts/predicate.mjs` | Canonical DSL evaluator |
| `scripts/rank-next-actions.mjs` | `rankNextActions` function |
| `scripts/run-assessment.mjs` | Calls `rankNextActions`; writes `assessment.json` |
| `app/lib/assessment.ts` | Passthrough re-export (one line) |
| `app/lib/__tests__/predicate-passthrough.test.ts` | CI reference-equality guard |
| `app/data/rubric.json` | `satisfiedWhen` expressions per next-action |
| `app/data/assessment.json` | Written output — `rankedNextActions[10]` |
| `.claude/skills/self-assessment/SKILL.md` | Consumer: reads pre-computed array |
