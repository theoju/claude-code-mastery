---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Decision: Credit `/ship` stage execution across journal format generations

**Ticket:** CCE-72 · **PR:** #113 · **Date:** 2026-06-01

## Problem

`gatherShipJournal` in `scripts/signals.mjs` matched only `entry.stage === legacyNumber` — the oldest of three journal format generations. Every entry in the `stages_run` array cohort was silently skipped. A live-environment survey found 52 Stage 3 (simplify) executions in a 14-day window that produced `simplifyCommandUses=0`, causing the `automation/simplify-skill` next-action to surface in the top-3 priority list despite the habit being fully adopted.

The false negative was invisible because `scanTranscriptInvocations` looks for literal `<command-name>/simplify</command-name>` markup. When `/ship` Stage 3 dispatches the `code-simplifier:code-simplifier` subagent it emits a `tool_use` block with `subagent_type` — not a slash-command marker — so transcript scanning credits zero regardless of how many times the stage ran. The verify-agent scorer (`shipVerifyStageRecent`) suffered the same gap.

## Journal format archaeology

An empirical survey of 194 entries in `~/.claude/ship/journal.jsonl` found three distinct format generations:

| Format generation | Field shape | Entry count |
|---|---|---|
| Oldest (singular) | `entry.stage` integer | 113 |
| Intermediate (legacy-numeric) | `entry.stages_run` array of integers | 80 (subset) |
| Latest (new-string) | `entry.stages_run` array of strings | (subset of 80) |
| Malformed / parse-skipped | — | 1 |

The existing reader matched only format 1. The entire `stages_run` cohort — roughly 41% of entries — was invisible to both the verify-agent and simplify counters.

## What changed

### `stageRanInEntry` pure helper (new export)

A new export in `scripts/signals.mjs` handles all three generations:

```js
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

`Array.prototype.includes` uses strict equality. The string `"3"` never matches the integer `3`, so the legacy-numeric and new-string detector arms are naturally disjoint — no defensive coercion needed.

The canonical stage-number / -name mapping is documented in the comment block directly above `stageRanInEntry` in `signals.mjs`:

| # | name | # | name |
|---|---|---|---|
| 0 | `pre-flight` | 4 | `code-review` |
| 1 | `test` | 5 | `commit` |
| 2 | `verify-agent` | 6 | `push-pr` |
| 3 | `simplify` | 7 | `jira-update` |

Future stages append to the end; the numeric detector arm stays stable.

### `gatherShipJournal` return shape

`gatherShipJournal` now returns `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`. Both new counters use `stageRanInEntry`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

`shipVerifyStageRecent` at `run-assessment.mjs` already reads `signals.shipJournal?.stage2Count` — it picks up the wider count automatically, no change to its consumer.

The VITEST guard and missing-file fallback both return `simplifyStageCount: 0` in their empty shapes so the projection layer's optional-chain stays valid under test.

### `simplifyCommandUses` MAX-merge

`run-assessment.mjs` MAX-merges the new `simplifyStageCount` into the `simplifyCommandUses` projection (the same pattern used for `/color` history in v0.9.16 / PR #96):

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

The optional-chain plus `?? 0` means a missing or unreadable journal falls back to zero — no new failure path at the projection layer.

### Lookback alignment

`gatherShipJournal` previously used a hardcoded 14-day window at the call site in `signals.mjs` while transcript signals used `insightsLookbackDays` (default 30). A MAX-merge across mismatched windows compares unlike numerators. The call site now passes `insightsLookbackDays` so both signal sources cover the same window. The function's `lookbackDays` parameter default stays 14 to avoid breaking callers that don't pass the option; only the production call site is widened.

## Score impact

No new probe-catalog entries, no new `signalsSummary` keys, no new `satisfiedWhen` predicates. The five machine-enforced header counts in the probe tracker stay at 75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 `signalsSummary` keys.

Two predicates flip true for users who invoke `/simplify` and the verify-agent through `/ship` rather than directly:

- `automation/simplify-skill` — exits the top-N priority list when `simplifyCommandUses >= 1` is now satisfied from journal evidence.
- `verification/ship-verify-stage-recent` — bumps the Verification Execution score modestly via the widened `stage2Count`.

Both directions correct false negatives. The predicate thresholds are unchanged.

Live verification at the author's environment confirmed: pre-PR `simplifyCommandUses=0` despite 52 journal Stage 3 entries; post-PR both counters are non-zero and `automation/simplify-skill` exits the top-10.

## Tests

17 new or widened tests in `scripts/__tests__/gather-ship-journal.test.mjs` cover all three format generations, mixed-format journals, lookback window enforcement for `simplifyStageCount`, and six pure-function sub-cases for `stageRanInEntry` directly. The type-strict negative — `{stages_run: ["3"]}` with target integer `3` → `false` — is an explicit case. The existing `"counts stage===2 entries within lookback window"` test passes unchanged (format 1 detection is case 1 in `stageRanInEntry`, preserved exactly).

## Convention added to CLAUDE.md

The `stageRanInEntry` pattern is now documented under `## Conventions`:

> Ship-journal counters use `stageRanInEntry()` to detect stage execution across all three journal format generations (singular `entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`). Adding a new stage counter follows this pattern — see CCE-72 / PR #113 for the reference implementation. The canonical stage-number / -name mapping lives inline in `scripts/signals.mjs::stageRanInEntry`.

## Out of scope

- Filtering the journal by branch or repo. Cross-repo simplify credit is correct; habit adoption is user-level.
- Extending `maxProbe` to accept a third source argument. The inline `Math.max` matches the v0.9.16 `/color` precedent and avoids over-generalizing for a targeted fix.
- Generic subagent dispatch detection from transcripts. The `/ship` journal is a cleaner, structured signal; scanning transcripts for `Task` tool_use blocks with `subagent_type: code-simplifier:code-simplifier` would surface every adversarial-review subagent dispatch as noise.
- New rubric next-actions for other `/ship` stages (code-review credit, push-pr credit). The gap was scoped to simplify and verify-agent.
