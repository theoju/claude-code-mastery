---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Decision: Credit /ship stage execution across journal format generations

**Ticket:** CCE-72 · **PR:** #113 · **Date:** 2026-06-01

## Problem

`gatherShipJournal` in `scripts/signals.mjs` previously detected verify-agent runs with a single condition:

```js
if (entry.stage === 2) stage2Count++;
```

That matches only the oldest journal format generation. A survey of the author's 194-entry `~/.claude/ship/journal.jsonl` found three distinct formats produced across the tool's history:

| Generation | Field shape | Entry count |
| --- | --- | --- |
| Oldest (singular) | `entry.stage` (integer) | 113 |
| Intermediate (legacy-numeric) | `entry.stages_run` array of integers | 80 |
| Latest (new-string) | `entry.stages_run` array of strings | ~subset of 80 |
| Malformed | parse-skipped | 1 |

The original check matched **only** the oldest 113 entries — roughly 59% of the journal. The entire `stages_run` cohort was silently skipped, meaning ~41% of stage executions went uncredited.

The effect was user-visible and misleading: a developer with `/ship` deeply integrated, running simplify and verify-agent on every PR, would see `simplifyCommandUses=0` and `automation/simplify-skill` appear as a top-N next-action despite the habit being fully adopted.

## Root cause: scanner matched only one of three schema shapes

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` detects `/simplify` via the literal `<command-name>simplify</command-name>` markup in transcript JSONL. `/ship` Stage 3 dispatches the `code-simplifier` subagent via the Task/Agent tool, which emits a `tool_use` block — not a slash-command marker. So transcript scanning always returns 0 for users who invoke simplify through `/ship`.

The journal was the correct signal source. But it was only half-read.

## Decision

Introduce a pure helper `stageRanInEntry(entry, legacyNumber, newName)` that detects stage execution across all three format generations in one place, then use it consistently throughout `gatherShipJournal`.

```js
// scripts/signals.mjs
export function stageRanInEntry(entry, legacyNumber, newName) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.stage === legacyNumber) return true;
  const sr = entry.stages_run;
  if (Array.isArray(sr)) {
    return sr.includes(legacyNumber) || sr.includes(newName);
  }
  return false;
}
```

`Array.prototype.includes` uses strict equality, so a string `"3"` in a legacy-numeric array never accidentally matches the integer `3`. No defensive casting needed.

The canonical stage-number / stage-name mapping (append-only; new stages go to the end, never inserted in the middle):

| # | Name |
| --- | --- |
| 0 | `pre-flight` |
| 1 | `test` |
| 2 | `verify-agent` |
| 3 | `simplify` |
| 4 | `code-review` |
| 5 | `commit` |
| 6 | `push-pr` |
| 7 | `jira-update` |

## Changes

**`scripts/signals.mjs` — `gatherShipJournal`**

The per-entry detection loop now uses `stageRanInEntry` for both verify-agent and simplify, and returns a `simplifyStageCount` field alongside the existing `stage2Count`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

Return shape: `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`.

The Vitest skip-guard and missing-file fallback both include `simplifyStageCount: 0` so downstream consumers never see `undefined`.

**`scripts/signals.mjs` — call site lookback**

The production call site previously hardcoded `{ lookbackDays: 14 }` while transcript signals used `insightsLookbackDays` (default 30). Mixing those two windows in a MAX-merge compares unlike numerators. The call site now receives `insightsLookbackDays`:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's parameter default stays `14` so tests that don't pass `lookbackDays` are unaffected.

**`scripts/run-assessment.mjs` — projection layer MAX-merge**

`simplifyCommandUses` is now the maximum across three sources — transcript scanner, history file, and journal stage count:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This mirrors the v0.9.16 `/color` pattern (PR #96): a third source MAX-merged at the projection boundary rather than by extending `maxProbe` itself. Optional chaining + `?? 0` means a missing `shipJournal` (unreadable file) gracefully reads zero.

`shipVerifyStageRecent` is unchanged — it already reads `signals.shipJournal?.stage2Count`, which now reflects the widened detection automatically.

## What this does not change

- No new probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen` predicates. The five machine-enforced header counts in the probe tracker remain at 75 / 12 / 48 / 47 / 71.
- `shipVerifyStageRecent`'s predicate and scoring path are untouched.
- `maxProbe` is not extended — the inline `Math.max` is the right scope for a one-off projection.
- No journal entries are filtered by repo or branch. Cross-repo `/ship` runs (e.g., from the engineering-docs-agent worktree) correctly count toward habit adoption — the scorer measures whether the habit exists, not where it fires.

## Tests

Seven new test cases in `scripts/__tests__/gather-ship-journal.test.mjs`, covering all three format generations individually, mixed-format sums, lookback window exclusion, and the regression that singular `entry.stage === 2` still counts. A separate `describe("stageRanInEntry")` block exercises the pure function directly — including the type-strict edge case where `stages_run: ["3"]` must not match the integer `3`, and the falsy-but-valid `stage: 0` case that guards against a future `if (entry.stage)` truthy-check refactor. All existing tests pass unchanged.

## Score effect

Two predicates flip true for users who routinely run `/ship` but rarely type `/simplify` or `/verify` directly:

- `automation/simplify-skill`: exits the top-N next-actions once the predicate is satisfied.
- `verification/ship-verify-stage-recent`: Verification Execution score increases modestly.

Both directions are corrections, not regressions. The scorer was producing false negatives.

## Convention established

The `stageRanInEntry` pattern is now documented in CLAUDE.md under `## Conventions`:

> Ship-journal counters use `stageRanInEntry()` to detect stage execution across all three journal format generations. Adding a new stage counter follows this pattern — see CCE-72 / PR #113. The canonical stage-number / -name mapping lives in `scripts/signals.mjs::stageRanInEntry`.

Any future `/ship` stage that needs its own counter — code-review credit, push-pr credit, and so on — should call `stageRanInEntry(entry, <N>, "<name>")` rather than re-implementing the three-way detection.
