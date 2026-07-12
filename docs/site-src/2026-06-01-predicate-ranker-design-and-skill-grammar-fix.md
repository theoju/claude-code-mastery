---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions: closing the "model re-implements the DSL" bug class

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` already sitting at 14, well past the
action's own `satisfiedWhen: "loopCommandUses>=1"` threshold. The action
should have been filtered out. It wasn't.

## Root cause

`SKILL.md` instructs the model running `/self-assessment` to "first filter,
then rank" the rubric's next-actions before reporting them. But the
canonical `satisfiedWhen` evaluator, `evaluatePredicate`, lived only in
`app/lib/assessment.ts` — TypeScript, Next.js-coupled by location, with no
Node-side (`scripts/`) caller. There was nothing for the skill to invoke.

So the model hand-rolled its own filter. It assumed `satisfiedWhen` was
shaped like `{ field, op, value }` — a reasonable guess for a predicate
field, but wrong. The rubric actually encodes `satisfiedWhen` as a compact
string DSL (`"loopCommandUses>=1"`, `"!hasShipCommand"`,
`"effortLevel=high|max"`, …). The hand-rolled evaluator returned `null` for
every string predicate it saw, so nothing was ever filtered, and
already-satisfied actions kept surfacing as TODOs.

## Decision: split the fix into two PRs

Documented in `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`,
the fix ships in two parts rather than one:

**PR 1 (tactical, this one, #104):** Insert the DSL grammar directly into
`.claude/skills/self-assessment/SKILL.md`, beneath the existing "Top 3
priority actions" bullet. Seven operator classes, each with a one-line
description, plus a pointer to the canonical implementation
(`app/lib/assessment.ts:evaluatePredicate`) and a worked example
(`loopCommandUses>=1` against `signalsSummary.loopCommandUses=14` →
`true` → filter the action out). This is a stopgap: it gives a careful
model enough grammar to evaluate predicates correctly by hand, but it
doesn't remove the re-implementation risk — a future skill run can still
get the grammar wrong, or the grammar block can drift from the real
evaluator.

**PR 2 (structural, designed but not part of this PR):** Extract
`evaluatePredicate` and its helpers (`readPath`, `isTruthy`,
`evaluateAtomic`) out of `app/lib/assessment.ts` into a pure-ESM
`scripts/predicate.mjs`, importable from both Node scripts and the
Next.js app. `app/lib/assessment.ts` becomes a 1-line passthrough
re-export. `scripts/run-assessment.mjs` then does the filter-and-rank
itself — once, in `rankNextActions(rubric, scoreMap, signalsSummary,
limit=10)` — and writes the result to a new `assessment.json.rankedNextActions`
top-level field (sorted by `weight × deficit`, capped at 10 entries,
already excluding satisfied actions). The skill stops evaluating
predicates at all; it just reads `rankedNextActions[0..2]` verbatim. Once
that field exists, the PR 1 grammar block is deleted from `SKILL.md` as
obsolete — the model no longer needs to know the DSL grammar to report
correctly.

Why not do the structural fix directly instead of the tactical one first?
The immediate bug — an already-satisfied action surfacing as a
recommendation — needed to stop recurring in the interim, and PR 1 is a
one-file, additive-only, zero-risk documentation change. PR 2 touches five
files across two module systems (adding a Node-shareable extraction of
TS-hosted logic, a new scoring-pipeline step, and a schema addition to
`assessment.json`) and warrants its own review cycle, including a
TS↔MJS reference-equality test (`app/lib/__tests__/predicate-passthrough.test.ts`)
to guarantee the extraction never regresses into two divergent
implementations.

## The DSL grammar (as documented in PR 1)

String predicates evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; the strings `"0"` and `"false"` are also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate` (until
PR 2 relocates it to `scripts/predicate.mjs`).

## What the structural fix (PR 2) will change once it lands

Per the design spec, PR 2's `rankNextActions` algorithm walks every rubric
dimension, computes a Platform-Setup deficit and an Execution deficit per
dimension, and for each `nextAction` not already satisfied by
`evaluatePredicate`, pushes a ranked entry keyed on `weight × deficit`.
Ties break deterministically: rank descending, then axis (`platform` before
`execution` before `either`), then weight descending, then `dimId` and
`actionId` ascending — matching the project's "same machine state → same
number" determinism promise. The new field is additive only:
`assessment.json`'s existing fields are unchanged, and the dashboard's
`/methodology/probes` and `/dimensions/[id]` pages keep evaluating
predicates fresh at request time for their own ✓/✗ marks — `rankedNextActions`
serves the skill, not the dashboard's render paths.

Error handling in the design is deliberately conservative: a predicate
parse error, an unknown operator, or a missing signal field all resolve to
"action kept" (never silently dropped) — matching the existing TS
behavior. A `nextAction` missing its `action` text is skipped with no
warning (malformed rubric data, not a runtime concern).

## Status

PR 1 (#104) is the tactical grammar-block addition described above, plus
the design spec and implementation plan for PR 2. PR 2 itself — the
`scripts/predicate.mjs` extraction, the `rankNextActions` ranker, and the
deletion of the PR 1 grammar block — is designed but shipped separately.
Once PR 2 merges, this page should be revisited: the grammar block it
documents will no longer exist in `SKILL.md`, and `/self-assessment`
reports should read `assessment.json.rankedNextActions[0..2]` directly
rather than evaluating predicates inline.

## Regression coverage

The design spec commits PR 2 to a named regression test in
`scripts/__tests__/rank-next-actions.test.mjs`: a fixture where
`loopCommandUses=14` must exclude the `loopCommandUses>=1` action from
`rankNextActions`'s output, even though that action's `weight × deficit`
would otherwise rank it highest. That test is the permanent guard against
today's specific bug recurring.
