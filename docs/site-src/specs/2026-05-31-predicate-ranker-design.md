---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate Ranker — Design Spec

> **For agentic workers:** The stopgap (DSL grammar embedded in the skill) shipped in PR #104. The structural fix — `scripts/predicate.mjs` extraction + `rankedNextActions` pre-computation — is the implementation target described here. Implement in the main repo, not in `~/.claude/`.

> **For readers:** The short version: the `/self-assessment` skill was surfacing already-satisfied next-actions as top priorities because it hand-wrote a predicate filter instead of delegating to the canonical evaluator. This spec describes the two-step fix. See the paired implementation plan at `docs/site-src/plans/2026-05-31-predicate-ranker.md` for the per-task breakdown.

**Goal:** Extract the `satisfiedWhen` DSL evaluator to a Node-shareable `scripts/predicate.mjs` and pre-compute the weight×deficit-ranked next-actions into `assessment.json` at score time. The `/self-assessment` skill reads `rankedNextActions` from the written file — it never re-derives the filter or ranking.

**Why now:** The `/self-assessment` skill reported already-satisfied next-actions as top priorities in multiple sessions. Root cause: `evaluatePredicate` lived only in `app/lib/assessment.ts` (TypeScript, browser/Next.js), so the model — lacking access to the canonical evaluator — hand-wrote a filter that silently skipped string-typed predicates (e.g. `"gt:boolValue:someField:0"`). The satisfied check was wrong and the ranking was therefore wrong. PR #104 embeds the DSL grammar in the skill as a stopgap; this spec closes the structural gap.

**Scope:** Node-side scoring pipeline (`scripts/`) + one re-export shim in `app/lib/assessment.ts`. No changes to the rubric schema, no new dimension. The `/self-assessment` slash command and skill gain a contract: read `assessment.json.rankedNextActions`, never implement the filter.

---

## Background: the DSL

Every next-action in `app/data/rubric.json` carries an optional `satisfiedWhen` field. When present, the dashboard uses it to suppress the action from the next-actions list if the user has already satisfied it. The evaluator reads a `signalsSummary` snapshot (built by `buildSignalsSummary` in `scripts/run-assessment.mjs`) and returns `true` if the predicate is satisfied.

### Grammar (canonical)

```
predicate    = compound | comparison | boolean-literal
compound     = "and:" pred ":" pred
             | "or:"  pred ":" pred
             | "not:" pred
comparison   = operator ":" type ":" field ":" value
operator     = "gt" | "gte" | "lt" | "lte" | "eq" | "neq"
type         = "num" | "bool" | "str"
field        = <key in signalsSummary>
value        = <string-encoded literal>
boolean-lit  = "true" | "false"
```

Examples from the rubric:

| Predicate string                          | Reads as                                    |
| ----------------------------------------- | ------------------------------------------- |
| `"gt:num:agentCount:0"`                   | `signalsSummary.agentCount > 0`             |
| `"eq:bool:hasHooks:true"`                 | `signalsSummary.hasHooks === true`          |
| `"and:gt:num:commandCount:2:eq:bool:hasHooks:true"` | both sub-predicates must hold   |
| `"or:gt:num:agentCount:0:gt:num:commandCount:0"` | either field non-zero            |

The current TypeScript implementation lives at `app/lib/assessment.ts:evaluatePredicate`. It is the only authoritative implementation; the design spec canonicalizes `scripts/predicate.mjs` as the new source of truth and demotes the TS version to a passthrough re-export.

---

## Architecture

### Files

| Path                                          | Role after this change                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scripts/predicate.mjs`                       | **New.** Canonical DSL evaluator, CommonJS-compatible ES module. Exported as `evaluatePredicate(pred, signals)`. |
| `scripts/rank-next-actions.mjs`               | **New.** Reads rubric next-actions + `signalsSummary`; filters unsatisfied; sorts by `weight × (100 − score)`; returns top-N. |
| `scripts/run-assessment.mjs`                  | **Modified.** Calls `rankNextActions` and writes the result into `assessment.json` as `rankedNextActions`.       |
| `app/lib/assessment.ts`                       | **Modified.** `evaluatePredicate` becomes a one-line re-export from `scripts/predicate.mjs`.                    |
| `app/lib/__tests__/predicate-passthrough.test.ts` | **New.** Asserts the TS and Node exports are reference-equal; fails if a copy-paste drift is introduced.    |
| `.claude/skills/self-assessment/SKILL.md`     | **Modified (PR #104 stopgap already landed).** DSL grammar embedded; directive to read `rankedNextActions`.      |

### Data flow

```
scripts/signals.mjs          → signalsSummary
scripts/score.mjs            → dimensionScores
scripts/rank-next-actions.mjs  ← signalsSummary + dimensionScores + rubric.json
                               → rankedNextActions[]
scripts/run-assessment.mjs   → writes assessment.json { …scores, rankedNextActions }

/self-assessment (skill)     → reads assessment.json.rankedNextActions[0..2]
                               → reports top 3 unsatisfied actions by priority
```

---

## `rankedNextActions` contract

Each entry in the array is a plain object:

```ts
{
  id: string;           // next-action id from rubric.json
  dimension: string;    // dimension id (e.g. "automation")
  title: string;        // human-readable title
  weight: number;       // dimension weight (1–3)
  deficit: number;      // 100 - platformSetupScore for this dimension (0–100)
  priority: number;     // weight × deficit (higher = more important)
  satisfied: false;     // always false — satisfied actions are excluded
}
```

The array is sorted descending by `priority`. The skill reports `rankedNextActions[0..N-1]` — it does not re-sort, re-filter, or re-evaluate predicates. If the field is missing from `assessment.json` (e.g. an older snapshot), the skill falls back to the manual top-3 heuristic and logs a warning.

---

## Hard rules established by this change

1. **`scripts/predicate.mjs` is the canonical evaluator.** `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line re-export — never a copy. The passthrough test enforces this in CI.
2. **Ranked next-actions live in `assessment.json.rankedNextActions`.** The `/self-assessment` skill must never hand-implement the `satisfiedWhen` filter or the weight×deficit ranking. Read the pre-computed top-N. Surfacing a satisfied action as a TODO is a regression; fix the data layer, not the report.
3. **The stopgap (DSL grammar in the skill) stays** even after the structural fix lands. It serves as in-context documentation for the model and guards against future evaluator drift.

---

## Two-PR structure

| PR  | Scope                                                                                           | Ships                                                                                         |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Stopgap: embed DSL grammar + `rankedNextActions` read directive in the skill (PR #104, landed). | Skill no longer hand-writes the filter; model has the grammar as fallback.                    |
| 2   | Structural fix: `scripts/predicate.mjs` + `rank-next-actions.mjs` + `assessment.json` contract. | `rankedNextActions` pre-computed at score time; passthrough test in CI; skill reads the file. |

---

## Open questions

- **Top-N default:** The skill currently surfaces 3 actions. `rank-next-actions.mjs` should default to 10 (full ranked list) so callers choose their display slice; the skill keeps its 3-item read.
- **Execution axis deficit:** The current ranking uses the Platform Setup score for deficit. A future iteration could weight by the max of Setup and Execution deficits — deferred to the follow-up once both axes stabilize.
- **Schema versioning:** `assessment.json` has no version field. Adding `rankedNextActions` is additive; older consumers that don't read the field are unaffected. A `schemaVersion` field is desirable but out of scope here.
