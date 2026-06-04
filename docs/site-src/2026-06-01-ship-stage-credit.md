---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# `/ship` stage credit — CCE-72

PR #113 fixes a silent scoring blind-spot: users who fully integrate `/ship` into their workflow showed `simplifyCommandUses=0` and `shipVerifyStageRecent=0` even when they'd run those stages dozens of times. Two layered omissions in `gatherShipJournal` caused it — a format-coverage gap and a false-negative for subagent-dispatched stages.

## The three journal formats

`/ship` writes its execution record to a state file under `~/.claude/skills/ship/state/`, but the schema has evolved across releases. Three generations exist in the wild:

| Generation | Shape | When written |
| --- | --- | --- |
| Oldest | `{ stage: 2 }` — singular integer field | Early `/ship` versions |
| Intermediate | `{ stages_run: [2, 3] }` — numeric array | Mid-generation schema |
| Latest | `{ stages_run: ["verify-agent", "simplify"] }` — string-named array | Current schema |

In the author's own log, 113 of 194 entries were in the oldest singular format. The pre-CCE-72 reader only checked `entry.stage === 2`, which means it silently skipped roughly **41%** of journal history before even touching the string-name generation.

## What was miscounted

Two signals were affected:

- **`simplifyCommandUses`** — counts Stage 3 (simplify) runs. `scanTranscriptInvocations` looks for `<command-name>/simplify</command-name>` markup, which is absent when simplify runs as a subagent dispatched by `/ship`. The journal is the only reliable signal for subagent-dispatched stage execution; missing the older formats silently zeroed it out.
- **`shipVerifyStageRecent`** — counts Stage 2 (verify-agent) runs. Same problem: the verify-agent subagent dispatch leaves no slash-command markup in the transcript; only the journal carries the execution record.

For users who adopted `/ship` and then shipped through the schema transition, both signals read `0`. The scorer dutifully surfaced `automation/simplify-skill` as a high-priority gap for people who were already doing it every day.

## The fix: `stageRanInEntry()`

`scripts/signals.mjs` now exports `stageRanInEntry(entry, stageNumber)`, a format-aware helper that checks all three journal generations in one place. It handles the oldest singular-integer form, the numeric-array form, and the current string-name-array form — resolving numeric stage IDs to their canonical names (`2 → "verify-agent"`, `3 → "simplify"`, etc.) so all three match without separate code paths.

`gatherShipJournal` now calls `stageRanInEntry(entry, 2)` and `stageRanInEntry(entry, 3)` instead of testing `entry.stage` directly. The stage-number-to-name mapping is authoritative: stages 0–7 are `pre-flight`, `test`, `verify-agent`, `simplify`, `code-review`, `commit`, `push-pr`, `jira-update` — inline in `signals.mjs::stageRanInEntry`.

The CLAUDE.md conventions block documents the pattern:

> **Ship-journal counters use `stageRanInEntry()` to detect stage execution across all three journal format generations.** Adding a new stage counter follows this pattern — see CCE-72 / PR #113 for the reference implementation.

## Files changed

| File | Change |
| --- | --- |
| `scripts/signals.mjs` | `stageRanInEntry()` helper; `gatherShipJournal` uses it for stages 2 and 3 |
| `scripts/run-assessment.mjs` | Updated to thread the corrected counters |
| `scripts/__tests__/gather-ship-journal.test.mjs` | New tests covering all three format generations |
| `scripts/__tests__/build-signals-summary.test.mjs` | Updated fixture expectations |
| `docs/superpowers/specs/` | Design spec for format normalization |
| `docs/superpowers/plans/` | Implementation plan |
| `CLAUDE.md` | Convention block for `stageRanInEntry()` |

No breaking changes — `gatherShipJournal`'s output shape is unchanged; the counters are now correct rather than silently low.

## Effect on your scores

If you use `/ship` and ship frequently, you may see `simplifyCommandUses` and `shipVerifyStageRecent` jump upward after upgrading. That's not a regression — it's the counts becoming accurate. Your verification and automation Execution scores will reflect real usage for the first time.

If `simplifyCommandUses` stays at `0` after the fix, you likely haven't authored Stage 3 into your `/ship` command yet, or you're passing `--no-simplify` by default. See [`docs/site-src/ship-pattern.md`](./ship-pattern.md) for the stage table and
[`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-09-ship-slash-command-design.md) for the full implementation spec.
