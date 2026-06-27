---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# /ship journal stage credit across format generations

**Ticket:** CCE-72 · **PR:** #113 · **Date:** 2026-06-01

## Problem

`gatherShipJournal` in `scripts/signals.mjs` read only `entry.stage === 2` to detect verify-agent runs. It silently missed ~41% of journal entries — the entire cohort written by newer `/ship` versions that switched to a `stages_run` array schema. The result: users with `/ship` deeply embedded in their workflow scored `simplifyCommandUses=0` and continued to see `automation/simplify-skill` in their top-3 priority next-actions despite running the simplify stage dozens of times a month.

An empirical survey of a 194-entry `~/.claude/ship/journal.jsonl` revealed three distinct format generations that had accumulated without any multi-generation reader in place:

| Generation | Field shape | Count in sample |
| --- | --- | --- |
| **Oldest** (singular) | `entry.stage` (integer) | 113 |
| **Intermediate** (legacy-numeric) | `entry.stages_run` (integer array) | 80 (subset) |
| **Latest** (new-string) | `entry.stages_run` (string array) | subset of 80 |
| Malformed / skipped | — | 1 |

The verify-agent scorer (`stage2Count` → `shipVerifyStageRecent >= 1`) suffered the same gap. Both fixes are bundled because they share the same root cause.

## Fix: `stageRanInEntry` helper

PR #113 introduces a small exported pure function in `scripts/signals.mjs`, placed adjacent to `gatherShipJournal`:

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

It collapses detection across all three generations into a single strict-equality check. `Array.prototype.includes` is type-strict, so the string `"3"` never matches the integer `3` — no defensive coercions needed and no risk of a future string-named stage entry being counted against a numeric slot.

The canonical stage-number / name mapping it relies on:

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

New stages must be appended to the end of this list, never inserted in the middle, so the numeric detector arm stays stable.

One edge case to remember: Stage 0 (`pre-flight`) has the integer value `0`, which is falsy in JavaScript. The original `entry.stage === 2` check was strict-equality and immune to this, and `stageRanInEntry` preserves strict equality — a future refactor to `if (entry.stage)` would silently break Stage 0 detection. The unit tests include a dedicated case asserting `stageRanInEntry({ stage: 0 }, 0, "pre-flight") === true` precisely to guard against this reflex.

## Changes to `gatherShipJournal`

`gatherShipJournal` gains a parallel `simplifyStageCount` counter alongside the existing `stage2Count`. Both now route through `stageRanInEntry` instead of raw `entry.stage ===` comparisons:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The return shape widens to `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`. Both the Vitest skip guard and the missing-file fallback include `simplifyStageCount: 0` so callers never receive `undefined`.

## Lookback alignment: 14 → `insightsLookbackDays`

The production call site in `scripts/signals.mjs` previously hardcoded `{ lookbackDays: 14 }`, while transcript-derived signals use `insightsLookbackDays` (default 30). A MAX-merge across mismatched windows compares unlike numerators.

PR #113 widens the call site to pass `insightsLookbackDays` directly. The function's parameter default stays at 14 (no breaking change for test callers that inject `lookbackDays` explicitly); only the production path widens to 30.

## MAX-merge projection

At the `buildSignalsSummary` projection boundary in `scripts/run-assessment.mjs`, `simplifyCommandUses` is now a three-way MAX:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This follows the v0.9.16 pattern established for `/color` history: when a behavior is detectable through multiple independent sources (transcript command markers, usage-data history, filesystem journal), you take the maximum rather than any single source. The optional-chaining + `?? 0` means a missing or unreadable journal file gracefully reads as 0 with no new failure path.

`maxProbe` itself is unchanged — extending it for a third argument would over-generalize for a single use case.

`shipVerifyStageRecent` required no change at the projection layer; it already reads `signals.shipJournal?.stage2Count`, which now reflects the widened detection automatically.

## Score impact

For users who run `/ship` regularly but rarely type `/simplify` interactively:

- `simplifyCommandUses` moves from 0 to the actual count of simplify-stage runs within the lookback window.
- `shipVerifyStageRecent` flips from 0 to 1 if any journal entry in the window ran the verify-agent stage.
- `automation/simplify-skill` exits the ranked next-actions list once `simplifyCommandUses >= 1`.

Both directions are corrections — the scorer was producing false negatives. No existing signal semantics change; no probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen` predicates were added or removed.

## Test coverage

Thirteen new unit tests in `scripts/__tests__/gather-ship-journal.test.mjs` cover:

- Each format generation in isolation (singular `stage`, legacy-numeric `stages_run`, new-string `stages_run`)
- Mixed-format journals that cross all three generations in a single file
- Regression on the pre-existing singular-`stage === 2` case
- Lookback exclusion (entries older than the cutoff are not counted)
- `stageRanInEntry` pure-function cases: each detector arm, the Stage 0 falsy-but-valid edge case, type-strict `"3" ≠ 3` rejection, and null/non-object/missing-fields safety

The existing tests pass unchanged — the `stageRanInEntry` refactor preserves the legacy `entry.stage === 2` detection as its first check.

## Convention

When adding a new `/ship` stage counter, use `stageRanInEntry(entry, legacyNumber, newName)` and register the stage in the canonical table above. The CLAUDE.md Conventions section documents this pattern with a pointer to CCE-72 / PR #113 as the reference implementation.
