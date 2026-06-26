---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate evaluator + ranked next-actions

**Date:** 2026-05-31  
**Status:** Implemented (PR 1 merged; PR 2 structural fix)

## Problem

On 2026-05-31, a model running `/self-assessment` reported `Start with one loop: /loop 30m /babysit` as a top-3 priority action despite `signalsSummary.loopCommandUses` being `14` — a value that clearly satisfies the action's `satisfiedWhen` predicate (`loopCommandUses>=1`).

Root cause: the skill instructed the model to "first filter, then rank" but gave it no description of what a `satisfiedWhen` value looks like. The model hand-wrote a filter that expected an object shape — `{ field, op, value }` — and received strings like `"loopCommandUses>=1"` instead. Every predicate evaluation returned `null`. The filter was bypassed entirely, and already-satisfied actions surfaced as priorities.

The canonical DSL evaluator (`app/lib/assessment.ts:evaluatePredicate`) existed and was correct. The model never knew it was there.

## Fix: two-PR sequence

### PR 1 — Tactical: DSL grammar block in SKILL.md

Adds a `satisfiedWhen` DSL grammar reference directly beneath the `Top 3 priority actions` bullet in `.claude/skills/self-assessment/SKILL.md`. This anchors future skill executions to the canonical evaluator's behavior without requiring a code change.

**Grammar (7 operator classes):**

| Form | Semantics |
|---|---|
| `path` | truthy (non-null, non-zero, non-empty string; `"0"` and `"false"` are falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison against `signalsSummary[path]` |
| `path=v` or `path=v\|w\|x` | string equality, or equality against any of a list |
| `path!=v` | not equal |
| `path~regex` | any element of an array-of-strings field matches the regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`. The worked example from the bug: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to **true** → the action is filtered out and must not appear as a TODO.

This grammar block is **explicitly temporary** — PR 2 deletes it once the structural fix bakes the filtered, ranked list into `assessment.json` and the skill becomes a trivial reader.

### PR 2 — Structural: extract + bake

Three changes land together:

1. **`scripts/predicate.mjs`** — pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, and `evaluatePredicate` from `app/lib/assessment.ts` (lines 165–259). No external dependencies. This is the new canonical source; the TS file becomes a 1-line passthrough re-export.

2. **`scripts/run-assessment.mjs`** — imports `evaluatePredicate` from `predicate.mjs` and calls `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)` at the end of each run. The result is written to `assessment.json` as `rankedNextActions` — a top-10 list of unsatisfied actions sorted by `weight × deficit`, with deterministic tie-breaking (`platform` axis before `execution` before `either`; then `weight` descending; then `dimId` and `actionId` ascending).

3. **SKILL.md** — replaces the "first filter, then rank" instructions with: "Read `assessment.json.rankedNextActions[0..2]` — already filtered and ranked." The PR 1 grammar block is deleted as obsolete.

### `assessment.json.rankedNextActions` schema

Each entry carries: `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`, `satisfiedWhen`. The limit is 10 (constant, not configurable). The skill consumes `[0..2]`; the cap gives Slack / console renderers room without recomputing.

## Error handling

Missing signal fields are treated as `0` / `false` (action is kept, not hidden). Predicate parse errors also keep the action — conservative over hiding. This matches the existing TS behavior exactly.

## Tests shipped with PR 2

- **`scripts/__tests__/predicate.test.mjs`** — one test per operator class, edge cases (missing field, `"0"` as falsy string, whitespace tolerance in `A & B`), plus a rubric integration test that iterates every `satisfiedWhen` value in `app/data/rubric.json` and asserts it parses without throwing.
- **`scripts/__tests__/rank-next-actions.test.mjs`** — fixture-driven ranker tests, including a named regression for the specific `loopCommandUses=14 vs >=1` bug.
- **`app/lib/__tests__/predicate-passthrough.test.ts`** — asserts that `evaluatePredicate` exported from `app/lib/assessment.ts` and from `scripts/predicate.mjs` are reference-equal (`toBe`), proving the TS file is a true passthrough and not a copy. A future contributor who duplicates the implementation instead of re-exporting fails CI.

## Hard rule added to CLAUDE.md

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

## What didn't change

- The DSL grammar itself — the 7 operator classes are unchanged.
- The dashboard render paths — `/methodology/probes` and `/dimensions/[id]` continue to call `evaluatePredicate` fresh at request time for per-action ✓/✗ marks. `rankedNextActions` serves the skill, Slack, and console only.
- Probe counts — no probes were added or removed.

## Decision rationale

The structural fix (PR 2) eliminates the bug class, not just the instance. A skill that reads pre-computed output cannot mis-implement the evaluator. The tactical fix (PR 1) exists solely to reduce risk during the window between the bug's discovery and PR 2's merge — any `/self-assessment` run in that window gets the grammar inline rather than guessing.
