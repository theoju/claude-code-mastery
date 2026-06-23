---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
doc_kind: decision
---

# Plans Archival — 2026-06-01

Four implementation plans were moved from `docs/superpowers/plans/` into `docs/superpowers/plans/archived/` after a plans-audit confirmed their corresponding PRs had merged. No content was altered; the change is a pure rename to keep the active plans folder uncluttered.

## What moved

| Plan file | Landed in |
| --------- | --------- |
| `2026-05-26-runtime-adoption-probes.md` | PR #94 — cliConfig adoption detectors for Boris tips 50/27/74/39; `adoptionBonus()` helper; `runtime` probe-catalog source |
| `2026-05-31-cce-33-progression-detectors.md` | PR #108 (CCE-33) — `scheduled`, `remote`, and `verification` progression-timeline detectors; extended `scanTranscriptModes` with a per-session `commands: Set<string>` |
| `2026-05-31-per-command-partition.md` | PR #110 — `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition in `scripts/_usage-data.mjs`; fail-loud `assertCommandPartition` at module load |
| `2026-05-31-predicate-ranker.md` | PR #104 — `scripts/predicate.mjs` as the canonical DSL evaluator; `scripts/rank-next-actions.mjs`; `rankedNextActions[10]` baked into `assessment.json` |

## Why now

The convention is to archive a plan once its PR merges. The audit found these four had all landed but were still sitting in the active directory. The just-merged `2026-06-01-ship-journal-stage-credit.md` (PR #113, CCE-72) was intentionally left active for one more cycle before archival.

## No behavior change

This is housekeeping only. Active plans, specs, the rubric, and all scorer logic are unaffected.
