---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# One predicate evaluator, and next-actions pre-ranked at write time

PR #106 closes a bug class where a model reads `rubric.json`, sees a
`satisfiedWhen` field, and reimplements the filter by hand instead of calling
the real evaluator. Guessing the shape wrong is easy: `satisfiedWhen` is a
**string** DSL (`"loopCommandUses>=1"`), not the `{ field, op, value }` object
a model tends to assume. Get that wrong and the ad-hoc filter silently
no-ops, and an already-satisfied action — the reference incident was
`babysit-loop` with `loopCommandUses: 14` — comes back as a top priority the
user has already addressed. PR #104 shipped a tactical fix first (a grammar
block pasted into `SKILL.md`); this PR is the structural one.

## The fix has two parts

**1. One canonical evaluator.** `scripts/predicate.mjs` is now the only place
the `satisfiedWhen` grammar is implemented. `app/lib/assessment.ts` doesn't
duplicate it — it re-exports the same function:

```ts
// app/lib/assessment.ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` asserts
`expect(fromTs).toBe(fromMjs)` — reference equality, not just behavioral
parity. If a future edit copies the implementation into the TS file instead
of importing it, that test fails immediately rather than drifting silently
until the two copies disagree on an edge case.

The grammar itself (`scripts/predicate.mjs`, mirrored in the `$schema`
comment atop `app/data/rubric.json`):

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty, and `"0"`/`"false"` also count as falsy) |
| `!path` | falsy |
| `path>=N`, `<=N`, `>N`, `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals, or equals one of |
| `path!=v` | not equals |
| `path~regex` | LHS must be an array of strings; true if any element matches `regex` (case-insensitive) |
| `A & B` | AND of two or more atoms |

`path` supports dotted lookup into `signalsSummary` (`readPath` walks
`.`-separated keys), and every comparison operator returns `false` rather
than throwing on a malformed path, non-numeric RHS, or unparseable regex —
the evaluator never crashes an assessment run over one bad predicate.

**2. Ranking moves out of the consumer.** `scripts/rank-next-actions.mjs`
exports `rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`,
called once from `scripts/run-assessment.mjs` and written straight into
`assessment.json` as `rankedNextActions`. It:

- walks every dimension's `nextActions`, skipping any with a missing
  `action` field (malformed, skipped silently) or a dimension absent from
  `scoreMap`;
- drops any action whose `satisfiedWhen` evaluates true against
  `signalsSummary` — this is the actual fix, using the one true evaluator
  instead of a reimplementation;
- computes `deficit` as `100 - score` on the `platform` axis or
  `100 - executionScore` on the `execution` axis (`0` if
  `executionScore` is `null`), and axis defaults to `"platform"` when a
  `satisfiedWhen` predicate exists, `"either"` otherwise;
- ranks by `weight × deficit`, then breaks ties by axis order
  (`platform` → `execution` → everything else, including unrecognized axis
  strings), then by weight, then `dimId`, then `actionId` — fully
  deterministic, per
  `scripts/__tests__/rank-next-actions.test.mjs`.

`run-assessment.mjs` writes the result verbatim:

```js
rankedNextActions: rankNextActions(rubric, scoreMap, signalsSummary, 10),
```

## What consumers do now

The `.claude/skills/self-assessment/SKILL.md` instructions no longer describe
a filter to implement — they describe a field to read:

> Top 3 priority actions, noting which axis each falls on. Read
> `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
> actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

Each entry in the array carries `dimId`, `actionId`, `axis`, `weight`,
`deficit`, `rank`, `action`, `effort`, `borisTip`, and `satisfiedWhen` (the
raw predicate string, or `null` for unpredicated coaching actions) — enough
for a consumer to report the action and its provenance without touching
`signalsSummary` at all.

The dashboard's own loader (`app/lib/assessment.ts:loadAssessment`) still
calls `evaluatePredicate` directly, but only to compute the per-action
`satisfied` boolean shown inline on `/dimensions/<id>` — it reads
`assessment.json.rankedNextActions` as-is everywhere it needs a ranked list,
same as any other consumer.

## Why this is the durable fix, not just a patch

CLAUDE.md's hard-rules section records the precedent this closes: "Ranked
next-actions live in `assessment.json.rankedNextActions`. The
self-assessment skill must NEVER hand-implement the `satisfiedWhen` filter
or the weight×deficit ranking. Read the pre-computed top-10 from the written
file." The fix isn't "tell the model the correct grammar" (that's PR #104,
and it only holds until the next fresh context window forgets it) — it's
removing the reimplementation opportunity entirely. There is one evaluator
(`scripts/predicate.mjs`, enforced reference-equal into the TS side), and
there is one ranked list, computed once at assessment-write time
(`scripts/__tests__/rank-next-actions.test.mjs` and
`scripts/__tests__/run-assessment-ranking.test.mjs` cover the unit and
integration paths respectively). A consumer can still get the DSL shape
wrong in its head, but it no longer gets a chance to act on that wrong
belief — it's reading data, not writing logic.
