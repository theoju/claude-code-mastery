---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit now spans all three journal formats (CCE-72)

`gatherShipJournal` (`scripts/signals.mjs`) reads `~/.claude/ship/journal.jsonl`
to credit two Execution signals: `stage2Count` (verify-agent dispatches) and,
as of this change, `simplifyStageCount` (simplify dispatches). Before PR #113,
the reader matched exactly one shape — `entry.stage === 2` — and missed
everything else the journal had accumulated across three format generations:

1. **Oldest, singular** — `{ ts, stage: 2 }`, one field per entry, no `outcome`.
2. **Intermediate, legacy-numeric** — `{ ts, outcome, stages_run: [0,1,2,3,...] }`.
3. **Latest, new-string** — `{ ts, outcome, stages_run: ["pre-flight", "test",
   "verify-agent", "simplify", ...] }`.

An empirical survey of a real 194-entry journal found 113 singular-format
entries and 80 `stages_run`-format entries (1 malformed line) — meaning the
`stages_run` cohort, roughly 41% of the file, was invisible to the scorer
entirely. A user who ran `/ship` daily with Stage 3 (simplify) firing on
every PR still scored `simplifyCommandUses: 0`, because `/ship` dispatches
the `code-simplifier:code-simplifier` subagent via the Task tool — that path
never emits the `<command-name>/simplify</command-name>` transcript marker
`scanTranscriptInvocations` looks for. The only record of that adoption
lived in the journal, and the journal reader wasn't reading it.

## The fix: one format-aware detector, not three branches per counter

`scripts/signals.mjs` now exports a pure helper, `stageRanInEntry(entry,
legacyNumber, newName)`, that collapses all three detection paths into a
single check:

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

`gatherShipJournal` calls it twice per journal line — once for Stage 2
(`stageRanInEntry(entry, 2, "verify-agent")`) and once for the new Stage 3
counter (`stageRanInEntry(entry, 3, "simplify")`) — and returns
`{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }`. `Array.includes`
is strict-equality, so a hand-edited or future-schema entry with
`stages_run: ["3"]` (string) correctly does **not** match the integer `3` —
no defensive type-coercion code was needed to get that right.

The canonical stage-number-to-name mapping is documented inline next to the
helper, because future stages append to the end of the `/ship` chain rather
than inserting in the middle (an existing convention this change leans on,
not a new one):

```
0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
5 commit     | 6 push-pr | 7 jira-update
```

## Where the new counter feeds Execution scoring

`simplifyStageCount` doesn't replace the existing transcript/history-derived
`simplifyCommandUses` signal — it's MAX-merged with it at the projection
layer in `scripts/run-assessment.mjs`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` (already wired to `signals.shipJournal.stage2Count`)
needed no projection change at all — it automatically benefits from the
now-broader `stage2Count` the moment `gatherShipJournal` starts counting all
three formats. Both directions of this fix only ever raise a score: a
counter that was silently undercounting real usage now counts it, so the
`automation/simplify-skill` next-action correctly drops out of the top-N
priority list for users whose `/ship` habit already covers it.

One more small correction rides along: `gatherShipJournal`'s call site had
been hardcoded to `lookbackDays: 14` while the sibling transcript scan used
`insightsLookbackDays` (default 30) — two Execution signals sharing a ratio
under mismatched windows. The call site now passes `insightsLookbackDays`
through, so `shipsRecent` and `shipVerifyStageRecent` observe the same
window as everything else feeding the same dimension.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` carries the reference
tests for this shape: singular `stage === 3`, legacy-numeric `stages_run`,
new-string `stages_run`, a mixed-format journal summing correctly across
all three, the lookback-window boundary, and a dedicated `stageRanInEntry`
describe block covering the type-strict `"3"` vs. `3` edge case and
null/non-object input. The pre-existing `stage === 2` regression test
(the only case the old reader covered) still passes unchanged.

## What this pattern is for going forward

If `/ship` ever gains a counter for another stage (code-review credit,
push-pr credit), the CLAUDE.md Conventions section now points back to this
change as the reference implementation: call `stageRanInEntry` with that
stage's legacy number and new-string name rather than hand-rolling a new
`===`/`.includes` branch per format generation. No new probe-catalog
entries, `satisfiedWhen` predicates, or `signalsSummary` keys were added by
this change — it widens two existing counters, so the probe tracker's
machine-enforced header counts are unaffected.
