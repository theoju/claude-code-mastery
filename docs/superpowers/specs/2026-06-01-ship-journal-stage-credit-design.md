# Credit /ship stage execution across journal format generations

**Status:** Design approved 2026-06-01 (pending user review of written spec)
**Ticket:** [CCE-72](https://designitright.atlassian.net/browse/CCE-72)
**Related:** PR #110 (per-command partition, exposed the `simplifyCommandUses=0` false negative); PR #96 (v0.9.16 `/color` history MAX-merge — same architectural pattern this spec extends)

## Goal

Credit users who invoke `/simplify` and the verify-agent through `/ship` Stage 3 / Stage 2 (dispatched subagents) the same way the scorer credits users who type `/simplify` directly. Fix the related observation that `gatherShipJournal` reads only one of three journal format generations and undercounts adoption across the board.

The fix is structurally small (~30 lines + 6 tests) but conceptually fundamental: it aligns the scorer with reality. A user with `/ship` deeply integrated and invoking simplify+verify on every PR should not score `simplifyCommandUses=0`.

## Context

`scanTranscriptInvocations` at [/Users/theo/Projects/claude-extensions/scripts/\_usage-data.mjs:336](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:336) scans transcripts for the literal `<command-name>/simplify</command-name>` markup. `/ship` Stage 3 dispatches the `code-simplifier:code-simplifier` subagent via the Task/Agent tool — that path emits a `tool_use` block with `subagent_type`, NOT a slash-command marker. So a user with `/simplify` fully integrated into their shipping ritual is credited 0 transcript-invocations.

Live evidence from the dashboard author's environment (post per-command-partition, PR #110, lookback 30 days):

- `simplifyCommandUses` (transcripts ∪ history MAX-merge): **0**
- `~/.claude/ship/journal.jsonl` entries where Stage 3 (simplify) ran in the 14-day lookback: **52**
- Result: the `automation/simplify-skill` next-action appears in the top-3 priority list despite being a deeply-adopted habit.

The verify-agent scorer (`stage2Count` → `shipVerifyStageRecent>=1` predicate at [/Users/theo/Projects/claude-extensions/app/data/rubric.json:203](/Users/theo/Projects/claude-extensions/app/data/rubric.json:203)) suffers the same gap and a deeper one besides — see Architecture §1.

### Journal format archaeology

Empirical survey of the author's 194-entry `~/.claude/ship/journal.jsonl`:

| Format generation                 | Field shape                          | Count          | Sample                                                                                                                                 |
| --------------------------------- | ------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Oldest** (singular)             | `entry.stage` (integer)              | 113            | `{ts, stage: 1}` (no outcome)                                                                                                          |
| **Intermediate** (legacy-numeric) | `entry.stages_run` array of integers | 80             | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`                                                                                |
| **Latest** (new-string)           | `entry.stages_run` array of strings  | (subset of 80) | `{ts, outcome: "shipped", stages_run: ["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |
| **Neither**                       | parse-skipped                        | 1              | malformed line                                                                                                                         |

The existing `gatherShipJournal` at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs:558](/Users/theo/Projects/claude-extensions/scripts/signals.mjs:558) reads ONLY `entry.stage === 2`, missing ~41% of entries (the entire `stages_run` cohort). The existing test at [/Users/theo/Projects/claude-extensions/scripts/**tests**/gather-ship-journal.test.mjs:29](/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs:29) only exercises the singular-`stage` format, so the gap never surfaced.

This is bigger than the simplify false negative — `shipVerifyStageRecent>=1` is undercounted for everyone who has shipped through /ship since the schema evolved. Bundling the verify-agent fix is mandatory, not optional.

## Architecture

Three changes in `scripts/signals.mjs`, one in `scripts/run-assessment.mjs`, plus doc + probe-tracker updates.

### 1. Format-aware stage detector

Introduce a small pure helper at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs](/Users/theo/Projects/claude-extensions/scripts/signals.mjs), placed adjacent to `gatherShipJournal`:

```js
// Detects whether a /ship stage RAN, regardless of journal format generation.
// Returns true if any of:
//   1. entry.stage === legacyNumber       (oldest format, single-stage entry)
//   2. entry.stages_run.includes(legacyNumber)   (intermediate, numeric array)
//   3. entry.stages_run.includes(newName)        (latest, string-named array)
// Array.prototype.includes is type-strict so a string "3" never matches
// the integer 3 — no defensive code needed.
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

Stage-number/name reference (the canonical mapping for the spec; future stages should follow):

| #   | name           | notes              |
| --- | -------------- | ------------------ |
| 0   | `pre-flight`   |                    |
| 1   | `test`         |                    |
| 2   | `verify-agent` | this spec consumes |
| 3   | `simplify`     | this spec consumes |
| 4   | `code-review`  |                    |
| 5   | `commit`       |                    |
| 6   | `push-pr`      |                    |
| 7   | `jira-update`  |                    |

### 2. Update `gatherShipJournal`

Replace the existing `entry.stage === 2` check at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs:558](/Users/theo/Projects/claude-extensions/scripts/signals.mjs:558) with the format-aware detector, and add a parallel `simplifyStageCount` counter. The full updated block:

```js
let stage2Count = 0;
let simplifyStageCount = 0;
let totalRuns = 0;
let lastRunAt = null;
for (const line of raw.split("\n")) {
  const entry = parseJournalLine(line);
  if (!entry || typeof entry.ts !== "string") continue;
  const t = Date.parse(entry.ts);
  if (Number.isNaN(t) || t < cutoff) continue;
  if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
  if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
  if (entry.outcome === "shipped") {
    totalRuns++;
    if (!lastRunAt || entry.ts > lastRunAt) lastRunAt = entry.ts;
  }
}
return { stage2Count, simplifyStageCount, totalRuns, lastRunAt };
```

The VITEST guard at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs:535-537](/Users/theo/Projects/claude-extensions/scripts/signals.mjs:535) stays — also gains `simplifyStageCount: 0` in the empty-return shape:

```js
if (process.env.VITEST && !options.journalPath) {
  return {
    stage2Count: 0,
    simplifyStageCount: 0,
    totalRuns: 0,
    lastRunAt: null,
  };
}
```

…and the missing-file fallback at line 547 mirrors it.

### 3. Lookback alignment

`gatherShipJournal`'s default `lookbackDays = 14` at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs:541](/Users/theo/Projects/claude-extensions/scripts/signals.mjs:541) is a v1.0 artifact. The actual call site at [/Users/theo/Projects/claude-extensions/scripts/signals.mjs:765](/Users/theo/Projects/claude-extensions/scripts/signals.mjs:765) hardcodes `{ lookbackDays: 14 }` while transcripts use `insightsLookbackDays` (default 30). A MAX-merge across mismatched windows compares unlike numerators.

Update the call site to receive `insightsLookbackDays`:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's parameter default stays 14 (no breaking change for any other caller) — only the production call site widens.

### 4. Projection — MAX-merge into `simplifyCommandUses`

At [/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:142](/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:142), replace:

```js
simplifyCommandUses: maxProbe(signals, "simplifyCommandUses"),
```

with:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`maxProbe` itself stays unchanged — extending it to take a third arg would over-generalize for a one-off MAX-merge. The inline `Math.max` is closer to the v0.9.16 `/color` pattern's spirit (a third source MAX-merged at the projection boundary).

`shipVerifyStageRecent` at line 121 stays untouched — it already reads `signals.shipJournal?.stage2Count`, which now reflects the widened semantic automatically.

### 5. Probe-tracker footnote

[/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md) — add a single footnote anchor on the Settings/Journal layer header (the layer that hosts `shipVerifyStageRecent` and `shipsRecent`) plus an anchor on the Transcripts layer `/simplify` row. Footnote text:

> `[^journal-stage-credit]`: As of PR #N (CCE-72, spec 2026-06-01), the
> `gatherShipJournal` reader counts stage execution across all three
> journal format generations: singular `entry.stage`, legacy-numeric
> `stages_run`, and new-string `stages_run`. `simplifyCommandUses` is
> MAX-merged with the journal's `simplifyStageCount` at the projection
> layer. `shipVerifyStageRecent` consumes the now-broader `stage2Count`
> automatically. The five machine-enforced header counts are unchanged
> (no new probes / catalog entries / signalsSummary keys).

Literal `PR #N` is intentional — swapped pre-merge in the implementation plan's `/ship` step.

### 6. CLAUDE.md Convention

Add one bullet under `## Conventions`:

```markdown
- **Ship-journal counters use `stageRanInEntry()` to detect stage
  execution across all three journal format generations** (singular
  `entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`).
  Adding a new stage counter follows this pattern — see CCE-72 / PR #N
  for the reference implementation. The canonical stage-number / -name
  mapping lives in `scripts/signals.mjs::stageRanInEntry`.
```

## Data flow

```
~/.claude/ship/journal.jsonl
   (mixed format generations: 113 singular + 80 stages_run + 1 malformed)
        │
        ▼
parseJournalLine
   (skip-silently on parse failure)
        │
        ▼
gatherShipJournal({ lookbackDays: insightsLookbackDays })
   for each entry:
     stage2Count++       if stageRanInEntry(entry, 2, "verify-agent")
     simplifyStageCount++ if stageRanInEntry(entry, 3, "simplify")
     totalRuns++         if outcome === "shipped"
        │
        ▼
signalsSummary projection (run-assessment.mjs)
   simplifyCommandUses = max(transcript, history, journal.simplifyStageCount)
   shipVerifyStageRecent = journal.stage2Count  (unchanged consumer)
   shipsRecent = journal.totalRuns  (unchanged)
        │
        ▼
rubric satisfiedWhen predicates  (unchanged)
   automation/simplify-skill: simplifyCommandUses >= 1
   ...etc.
```

## Cost & blast radius

- **I/O.** Journal is ~10-50KB typical. Already read once per assessment. No new reads. The `Array.prototype.includes` lookup inside `stageRanInEntry` is O(n) over `stages_run.length` (≤ 8) — negligible vs. the existing line-by-line JSON.parse.
- **Score deltas.** Two predicates flip true for users who use `/ship` but rarely type `/simplify` or whose verify-agent runs weren't being counted:
  - `automation/simplify-skill` (next-action) — exits the top-N for affected users.
  - `verification/ship-verify-stage-recent` (dimension scorer input) — bumps Verification execution score modestly.
    Both directions are correct: the scorer was producing false negatives. Live verification will capture pre/post deltas.
- **No new probe-catalog entries / signalsSummary keys / satisfiedWhen predicates.** Five machine-enforced header counts in the probe tracker stay at 75/12/48/47/71.

## Tests

Net-new tests in [/Users/theo/Projects/claude-extensions/scripts/**tests**/gather-ship-journal.test.mjs](/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs) (file already exists; append new `it` blocks within the existing `describe` or add a new sub-describe).

Each test uses real-fs fixtures via `mkdtempSync` + `writeFileSync` (matching existing convention).

### Test 1: singular `entry.stage === 3` counts simplify

Fixture: one journal line `{ts, stage: 3}`. Assert `r.simplifyStageCount === 1`, `r.stage2Count === 0`.

### Test 2: legacy-numeric `stages_run: [0,1,2,3,4]` counts both verify and simplify

Fixture: one shipped entry with `stages_run: [0,1,2,3,4,5,6,7]`. Assert `r.stage2Count === 1` AND `r.simplifyStageCount === 1`.

### Test 3: new-string `stages_run: ["verify-agent","simplify",...]` counts both

Fixture: one shipped entry with `stages_run: ["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]`. Assert `r.stage2Count === 1` AND `r.simplifyStageCount === 1`.

### Test 4: mixed-format journal sums correctly

Three lines: one of each format (singular `stage: 2`, legacy-numeric `stages_run: [0,1,2,3]`, new-string `stages_run: ["simplify"]`). Assert `r.stage2Count === 2` (singular + legacy-numeric) AND `r.simplifyStageCount === 2` (legacy-numeric + new-string).

### Test 5: regression — existing singular-stage===2 test still passes

The existing test at [/Users/theo/Projects/claude-extensions/scripts/**tests**/gather-ship-journal.test.mjs:29](/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs:29) (`"counts stage===2 entries within lookback window"`) must pass unchanged. The new `stageRanInEntry` helper preserves the legacy `entry.stage === 2` detection as case #1.

### Test 6: entries outside the lookback window are excluded for both counters

Fixture: one entry with `stage: 3` 45 days ago, one with `stage: 3` 5 days ago. Cutoff at 30 days. Assert `r.simplifyStageCount === 1`.

### Test 7: stageRanInEntry pure-function tests

Six cases covering each detector arm + edge cases:

- Singular `{stage: 3}` + (3, "simplify") → true.
- Singular `{stage: 99}` + (3, "simplify") → false.
- Legacy-numeric `{stages_run: [3]}` + (3, "simplify") → true.
- New-string `{stages_run: ["simplify"]}` + (3, "simplify") → true.
- Type-strict negative `{stages_run: ["3"]}` + (3, "simplify") → false (string "3" must not match integer 3).
- Empty / null entry → false (no throw).

These factor the detector behavior out of `gatherShipJournal` so format additions can be tested without journal-file orchestration.

## Error handling

- `parseJournalLine` already handles malformed lines silently. No change.
- `stageRanInEntry` is defensive: rejects non-object input, missing-field input, and string/integer cross-type matches via `Array.includes`' strict equality. Cannot throw.
- The new MAX-merge at run-assessment.mjs:142 uses optional-chaining + `?? 0` so a missing `shipJournal` (e.g., journal file unreadable) gracefully reads 0. No new failure path.
- No module-load assertion (unlike CCE-71's `assertCommandPartition`) — the stage-number / -name mapping is documented but not statically enforced. A future spec might codify the canonical mapping as a Set, but YAGNI for v1.

## Probe-tracker update (mandatory per CLAUDE.md)

Per the CLAUDE.md hard rule, the probe-tracker spec MUST be updated in the same PR. No new probes / catalog entries / `signalsSummary` keys — the five machine-enforced header counts stay at **75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys**.

- **Part 1 Settings/Journal layer:** annotate the `shipVerifyStageRecent` row with `[^journal-stage-credit]` footnote.
- **Part 1 Transcripts layer:** annotate the `simplifyCommandUses` row with the same footnote anchor.
- **Footnote definition:** appended at end of Part 1 (between Part 1 close and `---` separator), text per Architecture §5.

`tracker-counts.test.mjs` (5/5 machine-enforced) must pass unchanged.

## Acceptance criteria

- [ ] `stageRanInEntry(entry, legacyNumber, newName)` exported from `scripts/signals.mjs`; handles all three format generations.
- [ ] `gatherShipJournal` returns `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }` with both counters using `stageRanInEntry`.
- [ ] VITEST-guard / missing-file empty returns include `simplifyStageCount: 0`.
- [ ] Call site at `scripts/signals.mjs:765` passes `insightsLookbackDays` instead of the hardcoded `14`.
- [ ] `simplifyCommandUses` in `buildSignalsSummary` is `Math.max(maxProbe(...), shipJournal?.simplifyStageCount ?? 0)`.
- [ ] `shipVerifyStageRecent` projection unchanged (consumes the widened `stage2Count`).
- [ ] All 7 new tests pass (Tests 1-6 + Test 7's six sub-cases).
- [ ] Existing `gather-ship-journal.test.mjs` tests pass unchanged.
- [ ] Probe-tracker spec annotated with the footnote; 5/5 tracker-counts test passes.
- [ ] CLAUDE.md gains the Conventions bullet for `stageRanInEntry`.
- [ ] Live `npm run assess --include-transcripts --insights-lookback 30` produces a delta capture:
  - Pre-PR: `simplifyCommandUses=0`, `shipVerifyStageRecent=?`.
  - Post-PR: both non-zero, reflecting journal evidence.
- [ ] `automation/simplify-skill` next-action exits the top-10 (its predicate is now satisfied for this user).

## Out of scope

- Filtering the journal by branch / repo. The user's cross-repo simplify (in engineering-docs-agent, claude-extensions, etc.) is correctly credited as "habit adoption" — out of scope to scope per-repo.
- Extending `maxProbe` to accept a third source. The inline `Math.max` is clearer and avoids over-generalizing for one use case.
- Adding new rubric next-actions for other /ship stages (code-review credit, push-pr credit, etc.). Today's gap is just simplify+verify.
- Detecting subagent dispatches generically (e.g., scanning transcripts for `Task` tool_use blocks with `subagent_type: code-simplifier:code-simplifier`). The /ship journal is a cleaner, structured signal source; generic subagent detection would surface every adversarial-review subagent the user dispatches too — noise.
- Reconciling the singular `entry.stage` outcome-less entries (113 of 194). These are partial-progress markers from an older /ship — `stageRanInEntry` treats them as evidence the stage ran, which is the conservative-but-correct call.
- Surfacing the dimension cap on the dashboard (Tier 2 follow-up from the prior priorities list). Orthogonal concern.

## Risks and mitigations

- **Risk:** `shipVerifyStageRecent` and `simplifyCommandUses` jump non-trivially for users who frequently `/ship`. Surprising score bumps. **Mitigation:** Live-verification step explicitly captures pre/post values and the PR description names the expected direction (up, not down).
- **Risk:** A user with a corrupted / hand-edited journal entry that re-uses a stage NUMBER for a different stage (e.g., `entry.stage: 3` from a non-/ship tool) would get spurious simplify credit. **Mitigation:** the journal is `~/.claude/ship/journal.jsonl` — single-tool ownership. The risk is theoretical. If it becomes real, the next iteration could add `parseJournalLine` schema validation.
- **Risk:** Future `/ship` adds a new stage in the middle (e.g., a new Stage 2.5 "lint"), renumbering existing stages. The numeric detector would silently miscount. **Mitigation:** New stages are appended to the end of the workflow, not inserted; the canonical mapping table in §1 documents this assumption. The new-string detector arm provides a forward-compatible fallback.
- **Risk:** The lookback widening (14 → 30 default) silently changes other journal-derived signals (`shipsRecent`). **Mitigation:** This is desirable — `shipsRecent>=1` is also an adoption check that benefits from a wider window. Documented in PR notes.
- **Risk:** The 14-day default lingers in `gatherShipJournal`'s parameter for callers that don't pass `lookbackDays`. **Mitigation:** Only one production caller (signals.mjs:765); the default is for tests. Acceptable.

## Implementation order (preview for writing-plans handoff)

1. Add `stageRanInEntry` helper + 6 unit tests for it (Test 7 sub-cases) in `scripts/__tests__/gather-ship-journal.test.mjs`.
2. Add `simplifyStageCount` to `gatherShipJournal` return shape; replace `entry.stage === 2` with `stageRanInEntry(entry, 2, "verify-agent")`. Run existing tests — must stay green.
3. Append Tests 1-6 (journal-fixture tests) to `gather-ship-journal.test.mjs`.
4. Update call site at `signals.mjs:765` to pass `insightsLookbackDays`.
5. Update `buildSignalsSummary` projection at `run-assessment.mjs:142` to MAX-merge `simplifyStageCount` into `simplifyCommandUses`.
6. Run the full test suite; expect baseline + 7 = pass.
7. Update probe-tracker spec footnote.
8. Update CLAUDE.md Conventions section.
9. Live `npm run assess --include-transcripts --insights-lookback 30` for delta verification; capture pre/post.
10. `/ship` the PR; file CCE-72 update during Stage 7 (transition `In Progress` → `Done` after merge).
