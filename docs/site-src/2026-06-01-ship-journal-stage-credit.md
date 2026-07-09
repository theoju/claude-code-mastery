---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit reads all three journal format generations

`gatherShipJournal` (`scripts/signals.mjs`) is the reader for
`~/.claude/ship/journal.jsonl` — the append-only record `/ship` writes on
every run. It backs two things: the `automation/simplify-skill` next-action
(via `simplifyCommandUses`) and the `shipVerifyStageRecent` predicate that
feeds the Verification Execution score. As of PR #113 (CCE-72) it counts
Stage 2 (verify-agent) and Stage 3 (simplify) execution correctly across
every format generation the journal has ever written. Before this PR it
counted correctly across exactly one.

## The bug

The journal schema evolved twice while staying backward-compatible with
itself (old lines are never rewritten), so a long-lived `journal.jsonl`
mixes three shapes:

| Format generation | Field shape | Sample |
| --- | --- | --- |
| Oldest (singular) | `entry.stage` (integer) | `{ts, stage: 2}` |
| Intermediate (legacy-numeric) | `entry.stages_run` array of integers | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6,7]}` |
| Latest (new-string) | `entry.stages_run` array of strings | `{ts, outcome: "shipped", stages_run: ["pre-flight","test","verify-agent","simplify",...]}` |

The pre-PR reader checked only `entry.stage === 2`, which matches the
oldest format and nothing else. On the author's own 194-entry journal that
missed ~41% of entries — the entire `stages_run` cohort — and had two
concrete effects: `simplifyCommandUses` scored `0` despite 52 `/ship`
Stage-3 runs in the lookback window, and `shipVerifyStageRecent` was
undercounted for anyone who had shipped since the schema moved past the
singular-`stage` format. The `automation/simplify-skill` next-action
surfaced in the top-3 priority list for a user with `/simplify` fully
integrated into their shipping ritual — the false negative Boris's tip
about codifying repeated workflows is supposed to catch, not cause.

The gap existed because `/simplify` in this flow runs as a dispatched
`code-simplifier:code-simplifier` subagent via the Task tool, not as a
literal `<command-name>/simplify</command-name>` transcript marker — the
thing `scanTranscriptInvocations` looks for. The journal was always the
right signal source for `/ship`-dispatched stage execution; it just wasn't
being read fully.

## The fix

A single pure helper, `stageRanInEntry(entry, legacyNumber, newName)` in
`scripts/signals.mjs`, checks all three shapes:

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

`Array.prototype.includes` is strict-equality, so a string `"3"` in a
`stages_run` array never matches the integer `3` — no separate
type-coercion guard is needed; `stageRanInEntry` has a test asserting
exactly this (`gather-ship-journal.test.mjs`, `"rejects string '3' against
integer 3"`).

`gatherShipJournal` now runs both counters through the helper and returns
a new `simplifyStageCount` field alongside the existing `stage2Count`,
`totalRuns`, and `lastRunAt`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The canonical stage-number/-name mapping is documented inline at the
`stageRanInEntry` definition and is stable by convention, not by static
enforcement — new `/ship` stages append to the end of the workflow (stage
8+), they never insert in the middle, so the numeric arm of the detector
doesn't silently miscount older journal entries as a later PR renumbers
stages.

Two smaller changes ride along:

- **Lookback alignment.** The call site in `gatherSignals` used to
  hardcode `lookbackDays: 14` while the transcript scanner used
  `insightsLookbackDays` (default 30) — a MAX-merge across mismatched
  windows compares unlike numerators. It now passes `insightsLookbackDays`
  through, so both signal sources share the same window before they're
  combined.
- **Projection.** `run-assessment.mjs`'s `buildSignalsSummary` MAX-merges
  the journal's `simplifyStageCount` into `simplifyCommandUses` alongside
  the existing transcript/history MAX-merge:

  ```js
  simplifyCommandUses: Math.max(
    maxProbe(signals, "simplifyCommandUses"),
    signals.shipJournal?.simplifyStageCount ?? 0,
  ),
  ```

  `shipVerifyStageRecent` needed no projection change — it already reads
  `signals.shipJournal?.stage2Count` directly, so it inherits the wider
  detection for free once `gatherShipJournal` itself is fixed.

## Why the verify-agent fix rides along with the simplify fix

The initial trigger was the `simplifyCommandUses=0` false negative
surfaced by PR #110's per-command partition work, but `stage2Count` had
the identical structural gap — it just hadn't been observed yet because
nothing was actively flagging `shipVerifyStageRecent` as wrong. Once the
root cause (`gatherShipJournal` reads one of three formats) was
identified, fixing only the field someone happened to notice would have
left a known-bad reader in place for the other counter. Both go through
the same `stageRanInEntry` call.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` carries the format-matrix
tests directly:

- Singular `entry.stage === 3` counts toward `simplifyStageCount` only.
- Legacy-numeric `stages_run` array counts both `stage2Count` and
  `simplifyStageCount` when both stage markers are present.
- New-string `stages_run` array does the same by name instead of number.
- A three-line journal mixing all formats sums correctly across all of
  them.
- The pre-existing singular-`stage === 2` regression test still passes
  unchanged.
- Entries outside the lookback window are excluded for both counters.

A parallel `describe("stageRanInEntry", ...)` block exercises the helper
directly — including the null/non-object/missing-field inputs, which all
return `false` rather than throwing, and the type-strict `"3"` vs `3`
case above.

## What didn't change

No new probes, `probe-catalog.json` entries, or `signalsSummary` keys were
added — `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
tracks `shipVerifyStageRecent` and the `/simplify` transcript row with a
footnote pointing at this fix rather than a new registry row, and the five
machine-enforced tracker header counts are unchanged. Journal filtering by
branch or repo, extending `maxProbe` to a third source, and generic
subagent-dispatch detection outside the `/ship` journal are all explicitly
out of scope — see
`docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
§Out of scope for the reasoning behind each.

## Reference

- Ticket: [CCE-72](https://designitright.atlassian.net/browse/CCE-72)
- PR: [#113](https://github.com/theoju/claude-code-self-assessment/pull/113)
- Design spec:
  `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Convention: see the `CLAUDE.md` "Ship-journal counters use
  `stageRanInEntry()`" bullet — new stage counters should follow the same
  pattern.
