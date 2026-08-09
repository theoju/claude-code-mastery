---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar fix

On 2026-05-31, a model running the `/self-assessment` skill reported
`Start with one loop: /loop 30m /babysit` as a top-3 priority action —
despite `signalsSummary.loopCommandUses` already sitting at 14. The
action's `satisfiedWhen` predicate, `loopCommandUses>=1`, should have
filtered it out.

## Root cause

`satisfiedWhen` in `app/data/rubric.json` is a **string DSL**
(`"loopCommandUses>=1"`), not an object shape. At the time, the skill's
instructions told the model to "first filter, then rank" the rubric's
`nextActions` itself, with no pre-computed filtered list to read. The
canonical evaluator (`evaluatePredicate`) lived only in
`app/lib/assessment.ts` — TS-only, Next.js-coupled by location, with no
Node-side caller. Because the skill runs in a plain shell/script context,
the model had nothing to call and hand-wrote its own filter. It assumed
predicates were shaped like `{field, op, value}`, so every string
predicate silently evaluated to `null`, no filtering happened, and an
already-satisfied action surfaced as a TODO.

## The fix, in two PRs

The fix shipped as two PRs rather than one, on purpose — a fast tactical
stopgap followed by a structural fix that removes the class of bug
entirely.

**PR #104 (tactical).** Added a 12-line grammar block directly into
`.claude/skills/self-assessment/SKILL.md`, spelling out the eight atom
forms of the DSL (`path`, `!path`, `path>=N`/`<=N`/`>N`/`<N`,
`path=v`/`path=v|w|x`, `path!=v`, `path~regex`, and `A & B` conjunction)
so a careful model reading the skill file could evaluate predicates
correctly by hand. It also filed the spec and plan for the structural
follow-up. This PR changed no code — it bought correctness by
documentation alone, as a stopgap until the real fix landed.

**PR 2 (structural, since landed).** Extracted the evaluator out of
`app/lib/assessment.ts` into a dependency-free `scripts/predicate.mjs`,
importable from both the Next.js app and plain Node scripts. Introduced
`scripts/rank-next-actions.mjs`, which now filters out any action whose
`satisfiedWhen` predicate evaluates true and ranks the rest by
`weight × deficit`, with a deterministic tie-break (rank → axis →
weight → `dimId` → `actionId`). `scripts/run-assessment.mjs` calls this
once per run and writes the result to
`assessment.json.rankedNextActions` (capped at 10 entries). The skill no
longer filters or ranks anything itself — it reads
`rankedNextActions[0..2]` verbatim. The PR #104 grammar block was
deleted from `SKILL.md` at this point, since there was no longer any
reason for a model to hand-evaluate the DSL.

`app/lib/assessment.ts` now re-exports `evaluatePredicate` from
`scripts/predicate.mjs` as a one-line passthrough rather than
duplicating the implementation — enforced by a reference-equality test,
`app/lib/__tests__/predicate-passthrough.test.ts`. If you're extending
the DSL grammar, the only file to edit is `scripts/predicate.mjs` (plus
the `$schema` comment in `app/data/rubric.json`); `assessment.ts` should
never gain its own copy again.

## Current state

As of today, the skill file (`.claude/skills/self-assessment/SKILL.md`)
carries no DSL grammar at all — it just points the model at
`assessment.json.rankedNextActions[0..2]`, already filtered and ranked.
That's the intended end state described in the PR #104 spec: the
tactical grammar block was explicitly scoped as a stopgap, "deleted in
PR 2 once the field exists."

## Why this is worth remembering

The bug class here isn't "the model made a mistake" — it's "the model
had no machine-checkable way to do the right thing, so it improvised a
wrong one." The durable fix wasn't better instructions; it was removing
the need for the model to re-implement DSL evaluation at all. Read the
grammar block in PR #104's diff as a snapshot of *why* the interim
instructions existed, not as a spec to maintain going forward — the
canonical grammar lives in the `scripts/predicate.mjs` header comment
now.
