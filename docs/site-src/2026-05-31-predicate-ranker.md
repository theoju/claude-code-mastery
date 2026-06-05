---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate evaluator and ranked next-actions (PR 104)

PR 104 is a two-part fix for a recurring bug where the model running
`/self-assessment` surfaced already-satisfied next-actions as top priorities.
Part 1 (this PR) is a tactical documentation patch. Part 2 — extracting the
evaluator to `scripts/predicate.mjs` and pre-computing
`assessment.json.rankedNextActions` — lands in a follow-up PR and supersedes
the grammar block added here.

## The bug

On 2026-05-31, `/self-assessment` reported:

> _Start with one loop: /loop 30m /babysit_

as a top-3 priority despite `signalsSummary.loopCommandUses = 14` — a value
that satisfies the action's `satisfiedWhen` predicate (`loopCommandUses>=1`) by
a factor of 14.

Root cause: the rubric encodes `satisfiedWhen` as a **string DSL**
(e.g. `"loopCommandUses>=1"`), but the model hand-wrote a filter that expected
an object shape (`{field, op, value}`). The evaluator returned `null` for every
string predicate, bypassed the filter entirely, and passed all next-actions —
including satisfied ones — to the ranker.

## `satisfiedWhen` DSL grammar

Every `satisfiedWhen` field in `app/data/rubric.json` is one of these seven
forms. The canonical evaluator lives at `app/lib/assessment.ts:evaluatePredicate`.

| Form | Meaning |
| ---- | ------- |
| `path` | truthy — non-null, non-zero, non-empty-string; `"0"` and `"false"` are also falsy |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison against `signalsSummary[path]` |
| `path=v` or `path=v\|w\|x` | equals (or equals one of) |
| `path!=v` | not equals |
| `path~regex` | at least one element of an array-of-strings matches the regex (case-insensitive) |
| `A & B` | AND of two or more atoms from the forms above |

Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses = 14` evaluates
to **true**, so the action is satisfied and must be filtered out before ranking.
A `null` or `undefined` value on the left-hand side evaluates to **false**.

## PR 1 — tactical fix (SKILL.md documentation)

PR 104 inserts the grammar table above as a sub-block inside
`.claude/skills/self-assessment/SKILL.md`, directly beneath the
`Top 3 priority actions` bullet. The edit is additive only — no code changes,
no test changes. A careful model reading the skill now has the operator set and
a worked example before it attempts to filter.

This is a stopgap. The grammar block is marked for deletion once PR 2 ships and
the skill can read `assessment.json.rankedNextActions` directly.

## PR 2 — structural fix (coming in follow-up)

The structural fix eliminates the "model re-implements the DSL" failure class
by moving evaluation and ranking out of the model's hands entirely:

1. **`scripts/predicate.mjs`** — a pure-ESM port of `evaluatePredicate` from
   `app/lib/assessment.ts`, importable from Node without Next.js.
2. **`scripts/rank-next-actions.mjs`** — filters unsatisfied next-actions and
   sorts by `weight × deficit`, writing the top-N list once per run.
3. **`assessment.json.rankedNextActions`** — a new top-level field written by
   `run-assessment.mjs`. The `/self-assessment` skill reads this pre-computed
   list; it never touches the DSL directly.
4. **`app/lib/assessment.ts`** becomes a 1-line re-export of the canonical
   evaluator (type-safe passthrough; dashboard render paths are unchanged).

The existing `assessment.json` fields are not modified. No probe counts change.
The dashboard's `/methodology/probes` and `/dimensions/[id]` pages continue to
evaluate predicates at request time for per-action ✓/✗ marks — the new field
serves the skill, Slack post, and console printer only.

## Design spec

Full architecture diagram, file table, testing plan, and DSL grammar reference:
[`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)
