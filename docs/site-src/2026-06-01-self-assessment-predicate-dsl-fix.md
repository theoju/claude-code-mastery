---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Fixing the /self-assessment predicate DSL mismatch

`/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a
top-3 priority action while `signalsSummary.loopCommandUses` was `14` — a
predicate of `loopCommandUses>=1` should have filtered it out. The skill
told the model to "first filter, then rank" `rubric.json`'s next-actions
against `satisfiedWhen`, but the model running the skill hand-wrote a filter
that assumed `satisfiedWhen` was a structured object (`{field, op, value}`).
The rubric's actual predicates are strings — `"loopCommandUses>=1"`,
`"cliBtwUseCountAllTime>=1"`, `"planModeMultiTaskSessionCount>=1 & ..."` — and
the canonical evaluator (`app/lib/assessment.ts:evaluatePredicate`) lived
only on the TypeScript/Next.js side, with no Node-side caller the skill could
invoke. Every predicate silently evaluated to `null`, no filtering happened,
and an already-satisfied action surfaced as a TODO.

## The two-PR fix

The fix shipped in two stages rather than one, because the durable fix
(giving the skill a real evaluator to call) is a bigger structural change
than the bug warranted fixing immediately:

1. **PR #104 (tactical, this page's subject)** — no application code
   changed. It adds a 12-line grammar block to
   `.claude/skills/self-assessment/SKILL.md` documenting all seven
   `satisfiedWhen` operator classes the rubric actually uses, with a pointer
   to the canonical implementation and a worked example
   (`loopCommandUses>=1` against `loopCommandUses=14` → `true` → filter the
   action out). It also lands the design spec and plan for the structural
   follow-up. The intent was a stopgap: give a careful model enough grammar
   to evaluate predicates correctly by hand until a real evaluator exists.
2. **The structural follow-up** — extracts `evaluatePredicate` out of
   `app/lib/assessment.ts` into a pure-ESM `scripts/predicate.mjs`, so
   `scripts/run-assessment.mjs` can pre-compute a filtered, ranked
   `assessment.json.rankedNextActions` list once per run. The skill stops
   evaluating predicates itself entirely — it reads
   `rankedNextActions[0..2]` verbatim. The TypeScript side becomes a
   1-line passthrough re-export, kept reference-equal to the `.mjs`
   original by a dedicated equivalence test, so the DSL never has two
   copies to drift out of sync.

That structural fix has since landed. `SKILL.md` no longer carries the
tactical grammar block PR #104 added — it now instructs: "Read
`assessment.json.rankedNextActions[0..2]` — already filtered (satisfied
actions dropped) and ranked by `weight × deficit` by
`scripts/rank-next-actions.mjs`." The DSL evaluator's single source of
truth is `scripts/predicate.mjs`; `app/lib/assessment.ts:evaluatePredicate`
is a passthrough re-export enforced by
`app/lib/__tests__/predicate-passthrough.test.ts`. This page documents the
tactical step for the historical record — the grammar block it describes no
longer exists in the shipped skill.

## The grammar, for reference

The seven operator classes the rubric's `satisfiedWhen` strings use,
evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | Truthy (non-null, non-zero, non-empty; `"0"`/`"false"` strings are also falsy) |
| `!path` | Falsy |
| `path>=N` / `<=N` / `>N` / `<N` | Numeric comparison |
| `path=v` or `path=v\|w\|x` | Equals (or equals one of) |
| `path!=v` | Not equals |
| `path~regex` | Array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Missing signal fields and unparseable predicates both evaluate to `false`
(conservative: surface the action rather than hide it) — this is the same
error-handling contract the structural rewrite preserved when it moved the
implementation into `scripts/predicate.mjs`.

## Takeaway

The bug class here was a model re-implementing a contract it hadn't verified
— assuming a conventional object shape for `satisfiedWhen` instead of
reading what the rubric actually contains. The tactical fix (PR #104)
bought correctness by documenting the real grammar inline; the durable fix
removed the need for the skill to interpret the DSL at all by pre-computing
the ranked, filtered list server-side. When a skill or agent needs to
consume a data contract, prefer shipping a shared evaluator it can call over
documentation it has to re-implement correctly from memory.
