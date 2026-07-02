---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Decision: canonicalize the predicate DSL evaluator and precompute ranked next-actions

## Status

Accepted (PR #106, 2026-06-01).

## Context

`satisfiedWhen` is the rubric's DSL for marking a next-action already done —
a string like `"loopCommandUses>=1"` or `"permissionsDefaultMode=auto &
!skipDangerous"`, evaluated against `signalsSummary` (see the grammar
comment at the top of `scripts/predicate.mjs`). Before this PR, exactly one
implementation of that evaluator existed: `evaluatePredicate` in
`app/lib/assessment.ts`, consumed by the dashboard's dimension pages and by
`scripts/run-assessment.mjs`.

On 2026-05-31 a model working the `/self-assessment` skill needed a ranked
list of priority actions and hand-wrote its own filter instead of reusing
that evaluator. It misread `satisfiedWhen` as an object shape rather than
the rubric's string DSL, so the check silently no-opped. The result: an
already-satisfied action (`babysit-loop`, with `loopCommandUses=14` in the
user's actual signals) surfaced as a top-priority next-action anyway. PR #104
was the tactical response — it documented the grammar more explicitly so a
future read would parse it correctly. That fix reduces the odds of
misreading the DSL; it does nothing to stop a future consumer from
re-implementing the filter (and the weight × deficit ranking) from scratch,
which is the failure class that actually produced the bug. PR #106 is the
structural close-out.

## Decision

1. **One evaluator, one file.** `scripts/predicate.mjs` is now the canonical
   `evaluatePredicate` implementation — a pure-ESM module with no
   dependency on either the Node scripts or the Next.js app. `app/lib/assessment.ts`
   no longer implements the DSL; it imports and re-exports the mjs
   function verbatim:

   ```ts
   import { evaluatePredicate } from "../../scripts/predicate.mjs";
   export { evaluatePredicate };
   ```

   `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two import
   paths are reference-equal (`expect(fromTs).toBe(fromMjs)`), so a future
   re-fork of the logic back into the TS file fails CI instead of drifting
   silently. Per CLAUDE.md, grammar changes now have exactly one edit site:
   `scripts/predicate.mjs` (plus the rubric's `$schema` comment) — never the
   TS file.

2. **Ranking moves server-side, precomputed.** `scripts/rank-next-actions.mjs`
   exports `rankNextActions(rubric, scoreMap, signalsSummary, limit = 10)`.
   For every `nextAction` on every rubric dimension it:
   - drops the action if `satisfiedWhen` is set and `evaluatePredicate`
     returns true against `signalsSummary` — via the canonical evaluator,
     not a re-implementation;
   - computes a `rank = weight × deficit`, where `deficit` is
     `100 - executionScore` for actions on the execution axis and
     `100 - score` (platform) otherwise;
   - sorts by `rank` descending, then axis (`platform` before `execution`
     before anything else), then `weight` descending, then `dimId`/`actionId`
     alphabetically as a deterministic final tie-break.

   `scripts/run-assessment.mjs` calls it once per run and writes the top 10
   into `assessment.json` under `rankedNextActions`, alongside the existing
   `signalsSummary` and `scores` blocks. The shape is on the TS side too —
   `RankedNextAction` is a first-class field of the `Assessment` interface
   in `app/lib/assessment.ts`, so the dashboard and any future consumer read
   the same precomputed array the skill does.

3. **The skill stops filtering.** `.claude/skills/self-assessment/SKILL.md`
   was simplified to read `assessment.json.rankedNextActions[0..2]` directly
   and report the fields verbatim (`dimId`, `actionId`, `axis`, `weight`,
   `deficit`, `rank`, `action`, `effort`, `borisTip`, `satisfiedWhen`) rather
   than reconstructing the filter+sort itself. CLAUDE.md now states this as
   a hard rule: *"The self-assessment skill must NEVER hand-implement the
   `satisfiedWhen` filter or the weight × deficit ranking. Read the
   pre-computed top-10 from the written file."*

## Consequences

- **A whole failure class is closed by construction**, not by better
  documentation. The skill can no longer misread the DSL because it no
  longer parses the DSL at all — it reads an already-filtered,
  already-ranked array. Re-introducing the 2026-05-31 bug now requires
  editing `scripts/rank-next-actions.mjs` (which has its own predicate-
  correctness tests) rather than a markdown-guided freehand re-implementation
  inside a skill invocation.
- `assessment.json` grows by up to 10 small entries per run
  (`rankedNextActions`), which the two-axis renderers (dashboard, Slack,
  console) can consume directly instead of recomputing priority order.
- The DSL's only edit surface is now `scripts/predicate.mjs`; any grammar
  change (new operator, new comparison form) is written once and is
  automatically correct everywhere `evaluatePredicate` is imported —
  `scripts/run-assessment.mjs`, `scripts/rank-next-actions.mjs`, and
  `app/lib/assessment.ts` all resolve to the same function object.
- The tactical grammar-doc fix from PR #104 is superseded as the primary
  defense but not wasted — it's still the reference documentation a
  contributor reads before touching `scripts/predicate.mjs`.

## Related

- PR #104 — tactical grammar-documentation fix (superseded as primary
  defense by this PR, retained as reference docs).
- PR #106 — this decision's implementation.
- `scripts/__tests__/predicate.test.mjs`,
  `scripts/__tests__/rank-next-actions.test.mjs`,
  `scripts/__tests__/run-assessment-ranking.test.mjs`,
  `app/lib/__tests__/predicate-passthrough.test.ts` — the test surfaces
  that back this decision.
