---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Decision: Credit /ship stage execution across journal format generations (CCE-72, PR #113)

**Ticket:** CCE-72 · **Shipped:** 2026-06-01 · **Related:** PR #110 (per-command partition, exposed the false negative), PR #96 (v0.9.16 `/color` history MAX-merge — architectural precedent)

## Problem

Users who route `/simplify` and the verify-agent through `/ship` (Stages 3 and 2 respectively) were silently scoring `simplifyCommandUses = 0`. The `automation/simplify-skill` next-action appeared in the top-N priority list even for engineers who invoke simplify on every PR — because the scorer only read one of the three journal format generations that `~/.claude/ship/journal.jsonl` actually contains.

Live evidence from the dashboard author's environment (post PR #110, 30-day lookback):

- `simplifyCommandUses` (transcripts ∪ history MAX-merge): **0**
- Journal entries where Stage 3 (simplify) ran in the lookback window: **52**

The verify-agent scorer (`shipVerifyStageRecent`) had the same gap.

## Root cause — three format generations, one reader

An empirical survey of 194 journal entries found three distinct schemas in the wild:

| Format | Field shape | Count | Example |
|--------|-------------|------:|---------|
| Oldest (singular) | `entry.stage` (integer) | 113 | `{"ts":"…","stage":2}` |
| Intermediate (legacy-numeric) | `entry.stages_run` array of integers | 80 | `{"ts":"…","outcome":"shipped","stages_run":[0,1,2,3,4,5,6]}` |
| Latest (new-string) | `entry.stages_run` array of strings | subset of 80 | `{"ts":"…","outcome":"shipped","stages_run":["verify-agent","simplify","commit"]}` |

The existing `gatherShipJournal` checked only `entry.stage === 2`, hitting 113 entries and missing ~41% of the cohort (the entire `stages_run` population). The prior test suite exercised only the singular format, so the gap never surfaced.

## Fix

Three code changes in `scripts/signals.mjs` and one in `scripts/run-assessment.mjs`.

### 1. `stageRanInEntry` pure helper

A new exported function at `scripts/signals.mjs` (lines 536–544) collapses all three detection arms into a single `Array.prototype.includes` lookup:

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

`Array.includes` uses strict equality, so the string `"3"` never accidentally matches the integer `3`. No defensive branching needed — the format distinction is type-inherent.

The canonical stage-number / name mapping (new stages must append, never insert):

| # | name | |
|---|------|-|
| 0 | `pre-flight` | |
| 1 | `test` | |
| 2 | `verify-agent` | consumed here |
| 3 | `simplify` | consumed here |
| 4 | `code-review` | |
| 5 | `commit` | |
| 6 | `push-pr` | |
| 7 | `jira-update` | |

### 2. `gatherShipJournal` updated counters

`gatherShipJournal` now calls `stageRanInEntry` for both stages and returns a new `simplifyStageCount` field:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify"))     simplifyStageCount++;
```

Return shape: `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`. The VITEST guard and the missing-file fallback both include `simplifyStageCount: 0` in their zero-returns so downstream consumers don't see `undefined`.

`shipVerifyStageRecent` at `run-assessment.mjs` already reads `signals.shipJournal?.stage2Count` — it picks up the wider count automatically without a projection change.

### 3. Lookback alignment

The journal lookback was hardcoded at 14 days at the call site while transcripts used `insightsLookbackDays` (default 30). A MAX-merge across mismatched windows compares unlike numerators. The production call site now passes `insightsLookbackDays`:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's parameter default stays at 14 for any other caller (no breaking change).

### 4. MAX-merge into `simplifyCommandUses`

At `scripts/run-assessment.mjs` lines 130–133, mirroring the v0.9.16 `/color` history pattern:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

The optional-chaining + `?? 0` means a missing or unreadable journal file gracefully contributes zero. `maxProbe` itself is unchanged.

## Data flow

```
~/.claude/ship/journal.jsonl
  (mixed generations: 113 singular + 80 stages_run + 1 malformed)
        │
        ▼
gatherShipJournal({ lookbackDays: insightsLookbackDays })
  for each in-window entry:
    stage2Count++         if stageRanInEntry(entry, 2, "verify-agent")
    simplifyStageCount++  if stageRanInEntry(entry, 3, "simplify")
        │
        ▼
buildSignalsSummary (run-assessment.mjs)
  simplifyCommandUses   = max(transcript, history, journal.simplifyStageCount)
  shipVerifyStageRecent = journal.stage2Count       (unchanged consumer)
        │
        ▼
rubric satisfiedWhen predicates  (unchanged)
  automation/simplify-skill:          simplifyCommandUses >= 1
  verification/ship-verify-stage-recent: shipVerifyStageRecent >= 1
```

## Test coverage

Seventeen new unit tests in `scripts/__tests__/gather-ship-journal.test.mjs` cover:

- **Tests 1–6 (journal-fixture):** singular `entry.stage === 3`, legacy-numeric `stages_run: [0,1,2,3]`, new-string `stages_run: ["verify-agent","simplify",…]`, mixed-format sum, regression guard (singular stage===2 still counts), and lookback-window exclusion.
- **Test 7 — `stageRanInEntry` pure-function cases (7 sub-cases):** each detector arm, the Stage 0 falsy-but-valid guard (protects against a future `if (entry.stage)` truthy-check regression), type-strict integer/string negative, and null/non-object/missing-fields input without throwing.

All pre-existing `gather-ship-journal.test.mjs` tests pass unchanged.

## Probe-tracker impact

No new probes, no new catalog entries, no new `signalsSummary` keys. The five machine-enforced header counts in `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` stay at 75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys. A footnote was added to the `shipVerifyStageRecent` (Settings/Journal layer) and `simplifyCommandUses` (Transcripts layer) rows documenting the widened detection.

## Score impact

Two predicates flip `true` for users who route these stages through `/ship` but rarely type the slash commands directly:

- `automation/simplify-skill` exits the top-N next-actions (its predicate is now satisfied).
- `verification/ship-verify-stage-recent` bumps the Verification Execution score modestly.

Both directions are corrections of false negatives, not regressions.

## Out of scope

- Per-repo journal filtering (cross-repo habit adoption is correctly credited).
- Generic subagent-dispatch detection from transcripts (the journal is a cleaner structured source; scanning `Task` tool_use blocks for `subagent_type` would add noise from other agents).
- New rubric next-actions for other `/ship` stages (code-review credit, push-pr credit, etc.).
- Extending `maxProbe` to accept a third source argument (the inline `Math.max` is clearer for a one-off MAX-merge).
