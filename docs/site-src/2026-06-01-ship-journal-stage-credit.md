---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit across format generations (CCE-72, PR #113)

**Date:** 2026-06-01  
**Ticket:** [CCE-72](https://designitright.atlassian.net/browse/CCE-72)  
**Status:** Shipped

## Problem

Users who invoke the verify-agent (Stage 2) and simplify (Stage 3) through `/ship` were scoring `shipVerifyStageRecent=0` and `simplifyCommandUses=0` even when those stages ran on every PR. As a result, the `automation/simplify-skill` next-action appeared in their top-3 priority list as an unmet gap — despite being a deeply-adopted habit.

The root cause was format-generation drift in `~/.claude/ship/journal.jsonl`. Three co-existing schemas accumulated as `/ship` evolved:

| Format generation | Field shape | Count in author's 194-entry journal |
| --- | --- | --- |
| **Oldest** (singular) | `entry.stage` (integer) | 113 entries |
| **Intermediate** (legacy-numeric) | `entry.stages_run` array of integers | 80 entries |
| **Latest** (new-string) | `entry.stages_run` array of strings | subset of the 80 |

The existing `gatherShipJournal` in `scripts/signals.mjs` read only `entry.stage === 2`, silently missing ~41% of the journal (the entire `stages_run` cohort). The existing test file only exercised the oldest format, so the gap never surfaced in CI.

A compounding factor: `scanTranscriptInvocations` counts literal `<command-name>/simplify</command-name>` markers. `/ship` Stage 3 dispatches `code-simplifier:code-simplifier` as a subagent via the `Task/Agent` tool — that path emits a `tool_use` block with `subagent_type`, not a slash-command marker. So transcript-based counting produces zero even when `/simplify` runs on every PR through `/ship`.

## Decision

### `stageRanInEntry` — one helper for all three format generations

A pure exported helper at `scripts/signals.mjs` collapses detection into a single strict-equality check:

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

`Array.prototype.includes` is type-strict: the string `"3"` never matches the integer `3`. No additional defensive code is needed. The function is safe to call with null, undefined, or missing fields — it returns `false` without throwing in all edge cases (confirmed by the `stageRanInEntry` test suite in `scripts/__tests__/gather-ship-journal.test.mjs`).

The canonical stage-number/name mapping (new stages must append to the end, never insert):

| # | name |
| --- | --- |
| 0 | `pre-flight` |
| 1 | `test` |
| 2 | `verify-agent` |
| 3 | `simplify` |
| 4 | `code-review` |
| 5 | `commit` |
| 6 | `push-pr` |
| 7 | `jira-update` |

### `gatherShipJournal` — widened counters and lookback

`gatherShipJournal` now:

- Returns `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }` (added `simplifyStageCount`).
- Uses `stageRanInEntry(entry, 2, "verify-agent")` and `stageRanInEntry(entry, 3, "simplify")` per line, replacing the old `entry.stage === 2` literal check.
- The VITEST guard and missing-file fallback both include `simplifyStageCount: 0` so tests can't inadvertently read the developer's real journal.
- The production call site in `scripts/signals.mjs` now passes `insightsLookbackDays` (default 30) instead of the hardcoded `14`. The function's parameter default stays 14 so other callers aren't affected.

### MAX-merge into `simplifyCommandUses`

At the projection layer in `scripts/run-assessment.mjs`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This mirrors the v0.9.16 `/color` history MAX-merge pattern. `maxProbe` is unchanged — extending it for a one-off merge would over-generalize. The optional-chaining + `?? 0` means a missing or unreadable journal gracefully contributes zero. `shipVerifyStageRecent` at `run-assessment.mjs` line 121 is unchanged — it already reads `signals.shipJournal?.stage2Count`, which now reflects the widened detection automatically.

## Data flow

```
~/.claude/ship/journal.jsonl
  (three co-existing format generations)
        │
        ▼
parseJournalLine  →  skip silently on malformed lines
        │
        ▼
gatherShipJournal({ lookbackDays: insightsLookbackDays })
  per entry within window:
    stage2Count++         if stageRanInEntry(entry, 2, "verify-agent")
    simplifyStageCount++  if stageRanInEntry(entry, 3, "simplify")
    totalRuns++           if outcome === "shipped"
        │
        ▼
run-assessment.mjs projection
  simplifyCommandUses = max(transcript, history, journal.simplifyStageCount)
  shipVerifyStageRecent  ← journal.stage2Count  (consumer unchanged)
  shipsRecent            ← journal.totalRuns    (consumer unchanged)
        │
        ▼
rubric satisfiedWhen predicates  (unchanged)
  automation/simplify-skill: simplifyCommandUses >= 1
```

## Tests

13 new tests across two describes in `scripts/__tests__/gather-ship-journal.test.mjs`:

**`gatherShipJournal` fixture tests (Tests 1–6)** — each writes a temp `journal.jsonl` via `mkdtempSync`/`writeFileSync` and asserts counter values:

- Test 1: singular `{stage: 3}` → `simplifyStageCount === 1`, `stage2Count === 0`.
- Test 2: legacy-numeric `stages_run: [0,1,2,3,4,5,6,7]` → both `stage2Count === 1` and `simplifyStageCount === 1`.
- Test 3: new-string `stages_run: ["pre-flight","test","verify-agent","simplify",...]` → both `stage2Count === 1` and `simplifyStageCount === 1`.
- Test 4: three lines mixing all three formats → `stage2Count === 2`, `simplifyStageCount === 2`.
- Test 5 (regression): two singular `stage===2` lines → `stage2Count === 2`, `simplifyStageCount === 0`.
- Test 6: one entry 45 days ago, one 5 days ago, cutoff at 30 days → `simplifyStageCount === 1`.

**`stageRanInEntry` pure-function tests (7 cases)** — no file I/O:

- `{stage: 3}` matches `(3, "simplify")` → `true`.
- `{stage: 0}` matches `(0, "pre-flight")` → `true` (guards against future truthy-check refactor on a falsy zero).
- `{stage: 99}` does not match `(3, "simplify")` → `false`.
- `{stages_run: [0,1,3,4]}` matches `(3, "simplify")` → `true`.
- `{stages_run: ["test","verify-agent","simplify"]}` matches `(3, "simplify")` → `true`.
- `{stages_run: ["3"]}` does not match `(3, "simplify")` → `false` (type-strict).
- `null`, `undefined`, non-object, `{}`, `{stages_run: "not-an-array"}` all return `false` without throwing.

## Blast radius

- **No new probes, catalog entries, or `signalsSummary` keys.** The five machine-enforced header counts in the probe-implementation-status tracker stay at **75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 `signalsSummary` keys**. `tracker-counts.test.mjs` passes unchanged.
- **Score deltas** for users who `/ship` regularly: `automation/simplify-skill` exits the top-10 next-actions (predicate now satisfied); `verification` Execution score rises modestly where `shipVerifyStageRecent` was previously zero.
- **Lookback widening** (14 → 30 days) also benefits `shipsRecent>=1` — an adoption check that correctly reads a wider window.
- **I/O unchanged.** The journal is already read once per assessment; `stageRanInEntry` adds an O(n) `Array.includes` over `stages_run.length ≤ 8` per line — negligible against the existing JSON.parse budget.

## Convention added to CLAUDE.md

The PR codifies the multi-generation detection pattern as a Conventions entry:

> **Ship-journal counters use `stageRanInEntry()` to detect stage execution across all three journal format generations** (singular `entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`). Adding a new stage counter follows this pattern — see CCE-72 / PR #113 for the reference implementation. The canonical stage-number / -name mapping lives inline in `scripts/signals.mjs::stageRanInEntry`.

## What was ruled out

- **Scanning transcripts for `Task` tool_use blocks** with `subagent_type: code-simplifier:code-simplifier`. The journal is a cleaner, structured signal; generic subagent detection would also surface every unrelated subagent dispatch as noise.
- **Extending `maxProbe` to accept a third source.** The inline `Math.max` is clearer and avoids over-generalizing a helper for one use case.
- **Per-repo journal filtering.** Cross-repo simplify usage (engineering-docs-agent, etc.) is correctly credited as habit adoption.
- **Detecting other `/ship` stages** (code-review credit, push-pr credit). The gap was specifically verify-agent and simplify; the rest are out of scope until a concrete false-negative surfaces.
