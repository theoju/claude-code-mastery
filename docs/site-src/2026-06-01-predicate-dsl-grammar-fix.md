---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar fix (tactical)

`/self-assessment` once reported `Start with one loop: /loop 30m /babysit`
as a top-3 priority action even though `signalsSummary.loopCommandUses`
was `14` — well past the action's own `satisfiedWhen` threshold of
`loopCommandUses>=1`. An already-satisfied action surfaced as a TODO.

## Root cause

The model running the skill re-implemented the next-action filter by
hand instead of using the canonical evaluator, and assumed
`satisfiedWhen` was an object it could pattern-match against. It's
actually a **string DSL** — evaluated by `evaluatePredicate` — so the
ad-hoc filter silently returned `null`/false for every predicate. With
the filter defeated, nothing got dropped, and an already-satisfied
action ranked into the top 3 alongside genuine gaps.

## The fix (PR #104)

PR #104 is the tactical half of a two-PR sequence. It inserted a
12-line DSL grammar block directly into
`.claude/skills/self-assessment/SKILL.md`, documenting all seven
`satisfiedWhen` operator classes so a model reading the skill has the
grammar in front of it instead of guessing the shape:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings
  `"0"` and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

The PR shipped alongside the design spec and implementation plan for
the follow-up structural fix rather than as a bare doc patch, so the
stopgap and its planned expiry date landed together.

## Why a stopgap, not the real fix

Documenting the grammar closes the immediate gap, but it doesn't stop a
future model from hand-rolling a filter again. The structural fix —
extracting the evaluator out of the Next.js-coupled `app/lib/assessment.ts`
into a Node-shareable module, then pre-computing the filtered, ranked
next-actions list once at scoring time — was scoped as a separate PR
from the start. That follow-up has since landed: the canonical evaluator
now lives in `scripts/predicate.mjs`, `run-assessment.mjs` writes a
pre-ranked `assessment.json.rankedNextActions` array, and the SKILL.md
grammar block this PR added was deleted as obsolete once the skill could
just read `rankedNextActions[0..2]` verbatim instead of evaluating
anything itself. `SKILL.md` today reflects that end state directly: the
`## What to do` section instructs reading `assessment.json.rankedNextActions[0..2]`
— "already filtered (satisfied actions dropped) and ranked by
`weight × deficit`" — with no re-implementation of the DSL in sight.

CLAUDE.md now carries the durable rule this sequence produced: **the DSL
evaluator has one source** (`scripts/predicate.mjs`), the TypeScript side
is a one-line passthrough re-export, and a reference-equality test
enforces it never diverges into a second implementation.

## Where the design lived

The full architecture — both PRs' file lists, the ranking algorithm,
tie-breaking rules, and error handling for malformed predicates — is in
`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`. That spec
frames PR #104 as "PR 1 (Tactical)" and the evaluator extraction as
"PR 2 (Structural)," with PR 2 explicitly responsible for deleting PR
1's grammar block once the underlying field existed — which is exactly
what happened.
