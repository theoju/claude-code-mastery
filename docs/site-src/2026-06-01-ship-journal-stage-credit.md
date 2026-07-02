---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# /ship journal stage credit spans all three journal format generations

`~/.claude/ship/journal.jsonl` is append-only across the lifetime of a
`/ship` install, and its entry shape has changed twice. `gatherShipJournal`
(`scripts/signals.mjs`) used to recognize only the oldest shape, which meant
roughly 41% of journal entries were invisible to the scorer. PR #113 (CCE-72)
fixes that and widens the journal's lookback window to match the rest of the
Execution axis.

## The three shapes

| Generation                    | Field                                | Sample                                                                                                                                 |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Oldest (singular)              | `entry.stage` (integer)               | `{ts, stage: 1}`                                                                                                                        |
| Intermediate (legacy-numeric)  | `entry.stages_run` — array of integers | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`                                                                                |
| Latest (new-string)            | `entry.stages_run` — array of strings  | `{ts, outcome: "shipped", stages_run: ["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |

The old detector checked only `entry.stage === 2` for verify-agent credit.
Anything shaped as `stages_run` — the entire intermediate and latest cohorts
— silently scored zero, regardless of how many times Stage 2 (verify-agent)
or Stage 3 (simplify) actually ran.

## The fix: `stageRanInEntry`

`scripts/signals.mjs` now exports a small pure helper that checks all three
shapes:

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
`stages_run` array never matches the integer `3` passed as `legacyNumber` —
no extra type-coercion guard needed.

`gatherShipJournal` calls it for both stages it tracks:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

`simplifyStageCount` is new — the prior version only ever counted Stage 2.
The stage-number → stage-name mapping is documented inline next to the
helper (0 pre-flight, 1 test, 2 verify-agent, 3 simplify, 4 code-review,
5 commit, 6 push-pr, 7 jira-update) and is expected to stay append-only:
future `/ship` stages should be added to the end of the workflow, not
inserted in the middle, or the numeric detector arm would silently
miscount older journal entries.

## Projection: MAX-merged into `simplifyCommandUses`

`run-assessment.mjs`'s `buildSignalsSummary` already MAX-merges several
transcript- and history-derived counters (the `/color` pattern). The
`/simplify` slot picks up a third source — the journal — because `/ship`
Stage 3 dispatches the `code-simplifier` subagent via the Task tool rather
than emitting a literal `<command-name>/simplify</command-name>` marker, so
a user who only ever triggers simplify through `/ship` was invisible to the
transcript scanner entirely:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no projection change — it already reads
`signals.shipJournal.stage2Count` directly, so it inherits the widened
detection automatically once `gatherShipJournal` returns the corrected
count.

## Lookback alignment

The production call site in `signals.mjs` (`gatherSignals`) hardcoded
`gatherShipJournal({ lookbackDays: 14 })` while every other Execution
signal in the same function uses the configurable `insightsLookbackDays`
(default 30). That mismatch meant the journal counters and the
transcript-derived counters they get MAX-merged against were drawing from
different windows. The call site now passes `insightsLookbackDays`
through; `gatherShipJournal`'s own default parameter stays at 14 so no
other caller (tests) is affected.

## Why this matters

The prior gap produced a real false negative: a user with `/ship` fully
integrated into their workflow — invoking simplify and verify-agent on
every PR — still scored `simplifyCommandUses=0`, which kept the
already-satisfied `automation/simplify-skill` next-action surfacing in the
ranked top-N as if it were unaddressed. For the dashboard author's own
194-entry journal, this widened `simplifyCommandUses` from 0 to 73. No new
`satisfiedWhen` predicates, probe-catalog entries, or `signalsSummary` keys
were added — this is a detection-accuracy fix at the counting layer, not a
new signal.

## Testing

`scripts/__tests__/gather-ship-journal.test.mjs` covers `stageRanInEntry`
against all three format generations plus the type-strict negative case
(a string `"3"` in `stages_run` must not match the integer `3`), a
mixed-format journal, and lookback-window exclusion. The pre-existing
singular-`entry.stage === 2` test is unchanged and still passes.
