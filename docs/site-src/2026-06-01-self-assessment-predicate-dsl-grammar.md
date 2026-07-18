---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar: one canonical string-form evaluator

## Context

`app/data/rubric.json` next-actions carry a `satisfiedWhen` field — a
predicate that decides whether a next-action is already done and should
be dropped from the priority list. The predicate is a **string**, e.g.
`loopCommandUses>=1`, evaluated against `signalsSummary`.

On 2026-05-31, a live `/self-assessment` run reported `Start with one
loop: /loop 30m /babysit` as a top-3 priority even though
`signalsSummary.loopCommandUses` was `14` — the predicate
`loopCommandUses>=1` should have evaluated `true` and filtered the action
out. Root cause: the skill's instructions told the model to "first
filter, then rank" the next-actions itself, but the canonical evaluator
(`evaluatePredicate`) lived only in `app/lib/assessment.ts`, a
Next.js-coupled TS module with no Node-side caller the skill could reach.
The model running the skill hand-wrote its own filter, assumed an
object-shaped predicate (`{field, op, value}`), and silently returned
`null` for every string predicate in the rubric — so nothing was ever
filtered, and already-satisfied actions surfaced as todos.

## Decision

Fix in two stages, tactical then structural.

**Tactical (PR #104):** document the DSL grammar directly in
`.claude/skills/self-assessment/SKILL.md` so a model reading the skill
evaluates predicates by hand correctly instead of guessing a shape. The
grammar, as shipped:

- `path` — truthy (non-null, non-zero, non-empty-string; the strings
  `"0"` and `"false"` are also treated as falsy)
- `!path` — falsy
- `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
- `path=v` or `path=v|w|x` — equals (or equals one of)
- `path!=v` — not equals
- `path~regex` — array-of-strings element matches regex (case-insensitive)
- `A & B` — AND of two or more atoms

This was additive-only and shipped with no new tests — pure documentation,
stopgap until the structural fix landed.

**Structural (follow-up):** extract `evaluatePredicate` out of
`app/lib/assessment.ts` into a dependency-free `scripts/predicate.mjs`,
make that the one canonical implementation, and have
`scripts/run-assessment.mjs` pre-compute the filtered + `weight × deficit`
ranked top-10 once, writing it to `assessment.json.rankedNextActions`.
`app/lib/assessment.ts:evaluatePredicate` becomes a 1-line passthrough
re-export — the dashboard still evaluates predicates fresh at request
time for per-action ✓/✗ marks on `/methodology/probes` and
`/dimensions/[id]`, but the skill no longer evaluates anything itself.
As of this writing, `SKILL.md` reads:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

The tactical grammar block that PR #104 added to `SKILL.md` was deleted
once this landed — it's obsolete now that the skill doesn't hand-roll
filtering at all.

## Why not just fix the one bug report?

The `loopCommandUses>=1` case is a symptom of a structural problem: **any**
"model reads a spec and re-implements the logic" surface eventually
re-implements it wrong, silently, with no test coverage. Documenting the
grammar (PR #104) stops the immediate bleeding but doesn't stop
recurrence — a differently-worded skill invocation could still get the
shape wrong next time. Moving the evaluator to a shared, tested,
Node-callable module and precomputing the answer once removes the
re-implementation surface entirely. `scripts/predicate.mjs` is now the
single source of truth for the DSL; `app/lib/assessment.ts` is not
allowed to duplicate it (enforced by
`app/lib/__tests__/predicate-passthrough.test.ts`, which asserts
reference equality between the TS re-export and the MJS source — a copy
fails CI).

## Consequences

- `scripts/predicate.mjs` is canonical. When the DSL grammar changes, edit
  that file (and the `$schema` comment in `app/data/rubric.json`) — never
  `app/lib/assessment.ts`.
- The skill (`.claude/skills/self-assessment/SKILL.md`) must never
  hand-implement the `satisfiedWhen` filter or the ranking again. It reads
  the pre-computed top-10 from `assessment.json.rankedNextActions`.
  Surfacing an already-satisfied action as a todo is a regression in the
  data layer (`scripts/run-assessment.mjs` / `scripts/rank-next-actions.mjs`),
  not something to patch in the skill's prose.
- The dashboard's live-render paths (`/methodology/probes`,
  `/dimensions/[id]`) were explicitly out of scope for this change — they
  keep evaluating predicates fresh, since they need per-action ✓/✗ state
  at request time rather than a precomputed ranked list.
