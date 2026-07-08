---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: fix the `/self-assessment` DSL re-implementation bug

## The bug

A live run of `/self-assessment` on 2026-05-31 reported `Start with one loop:
/loop 30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` being `14`, which satisfies that action's
`satisfiedWhen` predicate (`loopCommandUses>=1`). An already-satisfied action
surfaced as a TODO.

Root cause: `SKILL.md` instructed the model running the skill to "first
filter, then rank" the rubric's next-actions itself, but the canonical
predicate evaluator lived only in `app/lib/assessment.ts` (TypeScript,
Next.js-coupled) with no Node-side caller the skill could invoke. The model
hand-wrote its own filter against the wrong shape — an object
(`{field, op, value}`) — instead of the actual string DSL
(`"loopCommandUses>=1"`). The evaluator it invented silently returned
false/null for every predicate, so nothing ever got filtered out.

## The fix, in two PRs

**PR 1 (#104, this page) — tactical.** Documented the `satisfiedWhen` DSL
grammar directly inside `SKILL.md`, underneath the existing "Top 3 priority
actions" bullet, so a careful model reading the skill would evaluate
predicates correctly even without a shared implementation. Stopgap only —
the fix was "make the instructions precise enough that hand-implementation
doesn't go wrong," not "remove the need to hand-implement."

**PR 2 — structural.** Extracted `evaluatePredicate` out of
`app/lib/assessment.ts` into `scripts/predicate.mjs`, a dependency-free
pure-ESM module importable from both `scripts/run-assessment.mjs` and the
Next.js app. `run-assessment.mjs` now pre-computes the filtered, ranked
top-10 next-actions once per run and writes them to
`assessment.json.rankedNextActions`. `SKILL.md`'s instructions collapsed to
a single line — read `assessment.json.rankedNextActions[0..2]`, already
filtered and sorted — and the PR 1 grammar block was deleted as obsolete.

This repo is currently on the PR 2 end state:

- `scripts/predicate.mjs` is the canonical DSL evaluator. Its header comment
  documents the same grammar PR 1 put in `SKILL.md`: bare `path` (truthy),
  `!path`, `>=`/`<=`/`>`/`<`, `path=v` (or `v|w|x` alternation), `path!=v`,
  `path~regex` (array-of-strings element match), and `A & B` conjunction.
- `app/lib/assessment.ts` re-exports `evaluatePredicate` from
  `scripts/predicate.mjs` as a 1-line passthrough rather than duplicating
  the implementation. `app/lib/__tests__/predicate-passthrough.test.ts`
  asserts the two are reference-equal so a future copy-instead-of-re-export
  fails CI.
- `.claude/skills/self-assessment/SKILL.md` no longer carries a DSL grammar
  block. It instructs the model to read
  `assessment.json.rankedNextActions[0..2]` directly — "already filtered
  (satisfied actions dropped) and ranked by `weight × deficit` by
  `scripts/rank-next-actions.mjs`" — and lists the fields each entry
  carries (`dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`,
  `action`, `effort`, `borisTip`, `satisfiedWhen`).

## Why two PRs instead of one

The design doc frames PR 1 as a deliberate stopgap: land the low-risk
documentation fix immediately (it can't break anything — additive-only, one
file), then do the riskier extraction-and-rewire work separately with its
own test suite (`scripts/__tests__/predicate.test.mjs`,
`scripts/__tests__/rank-next-actions.test.mjs`, the TS↔MJS equivalence
test). The regression that motivated PR 2 has a named test case in
`rank-next-actions.test.mjs`: a `loopCommandUses=14` fixture must exclude
the `loopCommandUses>=1` action from the ranked output, reproducing the
exact 2026-05-31 failure.

## Ranking rule, for reference

`rankNextActions` sorts by `weight × deficit` descending, then breaks ties
deterministically: axis (`platform` before `execution` before `either`),
then `weight` descending, then `dimId`, then `actionId` — both ascending,
locale-aware. The tie-break exists so that identical machine state always
produces an identical ranked list, matching the project's "same machine
state → same number" scoring promise.

## Lesson

The general failure pattern — a model re-implementing a DSL/parser from
memory instead of calling the real evaluator — is exactly the class of bug
CLAUDE.md's hard rules are meant to close off structurally, not just
document around: **"DSL evaluator has one source."** `scripts/predicate.mjs`
is canonical; `app/lib/assessment.ts:evaluatePredicate` must remain a
1-line passthrough. When the grammar evolves, edit `scripts/predicate.mjs`
and the rubric `$schema` comment — never the TS file. A skill that reads a
pre-computed field can't hand-implement the wrong shape; a skill that's
handed the raw rubric and told to filter it eventually will.
