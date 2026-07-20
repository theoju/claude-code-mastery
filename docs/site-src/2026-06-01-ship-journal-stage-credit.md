---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# `/ship` journal stage credit (CCE-72)

`~/.claude/ship/journal.jsonl` is the append-only record `/ship` writes on
every run, and it's the source for two Execution signals: `shipVerifyStageRecent`
(did Stage 2, verify-agent, run recently?) and a chunk of `simplifyCommandUses`
(did Stage 3, simplify, run recently?). As of PR #113 (CCE-72), the reader for
that journal — `gatherShipJournal` in `scripts/signals.mjs` — understands all
three format generations the journal has gone through instead of just the
oldest one.

## The bug

`/ship`'s journal schema evolved over time:

| Format generation                 | Field shape                          | Sample                                                                       |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| **Oldest** (singular)              | `entry.stage` (integer)               | `{ts, stage: 2}`                                                             |
| **Intermediate** (legacy-numeric)  | `entry.stages_run` (array of integers)| `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6,7]}`                    |
| **Latest** (new-string)            | `entry.stages_run` (array of strings) | `{ts, outcome: "shipped", stages_run: ["pre-flight",…,"verify-agent","simplify",…]}` |

The pre-CCE-72 `gatherShipJournal` matched only `entry.stage === 2` — the
oldest format. In an empirical survey of a 194-entry real journal, that
format generation covered 113 entries; the `stages_run` cohort (80 entries,
~41% of the journal) was silently skipped entirely. The practical
consequence: a user with `/ship` deeply integrated into their workflow —
verify-agent and simplify dispatched as subagents on every shipped PR — still
scored `simplifyCommandUses=0`, because `/ship` dispatches simplify via the
Task/Agent tool (a `subagent_type` block), not the `<command-name>/simplify</command-name>`
transcript marker the direct-invocation scanner looks for. The dashboard then
surfaced `automation/simplify-skill` as an outstanding next-action for someone
who'd already adopted the habit.

## The fix

A single pure helper, `stageRanInEntry(entry, legacyNumber, newName)`, unifies
detection across all three generations:

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

`Array.prototype.includes` uses strict equality, so a string `"3"` never
matches the integer `3` in a legacy-numeric array — no extra type-guarding
needed to keep the two array shapes from cross-matching.

`gatherShipJournal` now calls `stageRanInEntry` twice per journal line — once
for Stage 2 (`verify-agent`) and once for Stage 3 (`simplify`) — and returns a
new `simplifyStageCount` alongside the existing `stage2Count`, `totalRuns`,
and `lastRunAt`:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The canonical stage-number/-name mapping lives as a comment next to
`stageRanInEntry` in `scripts/signals.mjs`:

```
0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
5 commit     | 6 push-pr | 7 jira-update
```

New `/ship` stages append to the end of this list, never insert in the
middle — that's what keeps the numeric detector arm stable across format
generations without a version field.

## Projection: MAX-merge into `simplifyCommandUses`

`run-assessment.mjs` already MAX-merges `simplifyCommandUses` across the
transcript scanner and the history.jsonl scanner (the same pattern used for
`/color`, `/btw`, and friends). CCE-72 adds journal's `simplifyStageCount` as
a third source in that same merge:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no projection change — it already reads
`signals.shipJournal?.stage2Count`, so it inherits the widened counting for
free.

## Lookback alignment

`gatherShipJournal`'s `lookbackDays` parameter defaulted to a hardcoded `14`,
while every transcript-derived signal uses the configurable
`insightsLookbackDays` (default 30). Comparing a 14-day journal numerator
against a 30-day transcript-scan window meant the MAX-merge was quietly
mixing mismatched windows. The production call site in `scripts/signals.mjs`
now passes `insightsLookbackDays` through:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's own default stays `14` — it's only the parameter default for
callers (tests) that don't pass one explicitly; the one production caller
always supplies `insightsLookbackDays`.

## What this doesn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or
  `signalsSummary` keys — the widened counting flows through existing
  signal names (`stage2Count`, `simplifyCommandUses`), so all five
  machine-enforced probe-tracker header counts stay put.
- Per-repo/branch filtering of the journal is out of scope — cross-repo
  `/ship` usage is correctly credited as habit adoption regardless of which
  repo it ran in.
- Generic subagent-dispatch detection (scanning transcripts for `Task`
  tool_use blocks by `subagent_type`) was considered and rejected — the
  journal is a cleaner, already-structured signal source, and generic
  detection would pull in noise from every adversarial-review subagent a
  user dispatches for unrelated reasons.

## Tests

`scripts/__tests__/gather-ship-journal.test.mjs` covers `stageRanInEntry`
directly (each detector arm, plus the type-strict `"3"` vs `3` negative case
and null/non-object inputs) and `gatherShipJournal` against real-fs fixtures
built with `mkdtempSync` — one test per format generation, one mixed-format
journal, and one lookback-window boundary case. The pre-existing
singular-`stage===2` test is unchanged and still passes, confirming the
oldest format generation isn't a regression target.
