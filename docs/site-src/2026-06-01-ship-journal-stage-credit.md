---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Decision: credit `/ship` stage execution across journal format generations (CCE-72)

**PR #113 · CCE-72 · shipped 2026-06-01**

## The problem

`gatherShipJournal` in `scripts/signals.mjs` was reading only `entry.stage === 2`
— the oldest journal format, where each line records a single stage number.
That left ~41% of journal entries unread: the entire `stages_run` cohort, which
appeared once the journal schema evolved to record all stages run per shipping
session as an array.

Concrete evidence from the dashboard author's environment (30-day window, post
PR #110):

| Signal | Value |
| --- | --- |
| `simplifyCommandUses` (transcripts ∪ history MAX-merge) | **0** |
| Stage 3 (simplify) runs in `~/.claude/ship/journal.jsonl` (14-day window) | **52** |
| Result | `automation/simplify-skill` appeared in top-3 next-actions despite being a deeply-adopted habit |

The verify-agent counter (`stage2Count` → `shipVerifyStageRecent >= 1`) had the
same gap. Bundling both fixes was mandatory: the root cause — format-blind stage
detection — was identical.

### Why transcripts don't capture `/ship` stage invocations

`scanTranscriptInvocations` looks for literal `<command-name>/simplify</command-name>`
markup. `/ship` Stage 3 dispatches the `code-simplifier:code-simplifier` subagent
via the Task/Agent tool, which emits a `tool_use` block with `subagent_type` —
not a slash-command marker. So transcript scanning produces 0 for every user who
exclusively invokes simplify through `/ship`.

### Journal format archaeology

An empirical survey of the author's 194-entry journal revealed three format
generations living side-by-side:

| Generation | Field shape | Entry count | Example |
| --- | --- | --- | --- |
| Oldest (singular) | `entry.stage` (integer) | 113 | `{"ts":"…","stage":2}` |
| Intermediate (legacy-numeric) | `entry.stages_run` (integer array) | 80 | `{"ts":"…","outcome":"shipped","stages_run":[0,1,2,3,4,5,6]}` |
| Latest (new-string) | `entry.stages_run` (string array) | subset of 80 | `{"ts":"…","outcome":"shipped","stages_run":["verify-agent","simplify","commit"]}` |
| Neither (malformed) | — | 1 | skipped by `parseJournalLine` |

The prior code read exactly one of the three.

## The fix

### `stageRanInEntry` — a format-aware pure helper

Exported from `scripts/signals.mjs` (line 536):

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

The three detector arms map to the three format generations. `Array.prototype.includes`
uses strict equality, so a string `"3"` never accidentally matches the integer `3`
— no defensive casting needed.

Canonical stage-number / name mapping (future stages append to the end, never insert):

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

### Updated `gatherShipJournal`

`gatherShipJournal` now counts both stages using the helper and returns a
`simplifyStageCount` alongside the existing `stage2Count`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify"))     simplifyStageCount++;
```

The VITEST guard and the missing-file early-return both include `simplifyStageCount: 0`
in their zero-value shapes so downstream consumers never receive `undefined`.

### Lookback alignment

The production call site at `signals.mjs` previously hardcoded `lookbackDays: 14`
while transcripts used `insightsLookbackDays` (default 30). Comparing a 14-day
journal counter against a 30-day transcript counter in a MAX-merge compares unlike
numerators. The call site now passes `insightsLookbackDays`. The function's default
parameter stays `14` so existing test fixtures don't need updating.

### MAX-merge into `simplifyCommandUses`

In `scripts/run-assessment.mjs` (lines 130–133), the projection is:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This is structurally the same pattern as the v0.9.16 `/color` MAX-merge (PR #96).
`maxProbe` is unchanged — extending it for a single extra source would over-generalize.
`shipVerifyStageRecent` is unchanged; it already reads `signals.shipJournal?.stage2Count`,
which now reflects all three journal formats automatically.

## Data flow (after PR #113)

```
~/.claude/ship/journal.jsonl
  (mixed format: 113 singular + 80 stages_run + 1 malformed)
        │
        ▼
  parseJournalLine  — skip malformed lines silently
        │
        ▼
  gatherShipJournal({ lookbackDays: insightsLookbackDays })
    stage2Count++        if stageRanInEntry(entry, 2, "verify-agent")
    simplifyStageCount++ if stageRanInEntry(entry, 3, "simplify")
    totalRuns++          if outcome === "shipped"
        │
        ▼
  buildSignalsSummary projection (run-assessment.mjs)
    simplifyCommandUses  = max(transcript, history, journal.simplifyStageCount)
    shipVerifyStageRecent = journal.stage2Count     ← unchanged consumer
    shipsRecent           = journal.totalRuns        ← unchanged
        │
        ▼
  rubric satisfiedWhen predicates  — unchanged
    automation/simplify-skill:          simplifyCommandUses >= 1
    verification/ship-verify-stage-recent: shipVerifyStageRecent >= 1
```

## Tests

Seven new tests land in `scripts/__tests__/gather-ship-journal.test.mjs` alongside
the existing suite. The test file uses real-filesystem fixtures via `mkdtempSync` +
`writeFileSync` — no mocking.

| Test | What it verifies |
| --- | --- |
| 1 | `entry.stage === 3` increments `simplifyStageCount` |
| 2 | Legacy-numeric `stages_run: [0,1,2,3,…]` increments both `stage2Count` and `simplifyStageCount` |
| 3 | New-string `stages_run: ["verify-agent","simplify",…]` increments both |
| 4 | Mixed-format journal sums correctly across all three generations |
| 5 | Regression — singular `stage === 2` entries continue to count (existing behavior preserved) |
| 6 | Entries outside the lookback window are excluded for both counters |
| 7 (`stageRanInEntry` pure-function suite) | Seven sub-cases: each detector arm, `stage: 0` (falsy-but-valid), type-strict `"3"` vs `3` rejection, null/non-object/missing-fields return false without throwing |

The existing four tests (missing file, `stage === 2` singular, `outcome === "shipped"`,
malformed-line skip) pass unchanged.

## What didn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or `signalsSummary` keys.
  The five machine-enforced header counts in the probe tracker stay at
  **75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys**.
- `maxProbe` signature and behavior are unchanged.
- `shipVerifyStageRecent` projection in `run-assessment.mjs` is unchanged.
- Score deltas are upward for users with `/ship` deeply integrated — both corrections
  fix false negatives, not regressions.

## Convention established

Per the CLAUDE.md Conventions section (added in the same PR):

> **Ship-journal counters use `stageRanInEntry()` to detect stage execution
> across all three journal format generations.** Adding a new stage counter
> follows this pattern — see CCE-72 / PR #113 for the reference implementation.
> The canonical stage-number / -name mapping lives inline in
> `scripts/signals.mjs::stageRanInEntry`.

New stages are appended to the end of the workflow, never inserted in the middle,
so the numeric detector arm stays stable.
