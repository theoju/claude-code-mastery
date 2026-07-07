---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Canonical predicate evaluator and ranked next-actions

PR #106 closes out a two-PR fix for a recurring bug class in how
`satisfiedWhen` next-actions get filtered and ranked. It does two things:

1. Extracts the `satisfiedWhen` predicate-string DSL evaluator into a new
   canonical module, `scripts/predicate.mjs`. `app/lib/assessment.ts`'s
   `evaluatePredicate` collapses to a 1-line re-export of it.
2. Moves next-action ranking (weight × deficit, filtered by `satisfiedWhen`)
   out of ad-hoc call sites and into a pre-computed pipeline,
   `scripts/rank-next-actions.mjs`, whose output is written to
   `assessment.json.rankedNextActions` by `scripts/run-assessment.mjs`.

## Context

On 2026-05-31 a model hand-wrote its own next-action ranker for a report and
mis-modeled `satisfiedWhen` as an object instead of what it actually is — a
rubric string DSL (`path>=N`, `path=v|w`, `A & B`, etc., see Grammar below).
Feeding an object shape into that mental model meant the evaluator effectively
returned nothing usable: no actions got filtered, and an already-satisfied
next-action surfaced as a top-3 priority in the report.

PR #104 shipped a tactical fix — clarifying the grammar in the rubric's
`$schema` comment. PR #106 is the structural fix: give the DSL evaluator and
the ranking logic one canonical source of truth that downstream consumers
*read*, rather than a spec that consumers have to *reimplement* correctly
every time.

## The evaluator: `scripts/predicate.mjs`

`evaluatePredicate(expr, signals)` is now defined once, in
`scripts/predicate.mjs`. It's pure ESM (no TypeScript build step needed) and
handles the full grammar the rubric's next-actions rely on:

```
path                — truthy (non-null, non-zero, non-empty-string;
                       "0"/"false" strings also read as falsy)
!path                — falsy
path>=N / <=N / >N / <N — numeric comparison
path=v / path=v|w|x  — equals (or equals one of, pipe-delimited)
path!=v              — not equals
path~regex           — array-of-strings element matches regex (i flag)
A & B                — AND of two or more atoms
```

`path` is dot-notation into the flat `signalsSummary` object
(`readPath` walks it segment by segment and returns `undefined` on a miss —
it never throws on a malformed path). The `~` array-regex form is the one
non-obvious operator: it's the only atom that expects an array LHS, and it
returns `false` rather than throwing for a non-array LHS or an unparseable
regex.

`app/lib/assessment.ts` no longer contains an implementation — it does this:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

A dedicated test,
`app/lib/__tests__/predicate-passthrough.test.ts`, asserts reference equality
(`expect(fromTs).toBe(fromMjs)`) rather than behavioral equivalence — that's
a stronger guarantee than "produces the same output for these cases," and it
fails immediately if anyone reintroduces a second implementation. CLAUDE.md
now states this as a hard rule: `scripts/predicate.mjs` is canonical, the TS
side must stay a 1-line passthrough, and DSL grammar changes happen there
(and in the rubric's `$schema` comment) — never in the TS file.

## Ranked next-actions: `scripts/rank-next-actions.mjs`

The second half moves filtering and ranking out of individual consumers and
into `rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`, called
once per run from `scripts/run-assessment.mjs`. For every dimension's
`nextActions`, it:

- Skips any action whose `satisfiedWhen` evaluates truthy against
  `signalsSummary` (already done — same evaluator, same source of truth).
- Computes a per-action deficit: `100 - executionScore` for `axis:
"execution"` actions, `100 - score` for everything else.
- Ranks by `weight × deficit`, with axis (platform before execution before
  either), then weight, then dimension/action id as tie-breakers.
- Returns the top `limit` (default 10) as flat objects: `dimId`, `actionId`,
  `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`,
  `satisfiedWhen`.

That array is written verbatim to `assessment.json.rankedNextActions`. The
`self-assessment` skill's instructions
(`.claude/skills/self-assessment/SKILL.md`) now point straight at
`rankedNextActions[0..2]` for the "top 3 priority actions" section of its
report, instead of describing a filter-and-sort the skill would otherwise
have to re-derive from the raw rubric. CLAUDE.md's "Ranked next-actions" rule
makes this a hard constraint: the skill must never hand-implement the
`satisfiedWhen` filter or the weight×deficit ranking again — read the
pre-computed list.

## Test coverage

- `scripts/__tests__/predicate.test.mjs` — the DSL evaluator itself, grammar
  case by case.
- `app/lib/__tests__/predicate-passthrough.test.ts` — reference-equality
  guard against a duplicate TS implementation reappearing.
- `scripts/__tests__/rank-next-actions.test.mjs` — filtering, deficit math,
  and tie-break ordering for `rankNextActions`.
- `scripts/__tests__/run-assessment-ranking.test.mjs` — end-to-end: the
  pipeline actually writes `rankedNextActions` into `assessment.json`.

## Consequences

- There is now exactly one place that can misparse the DSL, and exactly one
  place that can get the ranking formula wrong — both covered by direct unit
  tests, rather than the correctness of ranking depending on every future
  consumer (skills, reports, dashboard pages) re-deriving the rubric's DSL
  from the `$schema` comment.
- No `architecture/` or `archive/` subsection exists yet under the `core`
  lens root (only `images/`), so this page uses a flat dated slug rather
  than a nested path — consistent with how this lens currently organizes
  one-off decision write-ups.
