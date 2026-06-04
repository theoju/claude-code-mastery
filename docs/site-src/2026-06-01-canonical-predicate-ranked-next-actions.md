---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/106
synthesized_into: []
---

# Canonical Predicate Evaluator and Ranked Next-Actions (PR #106)

Two modules now own jobs that previously lived in multiple places: `scripts/predicate.mjs` evaluates every `satisfiedWhen` predicate expression, and `scripts/rank-next-actions.mjs` pre-computes the sorted, filtered top-N next-action list and writes it into `assessment.json` before any consumer ever reads it.

## The problem this fixes

The `/self-assessment` skill had independently re-implemented the `satisfiedWhen` filter and weight×deficit ranking. That second copy diverged — silently — from the scorer's logic. The visible symptom: already-satisfied next-actions occasionally appeared as TODOs. Because the drift was logic-level, not data-level, no fixture could catch it; the divergence only showed up at runtime when the two implementations disagreed on a boundary case.

## What changed

**`scripts/predicate.mjs`** is now the canonical DSL evaluator. Every `satisfiedWhen` expression — from the rubric's next-actions, from the probes page, from any future consumer — routes through this single function. No other file re-implements the predicate grammar.

**`scripts/rank-next-actions.mjs`** runs at assessment time. It reads the scored signals, evaluates every next-action's `satisfiedWhen` predicate, filters out already-satisfied entries, sorts by `weight × deficit`, and writes the top-N list to `assessment.json` as `rankedNextActions`. By the time any skill, component, or future agent reads the file, the ranked list is already correct.

**`app/lib/assessment.ts`** evaluator is now a one-line passthrough re-export of `scripts/predicate.mjs`. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`) asserts the two are reference-equal. Duplicating the implementation fails CI.

**`.claude/commands/self-assessment.md`** was updated to read `rankedNextActions` from the written `assessment.json` instead of filtering and ranking inline.

## Hard rules established

Two invariants are now captured in `CLAUDE.md` and enforced by CI:

1. **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never a copy of the implementation. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

2. **Ranked next-actions live in `assessment.json`.** The self-assessment skill must never hand-implement the `satisfiedWhen` filter or the weight×deficit ranking. Read the pre-computed top-10 from `rankedNextActions`. Surfacing a satisfied action as a TODO is a regression — fix the data layer, not the report.

## Why pre-compute rather than evaluate at read time

The skill runs inside a Claude Code session and can't safely import Node modules the way `scripts/` can. Pre-computing at `npm run assess` time is the right boundary: scoring happens once, locally, with full access to the signals context. Readers — skills, the dashboard, future agents — consume the already-correct output without needing to re-derive it.

This also means the ranking is deterministic and auditable: `assessment.json` is the single artifact you can inspect to understand exactly which next-actions were surfaced and in what order.
