---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: document the `satisfiedWhen` DSL grammar in SKILL.md (tactical fix, PR #104)

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` already being `14`. The action's
`satisfiedWhen` predicate, `loopCommandUses>=1`, should have filtered it out.

Root cause: at the time, `.claude/skills/self-assessment/SKILL.md` instructed
the model to "first filter, then rank" the rubric's next-actions itself, but
the canonical evaluator (`evaluatePredicate`) lived only in
`app/lib/assessment.ts` — TS-only, Next.js-coupled, with no Node-side caller
the skill could invoke. The model running the skill had to hand-roll the
filter, and it assumed `satisfiedWhen` was an object shape
(`{field, op, value}`) rather than the actual string DSL. That guess silently
no-op'd on every predicate: nothing ever got filtered, so an
already-satisfied action surfaced as a live TODO.

## What PR #104 did

PR #104 is the deliberately narrow, tactical first half of a two-PR fix
(design: `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`). It
touches one file — `.claude/skills/self-assessment/SKILL.md` — and adds
nothing but documentation: a grammar block spelling out the `satisfiedWhen`
DSL string syntax so a model reading the skill evaluates predicates by hand
correctly instead of reinventing them:

- `path` — truthy; `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block points at the canonical implementation
(`app/lib/assessment.ts:evaluatePredicate`) and worked the exact regression
case as an example: `loopCommandUses>=1` against `signalsSummary.loopCommandUses
= 14` evaluates to `true`, so the action must be filtered out, not surfaced.

This PR is explicitly a stopgap. It doesn't fix the structural problem — a
model still has to *correctly execute* a spec by hand, which is fragile in
exactly the way the original bug proved. The structural fix (PR 2 in the same
design) extracts `evaluatePredicate` into a Node-shareable
`scripts/predicate.mjs`, pre-computes the filtered, ranked top-N list once in
`run-assessment.mjs`, and writes it to `assessment.json.rankedNextActions`.
Once that field exists, the SKILL.md grammar block PR #104 added becomes
obsolete and gets deleted — the skill's job shrinks to reading
`rankedNextActions[0..2]` verbatim rather than filtering or ranking anything
itself.

## Where things stand now

That structural PR has since landed. The current
`.claude/skills/self-assessment/SKILL.md` no longer carries the grammar
block PR #104 added — it reads:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

and `CLAUDE.md`'s hard rules now state the DSL evaluator has one source:
`scripts/predicate.mjs` is canonical, `app/lib/assessment.ts:evaluatePredicate`
is a 1-line passthrough re-export enforced by
`app/lib/__tests__/predicate-passthrough.test.ts`, and the
self-assessment skill "must NEVER hand-implement the satisfiedWhen filter or
the weight×deficit ranking."

This page exists as the historical record for why that rule exists: the
grammar-documentation approach in PR #104 was a real fix, but only a partial
one — it reduced the chance of a model misreading the DSL, without
eliminating the possibility. The generalizable lesson, now encoded as a hard
rule in `CLAUDE.md`, is to move logic a model would otherwise have to
re-execute correctly by hand into a single pre-computed, canonical data
field instead.

## Sources

- PR #104: `.claude/skills/self-assessment/SKILL.md` grammar block (superseded)
- Design: `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`
- Current state: `.claude/skills/self-assessment/SKILL.md`, `CLAUDE.md` § Hard rules
