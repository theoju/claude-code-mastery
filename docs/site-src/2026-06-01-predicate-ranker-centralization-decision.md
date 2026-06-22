---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Decision: pre-compute ranked next-actions in `assessment.json`

**Date:** 2026-06-01  
**Status:** Accepted  
**PR:** [#106](https://github.com/theoju/claude-code-self-assessment/pull/106)  
**Design spec:** [`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-31-predicate-ranker-design.md)

---

## Context

On 2026-05-31 the `/self-assessment` skill surfaced `Start with one loop — /loop 30m /babysit` as a top-3 priority despite `signalsSummary.loopCommandUses = 14` satisfying its `satisfiedWhen` predicate (`loopCommandUses>=1`). The action should have been filtered out entirely.

Root cause: the skill's instructions told the model to "first filter satisfied actions, then rank the remainder." The canonical `evaluatePredicate` implementation lived in `app/lib/assessment.ts` — TypeScript-only, Next.js-coupled by location. No Node-side caller existed. The model running the skill hand-wrote a filter that expected `satisfiedWhen` to be a structured object `{ field, op, value }` instead of a string predicate (`"loopCommandUses>=1"`). The hand-written evaluator silently returned `null` for every string expression, zero actions were filtered, and the already-satisfied action wrongly ranked first.

This is a **model re-implementation bug**: the model filled a capability gap by doing what looked reasonable given the context it was given, and produced output that was wrong in a way that was invisible at the skill level.

---

## Decision

Pre-compute the filtered and ranked top-10 next-actions list once per `npm run assess` run and write it into `assessment.json` under `rankedNextActions`. The `/self-assessment` skill reads the pre-computed array verbatim — it never evaluates a predicate, never ranks, never filters.

---

## Alternatives considered

### Alternative A: document the DSL grammar inline in SKILL.md

A stopgap that preceded this PR (PR #105 / tactical step T1 in the design spec): insert the full `satisfiedWhen` grammar into SKILL.md so a careful model can evaluate predicates correctly.

**Why rejected as a permanent fix:** it relies on the model correctly implementing a seven-operator DSL with numeric comparisons, alternation (`|`), negation, regex matching, and AND-composition — every run. The original bug happened because the model was *trying* to implement the filter; better documentation makes the failure mode smaller but doesn't close it. Documentation degrades; a wrong implementation in a future model can re-open the same bug class. The tactical block was deleted in the same PR that landed the structural fix.

### Alternative B: call the Node scorer from inside the skill

The skill could invoke `node scripts/run-assessment.mjs` and parse the written `assessment.json`, or call a dedicated Node script that returns the ranked list. This is roughly equivalent to the chosen approach — the caller is still a shell invocation rather than model logic — but it adds a round-trip (run assess → read output → report) and conflates scoring with reporting. Pre-computing inside the existing `assess` run is cheaper.

### Alternative C: expose a REST endpoint from the dashboard

The skill could hit `GET /api/ranked-next-actions` on the running dashboard. Rejected: the dashboard is not always running when `/self-assessment` is invoked; adding a network dependency on a local server to a CLI skill adds fragile environmental coupling.

### Chosen approach: pre-compute in `assessment.json`

`scripts/rank-next-actions.mjs` exports `rankNextActions(rubric, scoreMap, signalsSummary, limit)`. `scripts/run-assessment.mjs` calls it once after scoring and writes the result to `assessment.json.rankedNextActions`. The skill reads `assessment.json.rankedNextActions[0..2]`. No predicate logic runs in the skill layer.

---

## Consequences

**Positive:**

- The model running `/self-assessment` cannot re-introduce the bug class. Reading an array requires no DSL knowledge.
- The pre-computed list is available to any future consumer (Slack post, console printer, CI report) without duplicating ranking logic.
- The named regression test in `scripts/__tests__/rank-next-actions.test.mjs` pins the specific bug scenario (`loopCommandUses=14` must not surface `loopCommandUses>=1` as a priority) and fails CI if the evaluator regresses.
- The TypeScript dashboard re-exports `evaluatePredicate` from `scripts/predicate.mjs` as a 1-line passthrough; a CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts reference equality, making a silent divergence between the two copies a hard build failure.

**Constraints introduced:**

- `assessment.json` must be written before the skill runs. The skill already depends on the file for score display; this is an existing constraint, not a new one.
- `rankedNextActions` is computed at score time, not report time. A change to `signalsSummary` without re-running `npm run assess` produces a stale list. Acceptable: the list is already implicitly stale-unless-reassessed on every other field.
- The limit is a constant (10). The skill consumes `[0..2]`; any consumer that wants more than 10 must re-run the ranker. Not a concern in practice — 10 covers the relevant action space.

---

## Enforcement

Two hard rules in `CLAUDE.md` lock the contract:

1. **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts reference equality; a duplicate fails CI.

2. **Ranked next-actions live in `assessment.json.rankedNextActions`.** The self-assessment skill must never hand-implement the `satisfiedWhen` filter or the weight × deficit ranking. Read the pre-computed top-10 from the written file.

Both rules are stated explicitly because both represent failure modes that already materialized in production. The cost of re-stating the obvious is much lower than a future cycle where a model "helpfully" re-implements ranking logic.
