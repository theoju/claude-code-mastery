---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
---

# Plans housekeeping: four completed plans archived (PR #114)

Four shipped implementation plans were moved from `docs/superpowers/plans/`
into `docs/superpowers/plans/archived/`. No content changed — pure renames
triggered by the plans-audit tooling flagging them as "Landed plans not yet
archived."

## What moved

| Plan file | Landed in |
| --------- | --------- |
| `2026-05-26-runtime-adoption-probes.md` | PR #94 |
| `2026-05-31-cce-33-progression-detectors.md` | PR #108 |
| `2026-05-31-per-command-partition.md` | PR #110 |
| `2026-05-31-predicate-ranker.md` | PR #104 |

## Why it matters

The active `plans/` directory is the signal the plans-audit tooling reads when
reporting in-flight work. Leaving landed plans there produces false positives
in that report — the tooling says four things are "in progress" when they
shipped weeks ago. Archiving them keeps the active list accurate.

The `2026-06-01-ship-journal-stage-credit.md` plan (PR #113, CCE-72) was
intentionally left in the active directory — it is still in-flight per
convention and was not touched by this PR.

No scoring logic, no probe behavior, and no dashboard rendering changed.
