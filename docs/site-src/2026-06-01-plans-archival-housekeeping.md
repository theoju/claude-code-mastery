---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
doc_kind: decision
---

# Plans archival — 2026-06-01 housekeeping

PR #114 moved four completed engineering plan documents from `docs/superpowers/plans/` into `docs/superpowers/plans/archived/`. No plan content was altered; this was a pure file-move triggered by a plans-audit that flagged four landed-but-not-yet-archived entries.

## What was archived

| Plan file | Shipped feature | PR |
| --- | --- | --- |
| `2026-05-26-runtime-adoption-probes.md` | Runtime adoption probes — `detectCoworkDispatch`, `detectOpus47Awareness`, `adoptionBonus()` helper, and the new `runtime`/axis-A probe-catalog source | #94 |
| `2026-05-31-cce-33-progression-detectors.md` | Three new progression-timeline detectors for `scheduled`, `remote`, and `verification` dimensions, closing the CCE-33 coverage gap | #108 |
| `2026-05-31-per-command-partition.md` | `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition in `_usage-data.mjs`, with a fail-loud `assertCommandPartition` boundary assertion that runs at module load | #110 |
| `2026-05-31-predicate-ranker.md` | `scripts/predicate.mjs` as canonical DSL evaluator, `scripts/rank-next-actions.mjs`, and the `rankedNextActions[10]` field baked into `assessment.json` | #104 |

## What was intentionally left active

`2026-06-01-ship-journal-stage-credit.md` (CCE-72, PR #113) was not archived — it was still in-flight at the time of the audit and is the only plan that remained active per convention.

## Why this matters

The active plans directory (`docs/superpowers/plans/`) is the working surface for in-flight work. Completed plans accumulating there made it harder to distinguish what is live from what is done. Archiving completed work keeps the signal-to-noise ratio high for anyone picking up a plan to implement.

The archived plans are not deleted — they remain in `docs/superpowers/plans/archived/` as institutional memory for the design decisions and task breakdowns that shaped each shipped feature.
