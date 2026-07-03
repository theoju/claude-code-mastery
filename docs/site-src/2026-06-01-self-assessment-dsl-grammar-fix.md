---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Fixing the `/self-assessment` DSL grammar gap (PR #104)

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m
/babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` already being `14`. The action's
`satisfiedWhen` predicate, `loopCommandUses>=1`, should have filtered it
out.

## Root cause

`satisfiedWhen` isn't an object shape like `{field, op, value}` — it's a
string DSL, e.g. `"loopCommandUses>=1"`. At the time, the skill's
instructions told the model to "first filter, then rank" `nextActions`
itself, but the canonical evaluator, `evaluatePredicate`, lived only in
`app/lib/assessment.ts` — a TS file with no Node-side caller the skill
could invoke. Left to hand-write the filter, the model running the skill
assumed the object shape, and every string predicate silently evaluated to
nothing. No filtering happened at all, so an already-satisfied action
surfaced as a top-3 priority.

## PR 104 — the tactical fix

PR 104 is the first of a two-PR series and touches one file:
`.claude/skills/self-assessment/SKILL.md`. It's additive-only — no code
changes, no tests (pure documentation) — and inserts a grammar block
beneath the skill's "Top 3 priority actions" bullet, spelling out all
seven `satisfiedWhen` operator classes a model needs to evaluate a
predicate by hand:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings
  `"0"` and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block points at the canonical implementation,
`app/lib/assessment.ts:evaluatePredicate`, and works the triggering bug as
a worked example: `loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` evaluates to **true**, so the action
should be filtered out rather than surfaced as a TODO.

PR 104 shipped alongside a design spec and implementation plan for the
follow-up structural fix, so the second PR had its blueprint ready before
work started.

## Why this was only a stopgap

Documenting the grammar reduces the odds of a model re-deriving the wrong
shape, but it doesn't eliminate the bug class: the skill still asks a
model to evaluate a string DSL by hand, on every invocation, with no
enforcement. The structural fix — tracked as the predicate-ranker
redesign — extracts `evaluatePredicate` into a Node-shareable
`scripts/predicate.mjs`, pre-computes the filtered-and-ranked top-N list
once inside the assessment run, and writes it to
`assessment.json.rankedNextActions`. Once that field exists, the skill
becomes a trivial reader instead of an evaluator, and the PR 104 grammar
block is deleted as obsolete.

That structural fix has since landed. `scripts/predicate.mjs` is now the
one canonical DSL evaluator in the repo, and
`app/lib/assessment.ts:evaluatePredicate` is a one-line passthrough
re-export enforced by a reference-equality test
(`app/lib/__tests__/predicate-passthrough.test.ts`). The ranked list is
produced by `scripts/rank-next-actions.mjs` and read straight out of
`assessment.json.rankedNextActions` — the current
`.claude/skills/self-assessment/SKILL.md` instructs the model to do
exactly that:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

The grammar block PR 104 added is gone from the skill file today. It's
documented here because it's the record of the tactical half of the fix —
and because "a model hand-implements a DSL the rubric already encodes as
data" is a failure mode worth recognizing early if it recurs elsewhere in
the rubric-consuming surfaces (see the "Ranked next-actions live in
`assessment.json.rankedNextActions`" hard rule in this repo's `CLAUDE.md`).

## Takeaway

When a skill or agent needs to evaluate rubric predicates, it should read
a pre-computed result, not re-implement the evaluator. If pre-computation
isn't available yet, documenting the grammar inline (as PR 104 did) is an
honest stopgap — but treat it as temporary, and delete it the moment the
structural fix lands.
