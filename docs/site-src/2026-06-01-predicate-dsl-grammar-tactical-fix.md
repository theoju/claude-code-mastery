---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar: a tactical fix (PR #104)

## The bug

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m /babysit`
as a top-3 priority action even though `signalsSummary.loopCommandUses` was
already `14` — well past the action's own `satisfiedWhen: "loopCommandUses>=1"`
threshold. The action should have been filtered out as satisfied.

Root cause: the skill's instructions told the model to "first filter, then
rank" the rubric's next-actions, but `satisfiedWhen` is a **string** DSL
(`"loopCommandUses>=1"`), not the `{field, op, value}` object shape a model
would reach for by convention. The model running the skill hand-wrote its own
filter against the wrong shape, that filter silently matched nothing, and an
already-satisfied action surfaced as a TODO.

The canonical evaluator already existed at
`app/lib/assessment.ts:evaluatePredicate` — but nothing in `.claude/skills/self-assessment/SKILL.md`
told the model that, or documented the grammar it implements.

## The fix (PR 1 of 2)

PR #104 was the **tactical** half of a two-PR sequence. It added a 12-line
grammar reference block to `SKILL.md`, directly under the "Top 3 priority
actions" bullet, documenting all seven `satisfiedWhen` operator classes:

- `path` — truthy (non-null, non-zero, non-empty; `"0"` / `"false"` also falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

...plus a pointer to `app/lib/assessment.ts:evaluatePredicate` as the
canonical implementation, and a worked example: `loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` evaluates to true, so the action gets
filtered out rather than surfaced.

This was explicitly a stopgap. The design doc (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`)
frames it as PR 1 of 2: document the grammar so a careful model interprets it
correctly *today*, while PR 2 removes the need for any model to interpret the
DSL at all.

## What superseded it

PR 2 landed the structural fix: `evaluatePredicate` was extracted to a
Node-shareable `scripts/predicate.mjs` (now the single canonical evaluator —
`app/lib/assessment.ts` re-exports it as a 1-line passthrough, enforced by a
reference-equality test), and `scripts/run-assessment.mjs` now pre-computes a
filtered, ranked top-10 list at `assessment.json.rankedNextActions` via
`scripts/rank-next-actions.mjs`.

As of that landing, `SKILL.md` no longer hand-implements filtering or
ranking at all — the current instruction is to read
`assessment.json.rankedNextActions[0..2]` verbatim, "already filtered
(satisfied actions dropped) and ranked by `weight × deficit`." The grammar
block this PR added was deleted in the same follow-up, exactly as the design
doc's ship sequencing called for. `CLAUDE.md`'s hard rules now codify both
halves of this: `predicate.mjs` is the one DSL source, and the skill "must
NEVER hand-implement the satisfiedWhen filter or the weight×deficit ranking."

## Why this page exists

This PR's own contribution — the grammar block — is no longer present in the
repo. It's documented here because the pattern is worth keeping as a
reference: a tactical, additive, low-risk doc fix shipped ahead of a
structural fix that made the tactical fix's own content obsolete by design.
If you're touching `satisfiedWhen` predicates or the ranking logic, the
grammar (unchanged since this PR — see "No DSL grammar changes" in the
design doc's non-goals) is now best read directly from
`scripts/predicate.mjs`, not from `SKILL.md`.
