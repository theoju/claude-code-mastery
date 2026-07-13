---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Tactical fix: documenting the `satisfiedWhen` DSL grammar in SKILL.md

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m
/babysit` as a top-3 priority action even though
`signalsSummary.loopCommandUses` was `14` — well past the action's own
`satisfiedWhen` threshold of `loopCommandUses>=1`. The action should have
been filtered out before it ever reached the report.

## Root cause

`app/data/rubric.json` encodes `satisfiedWhen` as a **string DSL**
(`"loopCommandUses>=1"`), evaluated by the canonical evaluator at
`app/lib/assessment.ts:evaluatePredicate`. At the time of the bug, that
evaluator lived only in TypeScript, coupled to the Next.js app — there was
no Node-side caller `.claude/skills/self-assessment/SKILL.md` could point
at. The skill's instructions told the model running it to "first filter,
then rank" the rubric's next-actions itself, but gave no grammar reference.
The model hand-wrote a filter assuming `satisfiedWhen` was a
`{field, op, value}` object. Every string predicate silently failed to
parse under that assumption, so the filter step was a no-op end to end:
already-satisfied actions surfaced as if they were still open.

## PR 104: the tactical fix

PR #104 closed the immediate gap by inserting a 12-line grammar block into
`.claude/skills/self-assessment/SKILL.md`, directly beneath the "Top 3
priority actions" instruction. It enumerated the seven operator classes the
DSL actually supports — bare-path truthiness, negation, the four numeric
comparators, equals/equals-one-of, not-equals, and the array-regex match, plus
the `A & B` AND form — pointed at `app/lib/assessment.ts:evaluatePredicate`
as the canonical implementation, and included a worked example using the
triggering bug's own predicate (`loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` → `true` → filter the action out).

This was documentation-only: no code changed, and no test suite covers a
markdown grammar block. The fix works by making a careful model less likely
to reinvent the DSL from an assumed shape.

## Why this was explicitly provisional

PR #104 shipped alongside a design spec and implementation plan for a
follow-up structural fix, because a documentation patch doesn't eliminate
the underlying bug class — it only reduces the odds of a model
mis-implementing the filter on any given run. The structural plan called for:

1. Extracting `evaluatePredicate` out of `app/lib/assessment.ts` into a
   pure-ESM `scripts/predicate.mjs`, importable from both the Next.js app
   and Node-side scripts.
2. Pre-computing the filtered, ranked next-actions list once, inside
   `scripts/run-assessment.mjs`, and writing it to a new
   `assessment.json.rankedNextActions` field.
3. Rewriting the SKILL.md instruction to a trivial read of
   `rankedNextActions[0..2]` — and **deleting the PR 104 grammar block**,
   since a skill that never re-implements the filter no longer needs the
   grammar spelled out for it.

That structural work has since landed. `.claude/skills/self-assessment/SKILL.md`
no longer carries the DSL grammar block — it instructs the model to read
`assessment.json.rankedNextActions[0..2]`, already filtered (satisfied
actions dropped) and ranked by `weight × deficit` via
`scripts/rank-next-actions.mjs`. `scripts/predicate.mjs` is now the single
canonical evaluator; `app/lib/assessment.ts:evaluatePredicate` is a 1-line
passthrough re-export, enforced by a reference-equality test
(`app/lib/__tests__/predicate-passthrough.test.ts`). This is now a CLAUDE.md
hard rule: edit the DSL only in `scripts/predicate.mjs`, never in the TS
file.

## Why this page exists

This record documents PR 104 on its own terms — a deliberate, narrow,
temporary fix shipped ahead of a larger structural one, in the same spirit
as the project's other "fix the symptom now, fix the cause next" cycles.
If you're reading `.claude/skills/self-assessment/SKILL.md` today looking
for the grammar block referenced here, you won't find it: it did its job
for one release cycle and was deleted once `rankedNextActions` made it
unnecessary. See `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`
for the full before/after architecture and the regression test
(`scripts/__tests__/rank-next-actions.test.mjs`) that pins the specific
`loopCommandUses=14` case so it can't recur.
