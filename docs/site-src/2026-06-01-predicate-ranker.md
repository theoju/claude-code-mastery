---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Canonical predicate evaluator and pre-computed ranked next-actions (PR #106)

## The problem

A recurring bug class caused consumers of the rubric to re-implement the
`satisfiedWhen` filter by hand. The rubric stores predicates as plain strings
like `"loopCommandUses>=1"`. When an AI agent read the field and treated it as
a structured object `{field, op, value}`, the evaluator silently returned
`null`, no actions were filtered, and already-satisfied actions surfaced as
top priorities.

The specific production case: `babysit-loop` carries `satisfiedWhen:
"loopCommandUses>=1"`. With `loopCommandUses=14` in the signals summary the
action is satisfied — but the hand-rolled filter missed it and kept surfacing
"Start with one loop" as a priority even after the user had run `/loop` 14
times. PR #104 patched the `SKILL.md` text; PR #106 closed the structural gap.

## The fix: one canonical evaluator, no duplication

`scripts/predicate.mjs` is the single source of truth for the `satisfiedWhen`
DSL. The full grammar it supports:

| Form | Semantics |
|------|-----------|
| `path` | truthy check (`null`, `0`, `""`, `"0"`, `"false"`, empty array/object → false) |
| `!path` | negation |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison; missing LHS short-circuits to `false` via NaN guard |
| `path=v` / `path=v\|w\|x` | string equality or any-of |
| `path!=v` | not-equals |
| `path~regex` | case-insensitive regex tested against each element of a string array; non-array LHS or unparseable regex returns `false`, never throws |
| `A & B & C` | AND of two or more atoms; short-circuits on first false |

`app/lib/assessment.ts` collapses to a 2-line re-export:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

A CI test asserts reference identity — `fromTs === fromMjs` — so any future
attempt to copy the implementation into `assessment.ts` fails the build
immediately. See `app/lib/__tests__/predicate-passthrough.test.ts`.

## The ranker: `scripts/rank-next-actions.mjs`

`rankNextActions(rubric, scoreMap, signalsSummary, limit=10)` produces the
priority list in one pass:

1. **Filter satisfied**: skip any `nextAction` where `evaluatePredicate(na.satisfiedWhen, signalsSummary)` returns `true`.
2. **Skip malformed**: entries with no `action` text are silently dropped.
3. **Compute rank**: `weight × deficit`, where `deficit = max(0, 100 − score)` and `weight` comes from `rubric.dimensions[n].weight`.
4. **Sort with a 5-tier tie-break**: rank desc → axis order (platform=0, execution=1, either/unknown=2) → weight desc → dimId asc → actionId asc.
5. **Slice to `limit`** (default 10).

The `axis` field defaults: if the action has a `satisfiedWhen` predicate it
defaults to `"platform"`; unpredicated coaching actions default to `"either"`.

`scripts/run-assessment.mjs` calls the ranker after scoring and writes the
result to `assessment.json` under `rankedNextActions`. Consumers — including
`.claude/skills/self-assessment/SKILL.md` — read the pre-computed list from
the file; they never re-derive it.

## CI contracts

Three test files lock the contract end-to-end:

- **`scripts/__tests__/predicate.test.mjs`** — operator coverage plus a named
  regression: `evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14
  })` must return `true`.
- **`scripts/__tests__/rank-next-actions.test.mjs`** — named regression:
  `loopCommandUses=14` must produce a list that does *not* contain
  `babysit-loop`; also covers tie-breaking, axis defaults, missing scoreMap
  entries, and the `limit` slice.
- **`app/lib/__tests__/predicate-passthrough.test.ts`** — reference-identity
  assertion that prevents any future divergence between the Node-side and
  Next.js-side evaluators.

## Hard rules (locked in CLAUDE.md)

Two rules were added to CLAUDE.md as part of this PR:

1. **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical;
   `app/lib/assessment.ts` must remain a 1-line passthrough re-export. The
   reference-identity CI test fails if this drifts.
2. **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
   self-assessment skill must never hand-implement the `satisfiedWhen` filter
   or the weight×deficit ranking. Read the pre-computed top-10 from the written
   file; surfacing a satisfied action as a TODO again is a regression.

## Where things live

| Path | Role |
|------|------|
| `scripts/predicate.mjs` | Canonical DSL evaluator |
| `scripts/rank-next-actions.mjs` | Filter + rank; writes nothing itself |
| `scripts/run-assessment.mjs` | Calls ranker, writes `rankedNextActions` to `assessment.json` |
| `app/lib/assessment.ts` lines 181–182 | 2-line passthrough re-export |
| `app/lib/__tests__/predicate-passthrough.test.ts` | Reference-identity CI guard |
| `scripts/__tests__/predicate.test.mjs` | DSL operator + regression coverage |
| `scripts/__tests__/rank-next-actions.test.mjs` | Ranker unit + named regression |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | Integration: scoreAll → rankNextActions |
| `.claude/skills/self-assessment/SKILL.md` | Reads pre-computed list; does not re-derive |
