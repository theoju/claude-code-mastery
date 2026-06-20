---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/118
synthesized_into: []
doc_kind: decision
---

# Plans archived: CCE-72 and CCE-76 (PR #118)

**Date:** 2026-06-01  
**PR:** [#118](https://github.com/theoju/claude-code-self-assessment/pull/118)  
**Type:** Housekeeping — no behavior change

---

## What happened

Two implementation plans were moved from `docs/superpowers/plans/` to
`docs/superpowers/plans/archived/` via `git mv`. File contents are unchanged.

| Plan file | Ticket | Feature landed |
| --- | --- | --- |
| `2026-06-01-ship-journal-stage-credit.md` | CCE-72 | PR #113 (v0.9.18) |
| `2026-06-01-memory-customization-execution-scorers.md` | CCE-76 | PR #116 (v0.9.18) |

---

## Why

The `plans-audit` test gate enforces that active plans directories contain only
in-flight work. Once a plan's feature has merged to `main`, the plan file moves
to `archived/` so the active directory is an accurate picture of what is still
being built.

---

## What the archived plans covered

### CCE-72 — `/ship` Stage 2 + 3 journal-credit

`gatherShipJournal` previously read only the oldest journal format
(`entry.stage === 2`), which meant ~41% of journal entries were missed and a
user with `/ship` deeply integrated still scored `simplifyCommandUses=0`.

The plan delivered a `stageRanInEntry(entry, legacyNumber, newName)` helper
that detects stage execution across all three journal format generations
(singular `entry.stage`, legacy-numeric `stages_run` array, new-string
`stages_run` array). `gatherShipJournal` consumes it for both `stage2Count`
(widened) and a new `simplifyStageCount`. The `simplifyCommandUses` projection
in `run-assessment.mjs` MAX-merges the journal counter alongside the existing
transcript and history sources, mirroring the v0.9.16 `/color` pattern.

### CCE-76 — Memory + Customization Execution scorers

Both the `memory` and `customization` dimensions previously returned
`noTelemetry()` — their Execution vertices on the radar were italic-unmeasured.

The plan replaced both with `withGates({ transcripts: true, universe:
"interactive_or_unknown" })` ratio scorers consuming MAX-merged
session-coverage counts of posture commands (`/btw`, `/clear`, `/compact`,
`/rewind` for memory; `/color`, `/voice`, `/focus` for customization) over the
new `interactiveOrUnknownSessionsAnalyzed` denominator
(`sessionsByKind.interactive_cli + sessionsByKind.unknown`). This satisfies
the CLAUDE.md numerator-subset-of-denominator hard rule (PR #97). As of v0.9.18
all twelve dimensions have Execution scorers.

---

## Canonical record

The archived plan files are the full implementation record. Nothing in the
active plans directory refers to CCE-72 or CCE-76 after this archival.
