---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: document the `satisfiedWhen` DSL grammar inline in SKILL.md

**Date:** 2026-06-01
**PR:** [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)
**Status:** Superseded — see [Later, superseded](#later-superseded) below.

## The bug

On 2026-05-31, a model running the `/self-assessment` skill reported
`Start with one loop: /loop 30m /babysit` as a top-3 priority action —
despite `signalsSummary.loopCommandUses` being `14`. The rubric's
`satisfiedWhen` for that action is `loopCommandUses>=1`, which is
unambiguously satisfied at `14`. The action should have been filtered out
before ranking.

Root cause: `SKILL.md` instructed the model to "first filter, then rank"
the rubric's next-actions against `satisfiedWhen`, but never told it what
shape `satisfiedWhen` actually is. The model assumed an object —
`{field, op, value}` — and hand-wrote a filter for that shape. The real
`satisfiedWhen` is a compact string DSL (`"loopCommandUses>=1"`), evaluated
by `evaluatePredicate` in `app/lib/assessment.ts`. Against an object-shaped
filter, every string predicate silently evaluated to `null`, no filtering
happened, and an already-satisfied action surfaced as a TODO.

## The fix

PR #104 added a 12-line grammar block to
`.claude/skills/self-assessment/SKILL.md`, directly beneath the "Top 3
priority actions" instruction, documenting all seven operator classes of
the DSL:

- `path` — truthy (non-null, non-zero, non-empty-string; `"0"` and
  `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block points at the canonical implementation
(`app/lib/assessment.ts:evaluatePredicate`) and gives the exact worked
example from the bug: `loopCommandUses>=1` against
`signalsSummary.loopCommandUses=14` evaluates to **true**, so the action is
filtered out and must not be surfaced as a TODO.

This was explicitly a **tactical** fix — additive documentation only, no
code changes, no tests (there's nothing to test in a markdown block). It
ships alongside a design spec and implementation plan
(`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`) for a
structural fix that removes the underlying failure mode instead of
documenting around it.

## Why not fix it structurally in the same PR

The DSL evaluator (`evaluatePredicate`) lived only in
`app/lib/assessment.ts` — a TypeScript file, Next.js-coupled by location —
with no Node-ESM-importable counterpart. The `/self-assessment` skill runs
as a model reading instructions, not as code that can `import` the TS
evaluator, so the only way to get correct filtering into the skill's
existing "read the rubric, filter, rank" flow was to teach the model the
grammar well enough to hand-evaluate it correctly. That's what PR #104
does — a stopgap, not a real fix, because "a careful model evaluates a
string DSL correctly every time" is not a durable guarantee.

## Later, superseded

The structural fix landed as planned: `scripts/predicate.mjs` now holds
the canonical DSL evaluator as pure ESM, `app/lib/assessment.ts`'s
`evaluatePredicate` re-exports it as a one-line passthrough (asserted
reference-equal by `app/lib/__tests__/predicate-passthrough.test.ts`), and
`scripts/rank-next-actions.mjs` pre-computes the filtered, ranked top-10
list into `assessment.json.rankedNextActions` at `npm run assess` time.
`SKILL.md` now reads:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

The grammar block this PR added has been deleted from `SKILL.md`: the
skill no longer evaluates the DSL itself, so there's nothing left for a
model to misread. CLAUDE.md's Hard rules now carry two rules that make
this permanent:

- *"DSL evaluator has one source."* `scripts/predicate.mjs` is canonical;
  the TS re-export must stay a passthrough, enforced by the reference-
  equality test.
- *"Ranked next-actions live in `assessment.json.rankedNextActions`."* The
  self-assessment skill must never hand-implement the `satisfiedWhen`
  filter or the weight×deficit ranking again.

This page is kept as the historical record of the tactical stopgap and the
bug it was written to prevent — not as a description of the DSL's current
production shape. For that, read `scripts/predicate.mjs` and the two
CLAUDE.md hard rules above directly; they are the source of truth now.
