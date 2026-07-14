---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: fix the `/self-assessment` predicate re-implementation bug

**Date:** 2026-06-01
**Trigger:** PR [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop
30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` already at 14, well past the action's own
`satisfiedWhen` threshold of `loopCommandUses>=1`.

Root cause: `.claude/skills/self-assessment/SKILL.md` told the model running
the skill to "first filter, then rank" the rubric's next-actions itself, but
the canonical evaluator for `satisfiedWhen` lived only in
`app/lib/assessment.ts` — TS-only, Next.js-coupled by location, with no
Node-side caller the skill could invoke. Nothing in the skill spelled out the
predicate's actual shape. The model hand-wrote a filter that expected an
object (`{field, op, value}`), while the rubric encodes `satisfiedWhen` as a
plain string DSL — `"loopCommandUses>=1"`. The mismatch made every predicate
evaluate to null, so no filtering happened at all, and an already-satisfied
action surfaced as a TODO.

## The DSL, for reference

`satisfiedWhen` strings are evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty; `"0"` / `"false"` also falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation: `scripts/predicate.mjs`.

## The fix, in two PRs

The design spec (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`)
laid out a tactical-then-structural sequence rather than one big change:

1. **Tactical — PR #104.** Insert the DSL grammar table above directly into
   `SKILL.md`, beneath the existing next-actions instructions, so a careful
   model reading the skill has the correct shape in front of it. No runtime
   code changed. Stopgap only — it still relies on the model to evaluate the
   predicates correctly by hand.
2. **Structural — follow-up PR.** Extract the evaluator out of
   `app/lib/assessment.ts` into a Node-shareable `scripts/predicate.mjs`, and
   pre-compute the filtered + ranked next-actions list once, server-side, in
   `scripts/run-assessment.mjs` (`rank-next-actions.mjs`), writing the result
   to `assessment.json.rankedNextActions`. `app/lib/assessment.ts` becomes a
   1-line passthrough re-export of `evaluatePredicate` — never a second
   implementation. The skill's job shrinks to reading
   `rankedNextActions[0..2]` verbatim; the tactical DSL-grammar block added
   in PR #104 is deleted as obsolete once the field exists.

Both stages preserve the same public surface:
`evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean`
keeps its signature throughout, and no existing `assessment.json` field
changes shape — the structural PR only adds `rankedNextActions` as a new
top-level array (capped at 10 entries, sorted by `weight × deficit`, with a
deterministic tie-break: rank → axis (`platform` → `execution` → `either`) →
weight → `dimId` → `actionId`).

## Current state

Both stages have landed. `SKILL.md` now reads:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

The tactical DSL-grammar block from PR #104 is gone from `SKILL.md`, exactly
as the design intended — it was scaffolding for the gap between the bug
report and the structural fix, not a permanent addition. `CLAUDE.md`'s hard
rules now enforce the single-source guarantee going forward:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation. Test
> `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
> reference-equal; a duplicate fails CI.

And separately:

> **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
> self-assessment skill must NEVER hand-implement the satisfiedWhen filter or
> the weight×deficit ranking. Read the pre-computed top-10 from the written
> file. Surfacing a satisfied action as a TODO again is a regression — fix
> the data layer, not the report.

## Why this shape, not a quicker one

The design spec explicitly rejected fixing this by patching the skill's
prose alone. A model re-deriving filter logic from natural-language
instructions is exactly the failure class that produced the bug in the first
place — better prose narrows the odds of a repeat but doesn't close them.
Moving the filter-and-rank step into `run-assessment.mjs`, backed by the same
evaluator the dashboard already trusts, removes the model from the
predicate-evaluation path entirely. The regression test named after this bug
(`loopCommandUses=14` must exclude the `loopCommandUses>=1` action) lives in
`scripts/__tests__/rank-next-actions.test.mjs` and is the permanent guardrail
against recurrence.

## See also

- `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md` — full design spec
- `scripts/predicate.mjs` — canonical `evaluatePredicate`
- `scripts/run-assessment.mjs` — `rankNextActions` computation
- `.claude/skills/self-assessment/SKILL.md` — current (post-fix) skill instructions
