---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# `/ship` journal stage crediting across format generations

**CCE-72 · PR #113 · 2026-06-01**

## Problem

The dashboard's automation scorer was producing false negatives for users who run `/simplify` and the verify-agent *through `/ship`* rather than typing them directly.

`scanTranscriptInvocations` detects `/simplify` by scanning for the literal `<command-name>/simplify</command-name>` markup in session JSONL. `/ship` Stage 3 dispatches the `code-simplifier:code-simplifier` subagent via the Task/Agent tool, which emits a `tool_use` block with `subagent_type` — not a slash-command marker. So a user whose entire simplify ritual runs through `/ship` scored `simplifyCommandUses=0`, and `automation/simplify-skill` remained in the ranked next-actions despite being a deeply-adopted habit.

A second gap was deeper: `gatherShipJournal` read **only** `entry.stage === 2`. `~/.claude/ship/journal.jsonl` has three schema generations, and the old single-field check missed ~41% of entries.

## Three journal format generations

An empirical survey of a 194-entry `~/.claude/ship/journal.jsonl` found:

| Format generation | Field shape | Sample |
|---|---|---|
| **Oldest** (singular) | `entry.stage` (integer) | `{"ts":"…","stage":2}` |
| **Intermediate** (legacy-numeric) | `entry.stages_run` array of integers | `{"ts":"…","outcome":"shipped","stages_run":[0,1,2,3,4,5,6]}` |
| **Latest** (new-string) | `entry.stages_run` array of strings | `{"ts":"…","outcome":"shipped","stages_run":["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |

The old `entry.stage === 2` check covered only the oldest generation. Every entry that recorded completed stages in a `stages_run` array — both the numeric and string variants — was silently invisible.

## Solution: `stageRanInEntry`

PR #113 adds a small pure helper exported from `scripts/signals.mjs`:

```js
// Detects whether a /ship stage RAN, regardless of journal format generation.
// Three format generations exist in ~/.claude/ship/journal.jsonl:
//   1. entry.stage === legacyNumber            (oldest, single-stage entries)
//   2. entry.stages_run.includes(legacyNumber) (intermediate, numeric array)
//   3. entry.stages_run.includes(newName)      (latest, string-named array)
// Array.prototype.includes uses strict equality so a string "3" never
// matches the integer 3 — no defensive code needed.
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

Call it with the stage's numeric ID and its string name. `Array.includes` is type-strict, so the string `"3"` never matches the integer `3` — mixing the two generation formats in one journal file is safe.

### Canonical stage mapping

| # | Name | Notes |
|---|---|---|
| 0 | `pre-flight` | |
| 1 | `test` | |
| 2 | `verify-agent` | CCE-72 consumer |
| 3 | `simplify` | CCE-72 consumer |
| 4 | `code-review` | |
| 5 | `commit` | |
| 6 | `push-pr` | |
| 7 | `jira-update` | |

New `/ship` stages append to the end of this list — never insert in the middle — so the numeric detector arm stays stable.

## Updated `gatherShipJournal`

`gatherShipJournal` now counts both Stage 2 (verify-agent) and Stage 3 (simplify) using the helper, and returns a `simplifyStageCount` alongside the existing `stage2Count`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify"))     simplifyStageCount++;
```

Return shape: `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`.

The VITEST guard and the missing-file fallback both return `simplifyStageCount: 0` alongside the existing zeros so downstream consumers don't need null-checks.

## Lookback alignment

The production call site at `scripts/signals.mjs` previously hardcoded `{ lookbackDays: 14 }` while transcript-derived signals used `insightsLookbackDays` (default 30). A MAX-merge comparing a 14-day journal window against a 30-day transcript window was comparing unlike numerators.

The call site now passes `insightsLookbackDays`:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's parameter default stays `14` — no breaking change for tests or other callers — but the one production caller is now aligned.

## MAX-merge projection

At the `buildSignalsSummary` projection boundary in `scripts/run-assessment.mjs`, `simplifyCommandUses` is MAX-merged from three sources:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),   // transcript + history.jsonl
  signals.shipJournal?.simplifyStageCount ?? 0, // journal Stage 3
),
```

`maxProbe` takes the higher of the transcript scan and the `~/.claude/history.jsonl` scan. The outer `Math.max` lifts it further if the journal shows more Stage 3 executions. The inline form follows the precedent from v0.9.16 (the `/color` history MAX-merge, PR #96) — `maxProbe` is not extended for this single-use case.

`shipVerifyStageRecent` at line 109 is unchanged in shape:

```js
shipVerifyStageRecent: signals.shipJournal?.stage2Count ?? 0,
```

It automatically picks up the widened `stage2Count` without any further change.

## Tests

Seven new test cases in `scripts/__tests__/gather-ship-journal.test.mjs` cover each detection arm:

- **Tests 1–3**: each format generation detected individually for simplify and verify-agent.
- **Test 4**: a mixed-format journal (one entry per generation) sums correctly across all three.
- **Test 5**: regression guard — the original singular `stage===2` path still counts.
- **Test 6**: entries outside the lookback window are excluded for both counters.
- **Test 7** (sub-describe `stageRanInEntry`): six pure-function cases including the type-strict negative (`stages_run: ["3"]` does not match integer `3`) and the falsy-but-valid `stage: 0` pre-flight case.

## Score impact

Two predicates flip true for users who use `/ship` but whose journal entries were in the invisible cohort:

- `automation/simplify-skill` — exits the ranked next-actions once `simplifyCommandUses >= 1` is satisfied by journal evidence.
- `verification/ship-verify-stage-recent` — the Verification execution score rises modestly as `stage2Count` reflects the full journal history.

Both directions are corrections, not new signal: the scorer was producing false negatives. No new probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen` predicates were added; the five machine-enforced tracker-counts header values (`75/12/48/47/71`) are unchanged.

## Adding new stage counters

When `/ship` gains a new stage and you want to score it:

1. Add the stage to the canonical table above (appending, not inserting).
2. Call `stageRanInEntry(entry, stageNumber, "stage-name")` inside the `gatherShipJournal` loop — one line per counter.
3. Add `newStageCount: 0` to the VITEST guard and missing-file fallback in `gatherShipJournal`.
4. MAX-merge or forward the counter in `buildSignalsSummary` at `scripts/run-assessment.mjs`.
5. Write a fixture test that covers all three format generations for the new stage.

CCE-72 / PR #113 is the reference implementation for this pattern.
