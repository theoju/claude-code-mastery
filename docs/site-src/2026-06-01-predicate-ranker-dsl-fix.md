---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Fixing the `satisfiedWhen` DSL mismatch in `/self-assessment`

On 2026-05-31, a model running the `/self-assessment` skill reported
`Start with one loop: /loop 30m /babysit` as a top-3 priority action —
despite `signalsSummary.loopCommandUses` being `14`, well past the
action's own `satisfiedWhen` threshold of `loopCommandUses>=1`. An
already-satisfied action surfaced as a TODO.

## Root cause

`app/data/rubric.json` encodes `satisfiedWhen` as a **string DSL**
(`"loopCommandUses>=1"`), not the `{field, op, value}` object shape a
model might reasonably assume. At the time, the canonical evaluator —
`evaluatePredicate` — lived only in `app/lib/assessment.ts`, a
TS file coupled to the Next.js app with no Node-side caller. The skill's
instructions told the model to "first filter, then rank" the rubric's
next-actions itself, but gave it nothing to read the grammar from. The
model hand-wrote a filter assuming the object shape, that filter matched
nothing, and `evaluatePredicate` (as re-implemented) silently returned
`null` for every predicate — which disabled filtering across the board,
not just for the `/loop` action.

This is the failure mode the project's CCE-110 grounding discipline
exists to catch: a model re-implementing logic instead of reading it from
its one canonical source.

## The fix: two PRs, not one

The design (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`)
split the fix deliberately rather than shipping a single large PR:

**PR 1 (#104, tactical, documentation-only).** Inserted a grammar block
into `.claude/skills/self-assessment/SKILL.md` directly under the
existing "Top 3 priority actions" bullet, spelling out all eight
`satisfiedWhen` atom forms (bare `path` truthy check, `!path`, the four
numeric comparators, `=`/`=v|w|x` equality-or-alternation, `!=`, and
`~regex` array match) plus the `A & B` AND combinator. It pointed at
`app/lib/assessment.ts:evaluatePredicate` as canonical and worked the
`loopCommandUses>=1` / `loopCommandUses=14` example explicitly so a
careful model reading the skill would get it right. No code changed;
this PR bought correctness without touching the evaluator.

**PR 2 (structural, superseding PR 1).** Extracted `evaluatePredicate`
and its helpers (`readPath`, `isTruthy`, `evaluateAtomic`) out of
`app/lib/assessment.ts` into a pure-ESM `scripts/predicate.mjs`, importable
from both `run-assessment.mjs` and the TS app. `app/lib/assessment.ts`
now re-exports it as a one-line passthrough rather than owning an
implementation — enforced by a reference-equality test
(`app/lib/__tests__/predicate-passthrough.test.ts`) so a future
contributor who copies instead of re-exporting fails CI. `run-assessment.mjs`
gained `rank-next-actions.mjs`, which pre-computes the filtered
(satisfied actions dropped) and `weight × deficit`-ranked top-10 list once,
at score time, and writes it to `assessment.json.rankedNextActions`. Once
that field existed, PR 2 deleted the PR 1 grammar block from `SKILL.md` as
obsolete: the skill no longer filters or ranks anything itself. Confirmed
against the current `.claude/skills/self-assessment/SKILL.md`, the "Top 3
priority actions" bullet now reads

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

with no DSL grammar text left in the file — the model is a reader of a
precomputed field, not an implementer of the filter.

## Why not skip PR 1 and go straight to PR 2

PR 2 is the real fix, but it's the larger change (new module, new tests,
a CLAUDE.md hard rule, a passthrough contract). PR 1 closed the immediate
correctness gap in under the time it takes to write the extraction
correctly, so the bug stopped recurring in production runs of
`/self-assessment` before the structural work landed. The tradeoff: PR 1's
grammar block was known-temporary from the start — the design doc calls
it out explicitly as "stopgap until PR 2 lands" — so it was written as
disposable documentation, not as a second source of truth to maintain
indefinitely.

## The standing rule this produced

`CLAUDE.md`'s Hard Rules now state it plainly: **the DSL evaluator has one
source.** `scripts/predicate.mjs` is canonical; `app/lib/assessment.ts`
must remain a 1-line passthrough re-export; the DSL grammar itself is
edited in `scripts/predicate.mjs` and the rubric's `$schema` comment,
never anywhere else. Any future skill or agent that needs to filter or
rank rubric next-actions reads `assessment.json.rankedNextActions` —
it does not re-implement the filter, and it does not need to know the
grammar at all.

## Related

- `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md` — full design,
  including the `rankNextActions` algorithm, tie-breaking rule, and error-handling
  table for malformed predicates.
- `scripts/predicate.mjs` — canonical evaluator.
- `scripts/rank-next-actions.mjs` — filter + rank, called from `run-assessment.mjs`.
- `.claude/skills/self-assessment/SKILL.md` — current (post-fix) skill instructions.
