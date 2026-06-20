---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# `stageRanInEntry` — detecting `/ship` stage execution across journal format generations

`~/.claude/ship/journal.jsonl` has accumulated three distinct on-disk formats
across the tool's history. Any scorer that reads only one of them silently
misses the others. `stageRanInEntry` is the canonical fix: a small pure helper
that normalises all three formats into a single boolean without any branching
at the call site.

## The problem: three format generations, one original reader

`gatherShipJournal` in `scripts/signals.mjs` produces the `stage2Count`,
`simplifyStageCount`, `totalRuns`, and `lastRunAt` signals that the scorer
consumes. Before PR #113 the stage-check was a single expression:

```js
if (entry.stage === 2) stage2Count++;
```

This matched only the **oldest** journal format — individual per-stage entries
with a singular `entry.stage` integer. The other two formats were silently
ignored. An empirical survey of a 194-entry real journal showed:

| Format generation | Field shape | Count |
|---|---|---|
| **Oldest** (singular) | `entry.stage` (integer) | 113 |
| **Intermediate** (legacy-numeric) | `entry.stages_run: number[]` | 80 (with `stages_run`) |
| **Latest** (new-string) | `entry.stages_run: string[]` | subset of 80 |
| Malformed | unparseable | 1 |

The `stages_run` cohort — roughly 41% of entries — was never counted. Users
with `/ship` deeply integrated were assigned `simplifyCommandUses=0` and saw
a false next-action recommendation in the dashboard's top-N.

## The helper: `stageRanInEntry`

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

Three detection arms in priority order:

1. **Singular** — `entry.stage === legacyNumber`. Exact equality; stage 0
   (`pre-flight`) works correctly because the check is `===`, not truthy.
2. **Legacy-numeric** — `entry.stages_run.includes(legacyNumber)`. Integer
   match inside the numeric array.
3. **New-string** — `entry.stages_run.includes(newName)`. String match inside
   the named-stage array.

`Array.prototype.includes` uses strict equality throughout, so the string `"3"`
never accidentally matches the integer `3`. No defensive coercion needed.

## Canonical stage mapping

The numeric/string pairs are the authoritative mapping. New stages always
append — never insert — so existing numeric assignments stay stable.

| # | name |
|---|---|
| 0 | `pre-flight` |
| 1 | `test` |
| 2 | `verify-agent` |
| 3 | `simplify` |
| 4 | `code-review` |
| 5 | `commit` |
| 6 | `push-pr` |
| 7 | `jira-update` |

## How `gatherShipJournal` uses it

The inner loop in `gatherShipJournal` now calls `stageRanInEntry` for every
stage it cares about:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify"))    simplifyStageCount++;
if (entry.outcome === "shipped") { totalRuns++; … }
```

Return shape: `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`.
Both counters default to 0 in the VITEST guard (no `journalPath` injected) and
in the missing-file fallback.

### Lookback alignment

Before PR #113 the production call site hardcoded `{ lookbackDays: 14 }` while
transcript signals used `insightsLookbackDays` (default 30). The call site now
passes `insightsLookbackDays` so the journal and transcript windows are the
same:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's parameter default stays 14 — that's the test-only default, not
the production value.

## Projection: MAX-merge into `simplifyCommandUses`

`scanTranscriptInvocations` counts literal `<command-name>/simplify</command-name>`
markers in session JSONL files. When `/ship` Stage 3 dispatches the
`code-simplifier` subagent via the Task tool, it emits a `tool_use` block —
not a slash-command marker — so transcript-only scoring returns 0 for users
who invoke `/simplify` exclusively through `/ship`.

`buildSignalsSummary` in `scripts/run-assessment.mjs` resolves this with a
MAX-merge at the projection boundary:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

The MAX-merge mirrors the v0.9.16 `/color` pattern: take the highest signal
from any source rather than picking one source and ignoring the others. The
optional-chaining + `?? 0` makes a missing `shipJournal` (e.g. unreadable
journal file) safely fall through to 0.

`shipVerifyStageRecent` consumes `stage2Count` directly — no change to the
projection, only the underlying counter widened.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` covers all three format
generations plus edge cases. Key fixtures:

- **Test 1** — singular `{ stage: 3 }` → `simplifyStageCount === 1`, `stage2Count === 0`.
- **Test 2** — legacy-numeric `{ stages_run: [0,1,2,3,4,5,6,7] }` → both counters `=== 1`.
- **Test 3** — new-string `{ stages_run: ["pre-flight","test","verify-agent","simplify",…] }` → both counters `=== 1`.
- **Test 4** — mixed-format journal (one of each) → `stage2Count === 2`, `simplifyStageCount === 2`.
- **Test 5** (regression) — existing singular-stage-2 test still passes unchanged.
- **Test 6** — entries outside the lookback window are excluded for both counters.
- **stageRanInEntry unit tests** — six cases covering each detector arm, the
  falsy-but-valid stage-0 edge case (`entry.stage === 0` must be `true`, not
  skipped by a truthy check), type-strict negative (`"3"` does not match `3`),
  and null/undefined/non-object input (returns `false`, never throws).

## Adding a new stage counter

When `/ship` gains a new stage (e.g. stage 8 `post-deploy`), the pattern is:

1. Add the entry to the canonical mapping table above and in the comment block
   above `stageRanInEntry` in `scripts/signals.mjs`.
2. Call `stageRanInEntry(entry, 8, "post-deploy")` inside the
   `gatherShipJournal` loop.
3. Add the new counter to the return shape and to both zero-return fallbacks
   (VITEST guard and missing-file catch).
4. Project the counter into `buildSignalsSummary` in `scripts/run-assessment.mjs`.
5. Add unit tests for each format generation (same structure as Tests 1–4 above).

The helper itself needs no changes — `legacyNumber` and `newName` are
call-site arguments.

## Related

- Decision rationale for this fix: [`2026-06-01-ship-journal-stage-credit.md`](2026-06-01-ship-journal-stage-credit.md)
- `/ship` stage overview: [`ship-pattern.md`](ship-pattern.md)
- Design spec: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Implementation: `scripts/signals.mjs` — `stageRanInEntry` (line 536), `gatherShipJournal` (line 555)
- Tests: `scripts/__tests__/gather-ship-journal.test.mjs`
