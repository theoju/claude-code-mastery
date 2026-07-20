---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# Predicate evaluator and ranked next-actions

PR #106 moves the `satisfiedWhen` filter/rank logic out of prose instructions
and into tested code. Two pieces landed together: a single canonical DSL
evaluator (`scripts/predicate.mjs`) and a pre-computed ranking pipeline
(`scripts/rank-next-actions.mjs`) that runs once per `npm run assess` and
writes its output straight into `assessment.json`.

## The bug this closes

Every rubric next-action can carry a `satisfiedWhen` string — a small DSL
(`loopCommandUses>=1`, `hasFormatterHook`, `outputStyle=Explanatory|Learning`,
etc. — see the grammar comment atop `scripts/predicate.mjs`). Before this
change, no pre-computed ranked list existed: the `/self-assessment` skill
re-implemented the filter+rank logic itself from a prose description of the
DSL grammar. A model reading the rubric's string-shaped predicates would
sometimes misparse
`"loopCommandUses>=1"` as a structured condition object, the ad-hoc filter
would silently no-op, and an already-satisfied action would surface as a
top-3 priority. The concrete case: `babysit-loop` (Boris tip 48) showing up
as a recommended next step for a user whose `loopCommandUses` was already 14.

PR #104 patched this tactically — it tightened the grammar block inside
`.claude/skills/self-assessment/SKILL.md` so the model would parse the DSL
correctly. PR #106 is the structural fix: stop asking a model to
re-implement a filter+rank algorithm from a prose spec at all.

## `scripts/predicate.mjs` — the one evaluator

`evaluatePredicate(expr, signals)` is now the single implementation of the
DSL. It supports:

- bare `path` → truthy check (`isTruthy` treats `null`/`undefined`/`0`/
  `""`/`"0"`/`"false"` as false, everything else — including non-empty
  objects and arrays — as true)
- `!path` → negated truthy
- `path>=N`, `path<=N`, `path>N`, `path<N` → numeric comparison (both sides
  coerced with `Number()`; a `NaN` on either side returns `false` rather than
  throwing)
- `path=v` / `path=v|w|x` and `path!=v` → string-equals against one or more
  `|`-separated literals
- `path~regex` → case-insensitive regex test against each element of an
  array-valued `path` (returns `false` outright for a non-array LHS or an
  unparseable regex — it never throws)
- `A & B` → AND of two or more atoms, split on `&` before per-atom
  dispatch

`readPath` walks dotted paths (`a.b.c`) against the flat `signalsSummary`
object with an `in`-guarded reduce, so a missing intermediate key resolves to
`undefined` instead of throwing. The whole module is pure ESM with zero
imports — it's the dependency both the Node-side scorer and the Next.js
dashboard now share.

## `app/lib/assessment.ts` is now a re-export, not a copy

`app/lib/assessment.ts` used to carry its own TypeScript copy of this
evaluator. It now does one thing:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` enforces this stays true —
it imports `evaluatePredicate` from both `@/app/lib/assessment` and
`@/scripts/predicate.mjs` and asserts `toBe` (reference equality, not just
behavioral equivalence). If a future change re-introduces a second
implementation, that test fails before any predicate-level test could catch
the drift. CLAUDE.md now documents this as a standing rule: `predicate.mjs`
is canonical, and the DSL grammar itself is only ever edited there (plus the
`$schema` comment in `app/data/rubric.json`) — never in the TS file.

## `scripts/rank-next-actions.mjs` — filter and rank, once, in one place

`rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)` replaces the
model-side filter entirely. For every dimension in the rubric with a
matching entry in `scoreMap`:

- computes a platform deficit (`100 - score`, floored at 0) and an execution
  deficit (`100 - executionScore`, or `0` when `executionScore` is `null`)
- for each `nextAction`, skips it outright if it has no `action` text
  (malformed rows are dropped silently rather than crashing the run)
- skips it if `satisfiedWhen` is set **and** `evaluatePredicate` returns true
  against `signalsSummary` — this is the fix: the same evaluator that scores
  the rubric now also gates what counts as "still outstanding"
- resolves `axis` to `na.axis`, or `"platform"` when a `satisfiedWhen` exists
  with no explicit axis, or `"either"` when there's no predicate at all
  (unpredicated coaching actions, e.g. "Try the iOS app")
- ranks by `weight × deficit` (using the execution deficit only when
  `axis === "execution"`, platform deficit otherwise)

The sort is fully deterministic: `rank` descending, then axis order
(`platform` < `execution` < everything else, including unrecognized axis
values), then `weight` descending, then `dimId`, then `actionId` — both
lexical. `scripts/__tests__/rank-next-actions.test.mjs` pins this exact tie
order and includes the named regression: with `loopCommandUses: 14`,
`babysit-loop` is excluded from the result while `promote-routine` (a
different, unsatisfied action in the same dimension) still appears.

## Where the output lands

`scripts/run-assessment.mjs` calls `rankNextActions(rubric, scoreMap,
signalsSummary, 10)` on every `npm run assess` and writes the result under
`assessment.json.rankedNextActions`. Each entry carries `dimId`, `actionId`,
`axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`, and
`satisfiedWhen` (echoed back, or `null` for unpredicated actions) — the
shape is typed as `RankedNextAction` in `app/lib/assessment.ts`.
`scripts/__tests__/run-assessment-ranking.test.mjs` exercises this against a
real `scoreAll()` + `buildSignalsSummary()` pipeline (not just a hand-built
fixture) and asserts the ranking is stable across two identical runs.

`.claude/skills/self-assessment/SKILL.md` was simplified to match: it no
longer describes a filter/rank algorithm at all. It just says to read
`assessment.json.rankedNextActions[0..2]` — "already filtered (satisfied
actions dropped) and ranked by `weight × deficit`" — and lists the field
names on each entry. There is no DSL grammar left in the skill file for a
model to misread, because the model never evaluates the predicate anymore;
it only reads a pre-computed array.

## Why this is the durable fix

The tactical PR #104 fix depended on every future model invocation reading
and correctly applying a grammar description under time/token pressure — the
exact failure mode that caused the bug in the first place. Centralizing the
evaluator and moving the filter+rank step into a tested `.mjs` module that
runs once per assessment removes the model from the loop for this
computation entirely. The only thing a model (or the skill) does now is
read an array that's already correct.
