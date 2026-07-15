---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: architecture
---

# The `satisfiedWhen` DSL grammar

Every next-action in `app/data/rubric.json` can carry a `satisfiedWhen` string —
a small predicate evaluated against `signalsSummary` that decides whether the
action should still be surfaced as a TODO. If the predicate is true, the user
has already satisfied the action and it gets dropped rather than nagging them
for something they've already done.

## The bug this page exists to prevent

`/self-assessment` once reported `Start with one loop: /loop 30m /babysit` as
a top-3 priority action despite `signalsSummary.loopCommandUses` being `14` —
comfortably satisfying the action's own predicate, `loopCommandUses>=1`. The
root cause wasn't a scoring bug; it was a re-implementation bug. The skill's
instructions told the model to "first filter, then rank" the next-actions
list by hand, but the canonical DSL evaluator lived only in
`app/lib/assessment.ts` (TS-only, `evaluatePredicate`), with no Node-side
caller reachable from the skill's shell-out to `npm run assess`. The model
running the skill hand-wrote its own filter, assumed an object shape for
`satisfiedWhen`, and silently skipped string predicates entirely — so a
clearly-satisfied action kept surfacing.

## Grammar

`satisfiedWhen` predicates are evaluated against the flat `signalsSummary`
object (dotted paths for nesting). Eight forms are supported:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; the strings `"0"` and `"false"` are also treated as falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` | equals |
| `path=v\|w\|x` | equals one of (pipe-separated alternation) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings LHS; true if any element matches `regex` (case-insensitive) |
| `A & B` | AND of two or more atoms |

A missing signal field reads as `0`/`false` (conservative — the action stays
surfaced rather than being silently hidden), and a parse error or unknown
operator also evaluates to `false` for the same reason.

Worked example: `loopCommandUses>=1` against `signalsSummary.loopCommandUses
= 14` evaluates to **true** — the action is satisfied and must be filtered
out, not surfaced as a TODO.

## Where this actually lives now

This page documents the grammar for readers; it is not itself the source of
truth. The canonical evaluator is **`scripts/predicate.mjs`** — a pure-ESM
port with no external dependencies, callable from both `scripts/*.mjs` and
(via a one-line passthrough re-export) `app/lib/assessment.ts`. A dedicated
equivalence test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts
the TS export is reference-equal to the MJS implementation, so a future
contributor who copies the logic instead of re-exporting it fails CI. When
the grammar itself changes, the edit belongs in `scripts/predicate.mjs` and
the rubric's `$schema` comment — never in the TS file, and not in this page
either.

The fix that made this page's grammar block obsolete as a *runtime*
authority landed in two stages:

1. **Tactical stopgap (PR #104).** Added this grammar as a literal block
   inside `.claude/skills/self-assessment/SKILL.md`, so a careful model
   reading the skill had a correct reference to evaluate predicates by hand
   against. No code changed — pure documentation, and known at the time to
   be an imperfect fix: a model can still misread a spec, which is exactly
   the failure mode that caused the bug in the first place.
2. **Structural fix (follow-up PR, tracked as the predicate-ranker work).**
   Extracted `evaluatePredicate` out of `app/lib/assessment.ts` into
   `scripts/predicate.mjs`, then had `scripts/run-assessment.mjs`
   pre-compute the filtered-and-ranked next-actions list once per run and
   write it to `assessment.json.rankedNextActions` (top 10, sorted by
   `weight × deficit`, with deterministic axis/weight/dimId/actionId
   tie-breaking). The skill was rewritten to be a trivial reader of that
   field — `rankedNextActions[0..2]` — instead of an evaluator, and the
   grammar block this PR added to `SKILL.md` was deleted as obsolete once
   the field existed.

If you're reading `.claude/skills/self-assessment/SKILL.md` today, you'll
find the tactical grammar block already gone: the skill just points at
`assessment.json.rankedNextActions`. This is expected — the structural fix
described above has landed, and per `CLAUDE.md`'s hard rule, the skill "must
NEVER hand-implement the satisfiedWhen filter or the weight×deficit ranking"
again. This page is kept as a reference for the grammar itself and as the
paper trail for why the ranking logic lives where it does.

## Why the structural fix, not just better docs

The tactical PR was deliberately scoped as a stopgap, not a fix: documenting
a grammar reduces the odds of a model misreading it, but it doesn't remove
the possibility. The structural fix removes the re-implementation
opportunity altogether — there is no filter left for the skill to get
wrong, because the skill no longer filters. This is the same shape as the
project's other "move logic out of ad-hoc model reasoning and into a single
deterministic evaluator" fixes (see `CLAUDE.md`'s "Ranked next-actions live
in `assessment.json.rankedNextActions`" hard rule): once a bug class is
identified as "the model re-derives something the codebase already computes
correctly," the fix is to stop asking the model to re-derive it.
