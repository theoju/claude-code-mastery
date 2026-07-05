---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Crediting `/ship` stage execution across journal format generations

`~/.claude/ship/journal.jsonl` is an append-only log that has quietly evolved
its schema across three generations since the `/ship` slash command shipped:

| Generation                        | Field shape                          | Sample                                                                                                                                 |
| ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Oldest** (singular)               | `entry.stage` (integer)               | `{ts, stage: 1}`                                                                                                                        |
| **Intermediate** (legacy-numeric)  | `entry.stages_run` array of integers  | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`                                                                                 |
| **Latest** (new-string)            | `entry.stages_run` array of strings   | `{ts, outcome: "shipped", stages_run: ["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |

`gatherShipJournal` in `scripts/signals.mjs` only ever matched `entry.stage
=== 2` — the oldest format. On a real 194-entry journal survey, that generation
accounted for 113 entries; the other 80 (the entire `stages_run` cohort) were
silently invisible to the scorer. Concretely: a user who runs `/ship` on every
PR and gets Stage 3 (simplify) and Stage 2 (verify-agent) dispatched as
subagents every time still scored `simplifyCommandUses=0`, because those
dispatches never emit the `<command-name>/simplify</command-name>` transcript
marker that `scanTranscriptInvocations` looks for — they show up only in the
journal. The false negative surfaced the `automation/simplify-skill`
next-action as a top-priority "go adopt this" recommendation for someone who
had already adopted it as a deeply-integrated habit.

## The fix

`scripts/signals.mjs` now exports a small pure helper, `stageRanInEntry(entry,
legacyNumber, newName)`, that checks all three formats in order:

1. `entry.stage === legacyNumber` (oldest)
2. `entry.stages_run.includes(legacyNumber)` (intermediate)
3. `entry.stages_run.includes(newName)` (latest)

`Array.prototype.includes` is strict-equality, so a string `"3"` in a
`stages_run` array never accidentally matches the integer `3` — no extra
type-guarding needed. `gatherShipJournal` calls this once per entry for stage
2 (`stage2Count`, feeding the existing `shipVerifyStageRecent` predicate) and
once for stage 3 (`simplifyStageCount`, a new counter). Both benefit
automatically: `shipVerifyStageRecent` was undercounted for *everyone* who
shipped since the schema moved past the singular format, not just for the
simplify case that surfaced the bug.

At the projection layer, `run-assessment.mjs` now folds the journal signal
into the existing transcript/history-derived counter rather than replacing
it:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This is the same MAX-merge shape used elsewhere for side-channel commands
(e.g. `/btw` via `history.jsonl`) — a new source can only raise the count
toward the truth, never regress it below what the transcript scanner already
found.

## Lookback alignment, as a second fix bundled in

`gatherShipJournal`'s `lookbackDays` parameter defaulted to `14`, a leftover
from before the Execution axis standardized on a configurable
`insightsLookbackDays` (30 by default). The production call site in
`gatherSignals` hardcoded `{ lookbackDays: 14 }` while every transcript-derived
signal in the same run used the wider, configurable window — a mismatch that
would silently compare unlike numerators if a rubric predicate ever combined
journal- and transcript-derived counts over different windows. The call site
now passes `insightsLookbackDays` through, so journal-derived signals
(`stage2Count`, `simplifyStageCount`, `totalRuns`) share the same window as
everything else scored on the Execution axis. The function's own default
stays `14` — nothing else calls it, and tests pin their own explicit window.

## What this does and doesn't change

- No new probes, `probe-catalog.json` entries, or `signalsSummary` keys were
  added — this is a correctness fix to two existing counters
  (`shipVerifyStageRecent`, `simplifyCommandUses`), not new surface area.
- `shipsRecent` (from `entry.outcome === "shipped"`) is unaffected by the
  format-detection change, but does inherit the wider lookback window as a
  side effect of the call-site fix — also desirable, since it's the same kind
  of adoption-over-time signal.
- Singular `entry.stage` entries with no `outcome` field (partial-progress
  markers from older `/ship` runs, 113 of the 194 surveyed) are still treated
  as evidence the stage ran. That's the conservative-but-correct read: the
  stage executed even if the run didn't reach a final `shipped`/`halted`
  outcome.
- The canonical stage-number ↔ stage-name mapping (`0 pre-flight … 7
  jira-update`) now lives as a comment next to `stageRanInEntry` in
  `scripts/signals.mjs`. Future `/ship` stages are expected to append to the
  end of that list rather than insert in the middle — the numeric detector
  arm would silently miscount stage identity under a renumbering.

Covered by `scripts/__tests__/gather-ship-journal.test.mjs`, which exercises
each format generation individually, a mixed-format journal, the lookback
boundary, and `stageRanInEntry` itself as a pure function (including the
type-strict `"3"` vs `3` negative case).
