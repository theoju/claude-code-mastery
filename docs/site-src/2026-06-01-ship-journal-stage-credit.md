---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# Ship-journal stage credit: multi-format detection

**CCE-72 · PR #113 · 2026-06-01**

`gatherShipJournal` in `scripts/signals.mjs` now credits Stage 2
(verify-agent) and Stage 3 (simplify) executions across all three
generations of `~/.claude/ship/journal.jsonl`. Before this change, the
reader only handled the newest string-array format, silently
under-counting ~41% of journal entries and producing false negatives
in the top-N next-actions list.

## The problem

`scanTranscriptInvocations` counts `/simplify` invocations by scanning
transcripts for `<command-name>/simplify</command-name>` markup.
`/ship` Stage 3 dispatches the `code-simplifier:code-simplifier`
subagent via the Task/Agent tool — that path emits a `tool_use` block
with `subagent_type`, _not_ a slash-command marker. A user with
`/simplify` fully integrated into their shipping ritual was credited
zero transcript invocations, and `automation/simplify-skill` appeared
in the top-N priority gaps despite being a deeply-adopted habit.

The verify-agent scorer had the same gap compounded by a format
archaeology issue: `gatherShipJournal` read only `entry.stage === 2`
and ignored the entire `stages_run` cohort introduced when the journal
schema evolved.

### Journal format archaeology

A survey of 194 entries from the author's `~/.claude/ship/journal.jsonl`:

| Generation | Field shape | Count | Example |
|---|---|---|---|
| Oldest (singular) | `entry.stage` (integer) | 113 | `{"ts":…,"stage":2}` |
| Intermediate (legacy-numeric) | `entry.stages_run` (int array) | 80 | `{"ts":…,"outcome":"shipped","stages_run":[0,1,2,3,4,5,6]}` |
| Latest (new-string) | `entry.stages_run` (string array) | (subset of 80) | `{"ts":…,"outcome":"shipped","stages_run":["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |
| Neither | parse-skipped | 1 | malformed line |

The pre-PR reader matched only `entry.stage === 2`, missing the entire
`stages_run` cohort (~41% of all entries).

## Architecture

Three changes in `scripts/signals.mjs`, one in `scripts/run-assessment.mjs`.

### 1. `stageRanInEntry()` — format-aware stage detector

A small pure helper exported from `scripts/signals.mjs`:

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

`Array.prototype.includes` uses strict equality, so a string `"3"`
never matches the integer `3` — no defensive casting needed. The three
detection arms map directly to the three format generations:

1. `entry.stage === legacyNumber` — oldest, single-stage entries
2. `entry.stages_run.includes(legacyNumber)` — intermediate, numeric array
3. `entry.stages_run.includes(newName)` — latest, string-named array

The canonical stage-number / stage-name mapping (future stages append
to the end, never insert in the middle so the numeric detector stays stable):

| # | Name |
|---|---|
| 0 | `pre-flight` |
| 1 | `test` |
| 2 | `verify-agent` |
| 3 | `simplify` |
| 4 | `code-review` |
| 5 | `commit` |
| 6 | `push-pr` |
| 7 | `jira-update` |

### 2. Updated `gatherShipJournal()` return shape

`gatherShipJournal()` now returns `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`.
The counting loop calls `stageRanInEntry` for both stages:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The VITEST guard and the missing-file fallback both include
`simplifyStageCount: 0` in their empty-return shapes so callers get a
consistent object regardless of whether the journal exists.

### 3. Lookback alignment

`gatherShipJournal`'s internal default of `lookbackDays: 14` is a v1.0
artifact. The production call site in `scripts/signals.mjs` now passes
`insightsLookbackDays` (default 30, matching the transcript window)
instead of hardcoding 14. A MAX-merge across mismatched windows
compares unlike numerators; the widened call site closes that gap. The
function's parameter default stays 14 so isolated tests are unaffected.

### 4. Projection — MAX-merge into `simplifyCommandUses`

At `scripts/run-assessment.mjs`, `simplifyCommandUses` in
`buildSignalsSummary` is now:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

The optional-chain + `?? 0` means a missing or unreadable journal
gracefully contributes zero. `shipVerifyStageRecent` is unchanged — it
already reads `signals.shipJournal?.stage2Count`, which now reflects
the widened semantic automatically.

## Data flow

```
~/.claude/ship/journal.jsonl
   (mixed generations: 113 singular + 80 stages_run + 1 malformed)
        │
        ▼
