---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# Ship journal stage credit — PR #113

Fixes a silent false-negative in the `/ship` journal reader that caused
`simplifyCommandUses` to score as 0 even for users who run `/ship` daily.

## What was broken

`gatherShipJournal` in `scripts/signals.mjs` only read `entry.stage === 2` —
the oldest single-field format. Two later journal formats (`stages_run` as a
numeric array, `stages_run` as a string array) were never parsed, meaning
roughly 41% of journal entries produced no signal at all. If your journal grew
up with the tool, most of your Stage 2 (verify-agent) and Stage 3 (simplify)
credits were silently dropped.

The downstream effect: the `automation/simplify-skill` next-action appeared
unsatisfied in the ranked top-N even for engineers who had Stage 3 deeply
integrated into their workflow.

## What changed

**`stageRanInEntry(entry, legacyNumber, newName)`** — a pure helper added to
`scripts/signals.mjs` — normalises detection across all three format
generations:

| Format generation          | Shape                                    | Was read? |
| -------------------------- | ---------------------------------------- | --------- |
| Original (oldest)          | `entry.stage === <number>`               | ✅ before  |
| Legacy stages\_run         | `entry.stages_run: number[]`             | ❌ before  |
| Current stages\_run        | `entry.stages_run: string[]`             | ❌ before  |

All three are now handled by the single helper. Every call-site that previously
checked `entry.stage === 2` now calls `stageRanInEntry(entry, 2, "verify")` (or
`3, "simplify"`), so adding a new stage in the future is a one-liner.

A new `simplifyStageCount` counter is MAX-merged with `simplifyCommandUses` in
`run-assessment.mjs`, keeping the predicate contract stable — no scorer rules
changed, the five probe-tracker header counts remain 75 / 12 / 48 / 47 / 71.

## Lookback alignment

The journal reader previously used a hard-coded 14-day lookback. It now reads
`insightsLookbackDays` (default 30), matching the transcript-derived signal
window. If you pass `--insights-lookback 60` to `npm run assess`, the journal
scan uses the same window.

## Impact

Score deltas depend on your history. On environments where Automation and
Verification are already saturated the numbers won't move. On environments
where Stage 3 was firing but unread, `simplifyCommandUses` will jump from 0 to
its real value, and the `automation/simplify-skill` next-action will correctly
drop out of the ranked top-N.

The fix is in `scripts/signals.mjs::stageRanInEntry` and the MAX-merge at
`run-assessment.mjs`. The CLAUDE.md Conventions section and the probe-tracker
spec (`docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`)
were updated in the same PR.
