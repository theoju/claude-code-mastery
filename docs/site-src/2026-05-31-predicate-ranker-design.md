---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate ranker: design decision (2026-05-31)

## Problem

Every time a model ran `/self-assessment`, it had to re-implement the
`satisfiedWhen` predicate evaluator from scratch. The canonical evaluator lived
inside the Next.js app (`app/lib/assessment.ts`) where no Node-side caller could
reach it. Models guessed the schema and consistently guessed wrong — expecting
a structured object `{field, op, value}` when the actual format is a plain
string like `"loopCommandUses>=1"`. The evaluator returned `null` for every
predicate, filtering was silently suppressed, and already-satisfied actions
surfaced as top-3 priorities.

Concrete example: `loopCommandUses` was `14` (well past the threshold), but the
`babysit-loop` next-action kept appearing as high-priority because the DSL was
never actually evaluated.

## Root cause

Two compounding failures:

1. **No Node-side DSL evaluator.** `app/lib/assessment.ts` is Next.js-coupled.
   A model running inside a Claude session has no way to `import` it. The skill
   documented that it should filter on `satisfiedWhen`, but gave no evaluatable
   definition of what `satisfiedWhen` meant.

2. **No pre-computed output.** The skill owned both the "run and read
   `assessment.json`" step and the "filter and rank" step. That second step
   requires an evaluator. Without one, the skill fell back to ad-hoc logic that
   produced wrong results.

## Decision

Two-part fix, shipped together in PR #104:

### Part 1 — Tactical stopgap: document the DSL inline in SKILL.md

Added a concrete grammar block to `SKILL.md` so a model reading the skill
can evaluate predicates without guessing:

```
DSL grammar (satisfiedWhen strings):
  "<field><op><value>"
  op: >= | <= | > | < | == | !=
  Examples: "loopCommandUses>=1"  "hasCustomAgents==true"
```

This is a stopgap. It keeps the skill correct across the window before the
structural fix lands.

### Part 2 — Structural fix: extract evaluator + pre-compute ranked list

The durable solution has two sub-parts:

**`scripts/predicate.mjs`** — a Node-shareable predicate evaluator extracted
from the TS implementation. Any caller that can run Node (the assessment
script, the skill, tests) can now evaluate `satisfiedWhen` strings without
re-implementing the grammar. `app/lib/assessment.ts` becomes a 1-line
re-export of this module; duplicating the implementation is a contract
violation.

**`assessment.json.rankedNextActions`** — the assessment script now writes
a pre-ranked, pre-filtered top-10 list directly into `assessment.json`. The
skill becomes a trivial reader:

```
Read assessment.json → print rankedNextActions[0..2]
```

No filter logic, no ranking logic, no DSL evaluation in the skill at all.
The data layer owns correctness; the skill owns presentation.

## Contract

`rankedNextActions` in `assessment.json` is an ordered array of next-action
objects, each with at minimum:

| Field       | Type     | Meaning                                         |
| ----------- | -------- | ----------------------------------------------- |
| `id`        | `string` | Rubric next-action identifier                   |
| `dimension` | `string` | Dimension the action belongs to                 |
| `title`     | `string` | Human-readable label                            |
| `score`     | `number` | Computed weight × deficit priority score        |
| `satisfied` | `boolean`| Whether `satisfiedWhen` evaluated to true       |

Only unsatisfied actions appear in the list — the filter runs at write time,
not at read time. The skill must **never** re-implement the filter or ranking;
if a satisfied action appears in the top-3, that is a bug in the data layer.

## What this eliminates

| Old behavior                                      | New behavior                                    |
| ------------------------------------------------- | ----------------------------------------------- |
| Skill hand-implements DSL evaluator               | Skill reads pre-computed list                   |
| Wrong evaluator → all predicates return null      | Evaluator runs once, correctly, at assess time  |
| Already-satisfied actions surface as priorities   | Satisfied actions excluded before write         |
| TS evaluator unreachable from Node scripts        | `scripts/predicate.mjs` is the canonical source |

## Files touched

| File                         | Change                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| `.claude/skills/*/SKILL.md`  | DSL grammar documented inline (stopgap)                                |
| `scripts/predicate.mjs`      | New: canonical Node-shareable DSL evaluator                            |
| `app/lib/assessment.ts`      | Becomes 1-line re-export of `scripts/predicate.mjs`                   |
| `scripts/run-assessment.mjs` | Writes `rankedNextActions` into `assessment.json` at assess time       |
| `app/data/rubric.json`       | No change — `satisfiedWhen` strings are already the correct format     |

## Related

- Design spec and implementation plan: `docs/superpowers/specs/` and
  `docs/superpowers/plans/` (both added in PR #104).
- CLAUDE.md hard rule: "Ranked next-actions live in
  `assessment.json.rankedNextActions`. The self-assessment skill must NEVER
  hand-implement the satisfiedWhen filter or the weight×deficit ranking."
- CLAUDE.md hard rule: "DSL evaluator has one source. `scripts/predicate.mjs`
  is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line
  passthrough re-export — never copy the implementation."
