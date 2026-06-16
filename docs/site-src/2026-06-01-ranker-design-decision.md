---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
doc_kind: decision
---

# Decision: centralize the `satisfiedWhen` DSL evaluator and pre-compute ranked next-actions

**Date**: 2026-06-01  
**PRs**: #104 (tactical grammar block), #106 (structural fix)  
**Status**: landed

## Context

On 2026-05-31 the `/self-assessment` skill hand-wrote a Node ranker to produce
its top-3 priority list. The ranker parsed `satisfiedWhen` strings as if they
were structured objects — `{ field, op, value }` — rather than the actual string
DSL the rubric defines (e.g. `"loopCommandUses>=1"`). `evaluatePredicate`
returned `null` for every expression because no object decomposition succeeded.
With filtering broken, every next-action passed through, including `babysit-loop`
(`loopCommandUses = 14`). It appeared as a top-3 priority when the predicate
should have suppressed it.

PR #104 applied a tactical patch: a grammar block in SKILL.md describing the
string-expression syntax so the model would at least produce the right shape. The
tactical fix is fragile — any consumer that re-implements the grammar drifts as
the DSL evolves. PR #106 is the structural fix.

## Decision

Extract a single canonical evaluator at `scripts/predicate.mjs` and prohibit
every other layer from implementing its own copy.

Two hard rules in CLAUDE.md pin the contract end-to-end:

1. **`scripts/predicate.mjs` is the only implementation.** `app/lib/assessment.ts`
   re-exports `evaluatePredicate` as a 1-line passthrough — no duplicate logic.
   CI test `app/lib/__tests__/predicate-passthrough.test.ts` asserts
   `fromTs === fromMjs` (reference identity), so a copy that diverges fails the
   build.

2. **Ranked next-actions live in `assessment.json.rankedNextActions`.** The skill
   reads from the pre-computed array, never re-implements the filter or ranking.
   `scripts/rank-next-actions.mjs` runs once per `npm run assess` via
   `scripts/run-assessment.mjs` and writes the result. The SKILL.md entry is a
   single bullet: "Read `assessment.json.rankedNextActions[0..2]`."

## Options considered

### Option A — per-consumer re-implementation (rejected)

Each consumer (scoring page, skill, ranker) implements its own DSL parser. No
shared module. The 2026-05-31 incident is exactly what this looks like when it
goes wrong: two implementations, one silently wrong, both consistent with the
rubric's `$schema` comment but neither cross-checked against the other.

Rejected because: the DSL grammar is non-trivial (8 operator forms, `&` chaining,
array-regex, `isTruthy` edge cases). A second implementation almost certainly
diverges on at least one edge case, and the divergence is invisible until a
signal takes a specific value.

### Option B — inline evaluation inside SKILL.md instructions (rejected)

The tactical fix (PR #104) went this direction: add enough grammar documentation
to the skill file that the model gets it right. This works until the grammar
gains a new operator form, at which point every consumer's documentation falls
out of date simultaneously and there's no CI signal to catch it.

Rejected because: documentation of a behavior is not a test of that behavior. The
only reliable contract is a function shared by reference.

### Option C — canonical module, passthrough re-export, CI reference test (chosen)

A single pure-ESM function in `scripts/predicate.mjs`. `app/lib/assessment.ts`
re-exports it. `scripts/rank-next-actions.mjs` imports it. No consumer owns the
logic. CI asserts reference identity.

The pre-computation step (`rankNextActions` in `run-assessment.mjs`) converts
the "skill reads the ranked list" requirement from a runtime parsing problem into
a data-reading problem. The skill cannot misread a pre-computed JSON array the
way it can misread a string expression.

## Consequences

### What changes

- `scripts/predicate.mjs` is the new canonical home. It is a byte-faithful port
  of the original `app/lib/assessment.ts:evaluatePredicate` — no behavior
  changes, only relocation.
- `app/lib/assessment.ts:evaluatePredicate` becomes a 1-line passthrough. The
  original implementation is deleted from the TS file.
- `scripts/rank-next-actions.mjs` introduces `rankNextActions(rubric, scoreMap,
  signalsSummary, limit = 10)`. It calls `evaluatePredicate` directly and returns
  a sorted array of up to `limit` entries.
- `scripts/run-assessment.mjs` calls `rankNextActions` and writes the result into
  `assessment.json` under `rankedNextActions`.
- The `RankedNextAction` TypeScript interface is added to `Assessment` in
  `app/lib/assessment.ts` with a `?? []` fallback so pages that read the field
  never see `undefined`.
- SKILL.md drops the grammar block added by PR #104. It becomes one bullet
  pointing at the pre-computed array.

### What does not change

- The DSL grammar itself. No new operators were added; PR #106 is purely
  structural.
- Scoring behavior. No signal, rubric weight, or target was modified.
- The `satisfiedWhen` field format in `app/data/rubric.json`. Existing entries
  evaluate identically through the ported function.

### Invariants the CI suite now enforces

| Test file | What it pins |
|---|---|
| `app/lib/__tests__/predicate-passthrough.test.ts` | `evaluatePredicate` from TS and MJS are reference-equal (same function object). A copied implementation fails. |
| `scripts/__tests__/predicate.test.mjs` | Operator coverage: `>=`, `>`, `<=`, `<`, `=`, `!=`, `~`, `&`, `!`, missing-signal NaN guard, truthy path. |
| `scripts/__tests__/rank-next-actions.test.mjs` | Named regression: `loopCommandUses=14` excludes `babysit-loop`. Tie-break is deterministic. Malformed entries silently skipped. Axis defaults (`predicated → platform`, `unpredicated → either`). |
| `scripts/__tests__/run-assessment-ranking.test.mjs` | `rankedNextActions` is present and non-empty in the written `assessment.json`. |

### The named regression

The test named **"NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop
action"** in `scripts/__tests__/rank-next-actions.test.mjs` is a permanent
fixture, not a one-time check. If the evaluator silently stops handling
`>=` comparisons, this test fails CI before any skill sees the broken output.

## Reference

- `scripts/predicate.mjs` — canonical implementation, 94 lines
- `scripts/rank-next-actions.mjs` — filter + rank, `weight × deficit` with
  5-tier deterministic tie-break (rank desc → axis → weight → dimId → actionId)
- `app/lib/__tests__/predicate-passthrough.test.ts` — reference-identity CI gate
- Companion architecture page: `docs/site-src/2026-06-01-predicate-evaluator.md`
