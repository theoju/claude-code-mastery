---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
doc_kind: decision
---

# Archive landed plans — PR #114

**Date:** 2026-06-01  
**Type:** Housekeeping / internal  
**PR:** [#114](https://github.com/theoju/claude-code-self-assessment/pull/114)

## Decision

Move four completed engineering plan files from `docs/superpowers/plans/` into `docs/superpowers/plans/archived/`. No content was altered — these are pure renames.

## Context

A plans-audit pass flagged: _"Landed plans not yet archived."_ The active plans directory is intended to hold only in-flight work; plans whose implementation PRs have merged belong in `archived/` so the audit output stays accurate on subsequent runs.

## Plans archived

| Plan file | Covered | Landed in |
|---|---|---|
| `2026-05-26-runtime-adoption-probes.md` | Runtime-adoption probe detectors for Boris tips 50, 74, 33, 27, 39 — new `adoptionBonus()` helper, `cliConfig` signals, `runtime`/A axis on the probes page | PR #94 |
| `2026-05-31-cce-33-progression-detectors.md` | Three new `DETECTORS` entries in `scripts/progression.mjs` covering the `scheduled`, `remote`, and `verification` dimensions (previously absent from the timeline) | PR #108 |
| `2026-05-31-per-command-partition.md` | `POSTURE_COMMANDS` / `VOLUME_COMMANDS` Sets, `assertCommandPartition` fail-loud guard, and session-kind gate inside `scanTranscriptInvocations` | PR #110 |
| `2026-05-31-predicate-ranker.md` | `scripts/predicate.mjs` canonical DSL evaluator, `scripts/rank-next-actions.mjs`, `rankedNextActions[10]` baked into `assessment.json`, TS passthrough re-export | PR #104 |

## Effect

- **User-visible behavior:** none. Pure file moves.
- **Active plans directory:** now limited to plans whose implementation is not yet merged.
- **plans-audit output:** resolves the "Landed plans not yet archived" finding.
