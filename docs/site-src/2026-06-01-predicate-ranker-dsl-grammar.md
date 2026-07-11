---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: document the `satisfiedWhen` DSL grammar directly in SKILL.md

**PR:** [#104](https://github.com/theoju/claude-code-self-assessment/pull/104)
**Date:** 2026-06-01

## The bug

On 2026-05-31, a `/self-assessment` invocation reported `Start with one loop:
/loop 30m /babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses` sitting at `14`, well past the action's own
`satisfiedWhen: "loopCommandUses>=1"` gate. The action should have been
filtered out as already-satisfied.

Root cause: `.claude/skills/self-assessment/SKILL.md` told the model to
"first filter, then rank" `rubric.json`'s next-actions itself, but never
specified the shape of `satisfiedWhen`. The model running the skill assumed
an object form (`{field, op, value}`) — a reasonable guess, but wrong. The
rubric actually encodes `satisfiedWhen` as a compact string DSL
(`"loopCommandUses>=1"`), evaluated by `app/lib/assessment.ts:evaluatePredicate`.
Every hand-rolled filter attempt against the string form returned `null`,
so nothing was filtered and the already-satisfied action surfaced as a
"TODO."

## The decision

This PR is the first of two. Rather than wait for a full structural fix, it
closes the bug class immediately by pasting the canonical grammar straight
into `SKILL.md`, beneath the existing "Top 3 priority actions" bullet:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings `"0"`
  and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of several alternatives)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The block cites `app/lib/assessment.ts:evaluatePredicate` as the canonical
implementation and walks through the triggering example directly:
`loopCommandUses>=1` against `signalsSummary.loopCommandUses=14` evaluates to
**true**, so the action must be dropped rather than surfaced.

This PR is documentation-only — one file, `.claude/skills/self-assessment/SKILL.md`,
additive. It ships alongside a design spec and plan for the real fix.

## Why a stopgap instead of the real fix

The actual defect isn't the missing grammar doc — it's that the skill asks a
model to re-implement a DSL evaluator by hand at all. The canonical
`evaluatePredicate` already exists, but only in `app/lib/assessment.ts`
(TypeScript, Next.js-coupled by location), with no Node-side caller a skill
script could invoke directly. Fixing that properly means extracting the
evaluator into a dependency-free `scripts/predicate.mjs` and pre-computing a
filtered, ranked `assessment.json.rankedNextActions` field once inside
`run-assessment.mjs` — so the skill becomes a trivial reader instead of an
implementer.

That's real surgery across `app/lib/assessment.ts`, `scripts/run-assessment.mjs`,
and the rubric's `$schema` comment, plus a battery of operator-coverage tests
and a named regression test for this exact bug
(`loopCommandUses=14` must exclude a `>=1` predicate). It's scoped as its own
PR rather than bundled here, so this PR's job is narrower: stop the bleeding
today with a grammar block a careful model can follow correctly, and buy time
for the structural fix to land.

## What superseded it

The structural PR (tracked as **CCE-79's** sibling ticket for the predicate
ranker, shipped as PR 2 in this sequence) extracted the evaluator to
`scripts/predicate.mjs`, wired it into `run-assessment.mjs` via
`rankNextActions()`, and wrote the result to
`assessment.json.rankedNextActions`. Once that field existed, the DSL
grammar block this PR added was deleted from `SKILL.md` as obsolete — the
skill now reads `assessment.json.rankedNextActions[0..2]` verbatim instead of
filtering anything itself. If you're reading `SKILL.md` today and don't see
the grammar block described above, that's expected: it did its job as a
stopgap and was retired on schedule.

Two hard rules now guard against regressing either half of this fix (see
`CLAUDE.md`):

- **DSL evaluator has one source** — `scripts/predicate.mjs` is canonical;
  `app/lib/assessment.ts:evaluatePredicate` must stay a 1-line passthrough
  re-export, enforced by a reference-equality test.
- **Ranked next-actions live in `assessment.json.rankedNextActions`** — no
  skill may hand-implement the `satisfiedWhen` filter or the
  weight × deficit ranking again.
