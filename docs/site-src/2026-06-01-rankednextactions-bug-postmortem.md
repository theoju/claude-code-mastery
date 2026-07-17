---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Postmortem: `rankedNextActions` surfacing already-satisfied actions

## What happened

The `/self-assessment` skill used to hand-roll its own top-priority-actions
logic instead of reading a precomputed list: it re-implemented the
`satisfiedWhen` filter and the weight×deficit ranking inline in
`SKILL.md`. That reimplementation mis-modeled the `satisfiedWhen` DSL as an
object rather than the string grammar it actually is
(`scripts/predicate.mjs` — `path`, `!path`, `path>=N`, `path=v|w`,
`path~regex`, `A & B`). The filter silently no-op'd on the mismatch, and
`babysit-loop` — the tip-48 "start with one loop" next-action, already
satisfied by `loopCommandUses>=1` — surfaced as a top-priority
recommendation for a user who had already adopted it.

This is the structural close-out. A tactical fix landed first in PR #104
(patched the immediate `SKILL.md` bug). This PR, #106, is PR 2 of 2: it
removes the underlying opportunity for the bug class to recur by deleting
the reimplementation entirely, not just correcting it.

## Root cause

The self-assessment model had two pieces of ranking logic to get right —
the DSL evaluator and the weight×deficit sort — and no single canonical,
tested source for either. `app/lib/assessment.ts` had one implementation
(TypeScript, dashboard-side); nothing forced a second consumer (the
skill's inline instructions, read and interpreted per-session by a model)
to match it. A model re-deriving "filter out satisfied actions" from a
natural-language description of the grammar is exactly the failure mode
CLAUDE.md's next line about `rankedNextActions` now names directly:
*"surfacing a satisfied action as a TODO again is a regression — fix the
data layer, not the report."*

## Fix

Two structural changes, both grounded in tests, close the gap so there is
no longer a code path where a model reimplements either the filter or the
ranking:

**1. One canonical DSL evaluator.** `scripts/predicate.mjs` is now the
single implementation of `evaluatePredicate` — a byte-faithful port of
what used to live only in `app/lib/assessment.ts`. The TS file collapses
to a 1-line re-export:

```ts
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };
```

`app/lib/__tests__/predicate-passthrough.test.ts` pins this with a
reference-identity assertion (`expect(fromTs).toBe(fromMjs)`) rather than
a behavioral comparison — a passthrough that quietly forked back into two
implementations would still pass a value-equality test on today's inputs
but fail this one immediately.

**2. Ranking moved out of the skill and into a tested module.**
`scripts/rank-next-actions.mjs` exports `rankNextActions(rubric,
scoreMap, signalsSummary, limit = 10)`. It walks every dimension's
`nextActions`, drops any action whose `satisfiedWhen` evaluates true
against `signalsSummary` via the canonical evaluator, computes
`rank = weight × deficit` (deficit taken from the platform or execution
score depending on the action's axis), and sorts with a fully
deterministic tie-break: `rank desc → axis (platform, execution, else)
→ weight desc → dimId asc → actionId asc`. `run-assessment.mjs` calls it
on every `npm run assess` and writes the top 10 into
`assessment.json.rankedNextActions`.

`scripts/__tests__/rank-next-actions.test.mjs` carries a test named
explicitly for this incident:

> `NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action`

— asserting that once `loopCommandUses` satisfies `loopCommandUses>=1`,
`babysit-loop` is absent from the ranked output. A second suite,
`scripts/__tests__/run-assessment-ranking.test.mjs`, checks the
integration path end-to-end (real `scoreAll` output through
`rankNextActions`) for a ≤10-length result and run-to-run determinism.

`.claude/skills/self-assessment/SKILL.md` was simplified accordingly. It
no longer describes a filter or a sort — it tells the model to read
`assessment.json.rankedNextActions[0..2]` directly:

> "Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`."

## Why this shape, not a narrower fix

A narrower fix — just correcting the DSL description in `SKILL.md` — would
have left the reimplementation in place, and reimplementations drift.
The chosen fix removes the *opportunity* for the bug class: there is now
exactly one evaluator (import it or don't touch it) and exactly one
ranking function (read its output or don't touch it). CLAUDE.md now
carries both invariants as hard rules so future changes don't reopen
either gap:

- *"DSL evaluator has one source. `scripts/predicate.mjs` is canonical.
  `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line
  passthrough re-export — never copy the implementation."*
- *"Ranked next-actions live in `assessment.json.rankedNextActions`. The
  self-assessment skill must NEVER hand-implement the `satisfiedWhen`
  filter or the weight×deficit ranking. Read the pre-computed top-10 from
  the written file."*

## Consequences

- Any future change to the `satisfiedWhen` grammar is a one-file edit
  (`scripts/predicate.mjs` + the rubric's `$schema` comment) that
  propagates to both the dashboard and every script-side consumer for
  free — no second implementation to remember to update.
- The self-assessment skill's job narrowed to "read and report," which
  removes an entire class of per-session reasoning error: it can't
  mis-model a grammar it no longer interprets.
- The regression test names the exact incident (`babysit-loop`,
  `loopCommandUses>=1`) so a future refactor that reintroduces the bug
  fails CI with a message that points straight back at this postmortem.

## Related

- `scripts/predicate.mjs`, `scripts/rank-next-actions.mjs` — the two new
  canonical modules.
- `app/lib/assessment.ts` — passthrough re-export site.
- `app/lib/__tests__/predicate-passthrough.test.ts`,
  `scripts/__tests__/rank-next-actions.test.mjs`,
  `scripts/__tests__/run-assessment-ranking.test.mjs` — the regression
  coverage.
- `.claude/skills/self-assessment/SKILL.md` — the simplified consumer.
- PR #104 — the tactical fix that preceded this structural close-out.
