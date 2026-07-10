---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# The predicate evaluator has one source, and next-actions are pre-ranked

PR #106 closed a bug class where a model hand-implementing the
`satisfiedWhen` filter would quietly get it wrong. This page covers the two
structural changes that landed: a single canonical DSL evaluator
(`scripts/predicate.mjs`), and a pre-computed `rankedNextActions` list
written into `assessment.json` so no downstream consumer re-derives the
filter/sort logic itself.

## The bug this fixes

`app/data/rubric.json` next-actions carry an optional `satisfiedWhen`
string — a small DSL, not an object. A real example, from
`scripts/__tests__/rank-next-actions.test.mjs`:

```json
{
  "id": "babysit-loop",
  "action": "Start with one loop — Boris tip 48",
  "satisfiedWhen": "loopCommandUses>=1"
}
```

Before this PR, a model asked to compute "top next actions" without reading
pre-computed output tended to mis-model `satisfiedWhen` as an object shape
(`{field, op, value}`) instead of the rubric's actual string grammar. The
evaluator it improvised then silently returned `null` for every predicate,
nothing got filtered, and an already-satisfied action —
`babysit-loop`, with `loopCommandUses` at 14 — surfaced as a top-3
next-action anyway. PR #104 was the tactical fix (documenting the grammar in
`SKILL.md`). PR #106 is the structural fix: centralize the evaluator so
there's only one implementation to get right, and pre-compute the ranked
list so nothing downstream needs to reimplement the filter/sort at all.

## The DSL, as actually implemented

The canonical evaluator is `scripts/predicate.mjs`, a pure-ESM module with
no dependencies. Its grammar comment (mirrored in the rubric's `$schema`
comment) is the ground truth:

```
path                — truthy (non-null, non-zero, non-empty-string; "0"/"false" also falsy)
!path                — falsy
path>=N / <=N / >N / <N — numeric comparison
path=v / path=v|w|x  — equals (or equals one of)
path!=v              — not equals
path~regex           — array-of-strings element matches regex (i flag)
A & B                — AND of two or more atoms
```

A few implementation details worth knowing if you're writing or debugging a
predicate:

- **Operator length matters.** The comparison regex tries `>=`, `<=`, `!=`,
  `=`, `>`, `<` in that order specifically so `>=` doesn't get parsed as a
  bare `>` followed by garbage.
- **Comparisons never throw.** If either side of a numeric comparison isn't
  a valid number (`Number.isNaN`), the atom evaluates to `false` rather than
  throwing. Same for `~regex`: a non-array left-hand side or an unparseable
  regex pattern returns `false`, not an exception.
- **`&` is the only combinator.** There's no `|` (OR) at the DSL level —
  `evaluatePredicate` splits on `&` and requires every atom to hold
  (`.every(...)`). If a rubric author needs OR semantics (e.g.
  `effortMaxAdopted` in `scripts/run-assessment.mjs`, which credits either a
  persistent `max` setting or ≥2 transcript invocations), that OR gets
  computed upstream into a single derived boolean field in
  `buildSignalsSummary`, and the rubric predicate just checks that field
  truthy.
- **Path reads are dot-separated and defensive.** `readPath` walks
  `path.split(".")` against the signals object and returns `undefined` on
  any missing segment — no throwing on a typo'd field name, it just always
  evaluates falsy.

`app/lib/assessment.ts` — the Next.js-side consumer — does not reimplement
any of this. It's a one-line passthrough:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` enforces that this stays
a passthrough by asserting reference equality between the TS export and the
`.mjs` source (`expect(fromTs).toBe(fromMjs)`). If someone ever pastes the
implementation into the TS file instead of re-exporting, that test fails —
by construction, not by convention.

## Next-actions are ranked once, upstream

The second half of PR #106 moves the next-actions filter+rank out of every
consumer and into a single pre-computation step. `scripts/rank-next-actions.mjs`
exports `rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`,
which:

1. Walks every dimension's `nextActions`.
2. Drops any action whose `satisfiedWhen` evaluates truthy against
   `signalsSummary` (via the canonical `evaluatePredicate`).
3. Computes a per-action `deficit` — `100 - score` for platform-axis
   actions, `100 - executionScore` for execution-axis actions (execution
   deficit is `0` when `executionScore` is `null`, i.e. the dimension is
   unmeasured on that axis).
4. Ranks by `weight × deficit`, descending.
5. Breaks ties deterministically: rank → axis order (`platform` < `execution`
   < everything else, including unrecognized axis values) → weight →
   `dimId` → `actionId`. `scripts/__tests__/rank-next-actions.test.mjs` pins
   this exact tie-break order.
6. Silently skips malformed entries (missing `action` text) and any
   dimension absent from `scoreMap` — it doesn't crash on partial input.

`scripts/run-assessment.mjs` calls this once, after scoring:

```js
rankedNextActions: rankNextActions(rubric, scoreMap, signalsSummary, 10),
```

...and the result is written straight into `assessment.json.rankedNextActions`.
Each entry carries `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`,
`action`, `effort`, `borisTip`, and the original `satisfiedWhen` string (for
debuggability — so you can see *why* an action was or wasn't filtered
without re-running the predicate yourself).

## What this means for consumers

The `self-assessment` skill (`.claude/skills/self-assessment/SKILL.md`) is
explicit about this now: report the top 3 priority actions by reading
`assessment.json.rankedNextActions[0..2]` directly — "already filtered
(satisfied actions dropped) and ranked by `weight × deficit`." The skill
doc calls out the field list verbatim so there's no ambiguity about what's
available without recomputation.

This is the general shape worth reusing whenever a report-generating
consumer (a skill, a dashboard page, a future CLI) needs a derived,
filtered, or ranked view of rubric data: compute it once, in the same place
that owns the scoring pipeline, and write it to the artifact everyone
already reads. Don't leave a second implementation for consumers to
reinvent — that's exactly the gap `babysit-loop` fell through.

## Where the code lives

| Concern | File |
| --- | --- |
| Canonical DSL evaluator | `scripts/predicate.mjs` |
| TS re-export (must stay 1-line) | `app/lib/assessment.ts` |
| Passthrough regression test | `app/lib/__tests__/predicate-passthrough.test.ts` |
| Evaluator unit tests | `scripts/__tests__/predicate.test.mjs` |
| Ranking logic | `scripts/rank-next-actions.mjs` |
| Ranking unit tests (incl. the named regression) | `scripts/__tests__/rank-next-actions.test.mjs` |
| Wiring into the assessment pipeline | `scripts/run-assessment.mjs` |
| Ranking-in-pipeline test | `scripts/__tests__/run-assessment-ranking.test.mjs` |
| Consumer contract | `.claude/skills/self-assessment/SKILL.md` |

*This page currently lives at the `core` lens root as a flat dated slug —
the lens has no `architecture/` subdirectory scaffolded yet. If one gets
added, this is a good candidate to relocate there and cross-link from a
scoring-model overview page.*
