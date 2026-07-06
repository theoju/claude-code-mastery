---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: architecture
---

# The canonical predicate evaluator, and where ranked next-actions come from

Every rubric next-action can carry a `satisfiedWhen` string — a small DSL
expression (`hasFormatterHook`, `loopCommandUses>=1`,
`outputStyle=Explanatory|Learning`) that's evaluated against the flat
`signalsSummary` object to decide whether that action is already done. Two
different call sites need this evaluation: the Node-side scorer
(`scripts/run-assessment.mjs`) when it writes `assessment.json`, and the
Next.js dashboard when it renders per-dimension next-action lists client-side.
As of PR #106, both call the *same* function — there is exactly one
implementation of the DSL, and a test enforces that.

## Why this needed fixing

Before this PR, the evaluator's logic lived in `app/lib/assessment.ts`, and
anything outside the Next.js build (a subagent generating a report, a
skill reasoning about what's left to do) had no shared source to call. The
failure mode this produced: a model asked to figure out "what should the user
do next" would look at a `satisfiedWhen` string, treat it as a structured
condition to reason about rather than an expression to *evaluate*, misread it,
and surface an already-satisfied action (`babysit-loop`) as a top priority.
A prior PR (#104) tried to patch this with a stopgap grammar doc for models to
read before reasoning about predicates by hand. This PR removes the need for
that altogether: nothing hand-evaluates the DSL anymore. The `/self-assessment`
skill just reads a pre-computed, pre-filtered, pre-ranked array.

## `scripts/predicate.mjs` is canonical

`scripts/predicate.mjs` exports one function, `evaluatePredicate(expr,
signals)`, and it's the only place the grammar is implemented:

- `path` — truthy check (`isTruthy`: non-null/undefined, non-zero, non-empty
  string, and the strings `"0"` / `"false"` are also falsy)
- `!path` — negation
- `path>=N`, `<=N`, `>N`, `<N` — numeric comparison (operators are matched
  longest-first so `>=` doesn't get misparsed as `>`)
- `path=v` or `path=v|w|x` — string equality against one or more
  pipe-separated literals; `path!=v` is the negation
- `path~regex` — the LHS must resolve to an array; each element is tested
  against the RHS as a case-insensitive regex (returns `false`, never throws,
  on a non-array LHS or an unparseable pattern)
- `A & B` — AND of two or more atoms, split on `&` and evaluated with
  `.every()`

Paths are read with a small dot-path walker (`readPath`) that returns
`undefined` on any missing segment rather than throwing, so a predicate
referencing a signal that isn't present just evaluates falsy.

`app/lib/assessment.ts` no longer contains a second implementation. It does
this instead:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

That one-line passthrough is enforced by
`app/lib/__tests__/predicate-passthrough.test.ts`, which imports
`evaluatePredicate` from both `@/app/lib/assessment` and
`@/scripts/predicate.mjs` and asserts `toBe` (reference equality, not just
behavioral equivalence). If a future edit reintroduces a second copy in the
TS file, that test fails immediately — CLAUDE.md now states this as a hard
rule ("DSL evaluator has one source") specifically so nobody re-forks the
grammar under time pressure.

## `scripts/rank-next-actions.mjs`: filter, then rank

Filtering by `satisfiedWhen` is necessary but not sufficient — a raw list of
unsatisfied next-actions across 12 dimensions is not a priority list. PR #106
also introduces `rankNextActions(rubric, scoreMap, signalsSummary, limit)`,
which:

1. Walks every dimension's `nextActions`, skipping any `na` missing an
   `action` field (malformed entries are dropped silently rather than
   crashing the run).
2. Drops any action whose `satisfiedWhen` evaluates `true` against
   `signalsSummary` via the canonical `evaluatePredicate` — this is the same
   function described above, imported directly, not reimplemented.
3. Computes a per-dimension deficit: `pDeficit = max(0, 100 - score)` for
   Platform Setup, `xDeficit = max(0, 100 - executionScore)` for Execution
   (or `0` if `executionScore` is `null`, i.e. unmeasured). Each next-action's
   `axis` field (`"platform"`, `"execution"`, or the default `"either"` when
   there's no `satisfiedWhen`) selects which deficit applies.
4. Ranks by `weight × deficit`, with a fully deterministic tie-break so two
   runs against identical input produce byte-identical output: `rank` desc,
   then axis order (platform < execution < either), then `weight` desc, then
   `dimId` alphabetical, then `actionId` alphabetical.
5. Slices to `limit` (the caller passes `10`).

`scripts/run-assessment.mjs` calls this once per run and writes the result
into `assessment.json` verbatim:

```js
rankedNextActions: rankNextActions(rubric, scoreMap, signalsSummary, 10),
```

Each entry in that array carries `dimId`, `actionId`, `axis`, `weight`,
`deficit`, `rank`, `action`, `effort`, `borisTip`, and `satisfiedWhen` (or
`null` if the action had none). This is the exact shape the
`RankedNextAction` TypeScript interface in `app/lib/assessment.ts` declares,
and it's what `Assessment.rankedNextActions` resolves to for both the
dashboard and any script reading `assessment.json` directly.

## The `/self-assessment` skill no longer reimplements anything

`.claude/skills/self-assessment/SKILL.md` now tells the model, in the "What
to do" section: read `assessment.json.rankedNextActions[0..2]` for the top 3
priority actions — "already filtered (satisfied actions dropped) and ranked
by `weight × deficit` by `scripts/rank-next-actions.mjs`." There's no
instruction anywhere in the skill to re-derive that filter or that ranking by
reasoning over the rubric and signals directly, which is the change that
actually closes the bug class: the skill has nowhere left to go wrong,
because the one place the logic used to get reimplemented no longer asks it
to be. CLAUDE.md states this as a hard rule too — "Ranked next-actions live
in `assessment.json.rankedNextActions`" — with an explicit note that
surfacing a satisfied action as a TODO again is a regression in the data
layer, not the report.

## Test coverage

- `scripts/__tests__/predicate.test.mjs` — the DSL grammar itself (truthy,
  negation, comparisons, equality/pipe-alternatives, array-regex, AND).
- `app/lib/__tests__/predicate-passthrough.test.ts` — reference-equality
  between the TS re-export and the `.mjs` source.
- `scripts/__tests__/rank-next-actions.test.mjs` — filtering (satisfied
  actions dropped, malformed actions skipped), axis-based deficit selection,
  and the full tie-break chain against a fixture rubric.
- `scripts/__tests__/run-assessment-ranking.test.mjs` — integration test
  against `scoreAll`'s real output: asserts `rankedNextActions` never exceeds
  the requested limit and that ranking is deterministic across two identical
  runs (`toEqual` on back-to-back calls with the same inputs).

## Where new pages like this one live

There's no `architecture/` or `archive/` section under the `core` lens yet
(only an `images/` directory), so this page and its companion decision
record sit at the lens root using a dated slug. If a section structure gets
introduced later, both should move under it rather than staying at the root
by convention.