parseJournalLine  — skip-silently on parse failure
        │
        ▼
gatherShipJournal({ lookbackDays: insightsLookbackDays })
   for each entry in window:
     stage2Count++         if stageRanInEntry(entry, 2, "verify-agent")
     simplifyStageCount++  if stageRanInEntry(entry, 3, "simplify")
     totalRuns++           if outcome === "shipped"
        │
        ▼
buildSignalsSummary (run-assessment.mjs)
   simplifyCommandUses = max(transcript, history MAX-merge, journal.simplifyStageCount)
   shipVerifyStageRecent  = journal.stage2Count  (unchanged consumer)
   shipsRecent            = journal.totalRuns    (unchanged)
        │
        ▼
rubric satisfiedWhen predicates  (unchanged)
   automation/simplify-skill:          simplifyCommandUses >= 1
   verification/ship-verify-stage-recent: shipVerifyStageRecent >= 1
```

## Tests

`scripts/__tests__/gather-ship-journal.test.mjs` covers both
`gatherShipJournal` integration tests (real temp-file fixtures) and
`stageRanInEntry` unit tests. All tests use `mkdtempSync` +
`writeFileSync` following the file's existing convention.

### `gatherShipJournal` fixture tests

| Test | Fixture | Assert |
|---|---|---|
| 1 | `{"stage":3}` | `simplifyStageCount===1`, `stage2Count===0` |
| 2 | `{"stages_run":[0,1,2,3,4,5,6,7],"outcome":"shipped"}` | `stage2Count===1`, `simplifyStageCount===1` |
| 3 | `{"stages_run":["pre-flight","test","verify-agent","simplify",…]}` | `stage2Count===1`, `simplifyStageCount===1` |
| 4 | Three lines — one of each generation | `stage2Count===2`, `simplifyStageCount===2` |
| 5 (regression) | Two `{"stage":2}` entries | `stage2Count===2`, `simplifyStageCount===0` |
| 6 | `{"stage":3}` at −45 days + `{"stage":3}` at −5 days, cutoff 30 days | `simplifyStageCount===1` |

### `stageRanInEntry` unit tests

| Case | Input | Result |
|---|---|---|
| Singular match | `{stage:3}`, `(3,"simplify")` | `true` |
| Falsy-but-valid match | `{stage:0}`, `(0,"pre-flight")` | `true` — guards against `if (entry.stage)` truthy-check refactor |
| Singular non-match | `{stage:99}`, `(3,"simplify")` | `false` |
| Numeric array match | `{stages_run:[0,1,3,4]}`, `(3,"simplify")` | `true` |
| String array match | `{stages_run:["test","simplify"]}`, `(3,"simplify")` | `true` |
| Type-strict negative | `{stages_run:["3"]}`, `(3,"simplify")` | `false` — string `"3"` must not match integer `3` |
| Null / bad input | `null`, `undefined`, `"string"`, `{}`, `{stages_run:"not-array"}` | `false`, no throw |

## Score impact

Two predicates flip true for users who run `/ship` regularly but rarely
type `/simplify` directly:

- `automation/simplify-skill` — exits the top-N next-actions once
  `simplifyCommandUses >= 1` (satisfied by journal evidence).
- `verification/ship-verify-stage-recent` — bumps the Verification
  Execution score modestly as `stage2Count` now reflects all three
  journal generations.

Both directions are correct — the pre-PR scorer was producing false
negatives. No new probe-catalog entries, `satisfiedWhen` predicates, or
`signalsSummary` keys were added; the five machine-enforced header
counts in the probe tracker remain at 75 / 12 / 48 / 47 / 71.

## Adding new stage counters

Use `stageRanInEntry` as the detection primitive. The pattern is:

```js
if (stageRanInEntry(entry, <legacyNumber>, "<newName>")) counter++;
```

Append new stages to the canonical mapping table above — never insert
in the middle, or the numeric detector arm silently miscounts existing
stages. Extend the VITEST guard and missing-file fallback to include
the new counter initialized to `0`.
