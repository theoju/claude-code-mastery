---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar fix (PR #104)

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` being `14`, which should have satisfied that
action's `satisfiedWhen` predicate (`loopCommandUses>=1`) and dropped it from
the list entirely.

Root cause: the skill's instructions said to "first filter, then rank," but
left the model to hand-implement the filter. The model assumed
`satisfiedWhen` was a structured object (`{field, op, value}`). It's actually
a string DSL (e.g. `"loopCommandUses>=1"`), evaluated by
`evaluatePredicate` in `app/lib/assessment.ts`. The model's hand-rolled filter
never matched a string, returned no matches for anything, and so nothing got
filtered — an already-satisfied action surfaced as an unfinished TODO.

## The fix (PR 1 of 2)

PR #104 is the tactical half: it added an explicit grammar block to
`.claude/skills/self-assessment/SKILL.md`, directly under the "Top 3
priority actions" bullet, spelling out all seven operator classes the DSL
supports:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings `"0"`
  and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block pointed at the canonical implementation
(`app/lib/assessment.ts:evaluatePredicate`) and included the worked example
that had just failed: `loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` evaluates to **true**, so the action
must be filtered out rather than surfaced.

This was documentation-only — additive to a single file, no scorer or schema
changes, no new tests (there's nothing to unit-test in a markdown edit). It
shipped alongside a design spec
(`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`) and
implementation plan for the follow-up structural fix.

## Why a stopgap, not the real fix

Making the grammar explicit in the skill reduces the odds a careful model
re-derives the DSL correctly, but it doesn't eliminate the bug class: the
skill still asks a model to evaluate predicates freehand, which is exactly
what produced the 2026-05-31 incident in the first place. The design doc is
explicit that PR #104 is "PR 1 of 2" —
a stopgap until the canonical evaluator can be shared with the
non-Next.js-coupled scoring script directly, so nothing has to evaluate a
predicate freehand at all.

## The structural fix that superseded it

The design spec's PR 2 extracted `evaluatePredicate` (and its helpers
`readPath`, `isTruthy`, `evaluateAtomic`) out of `app/lib/assessment.ts` into
a dependency-free `scripts/predicate.mjs`, imported by both
`scripts/run-assessment.mjs` and the TS file (which now re-exports it as a
1-line passthrough). `run-assessment.mjs` calls a new `rankNextActions()` at
score time — filtering out any action whose `satisfiedWhen` predicate
evaluates true against `signalsSummary`, ranking the rest by
`weight × deficit` with a deterministic tie-break (axis, then weight, then
`dimId`, then `actionId`) — and writes the top 10 to
`assessment.json.rankedNextActions`.

Once that field existed, the PR 1 grammar block in `SKILL.md` became
obsolete and was deleted: the skill now just reads
`assessment.json.rankedNextActions[0..2]` verbatim instead of evaluating
anything itself. That's the state of `SKILL.md` today — it instructs the
model to "Read `assessment.json.rankedNextActions[0..2]` — already filtered
(satisfied actions dropped) and ranked by `weight × deficit`," with no DSL
grammar in sight. `scripts/predicate.mjs` is now the sole canonical
evaluator, enforced by a CI-checked reference-equality test
(`app/lib/__tests__/predicate-passthrough.test.ts`) that fails the build if
anyone copies the implementation back into the TS file instead of
re-exporting it.

## Takeaway

The self-assessment skill must never hand-implement the `satisfiedWhen`
filter or the weight×deficit ranking — that logic lives exactly once, in
`scripts/predicate.mjs` and `scripts/rank-next-actions.mjs`, and is
pre-computed into `assessment.json` before the skill ever runs. Surfacing a
satisfied action as a TODO again would be a regression in the data layer,
not something a smarter prompt can paper over.
