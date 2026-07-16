---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# Ship journal stage-credit scoring

`~/.claude/ship/journal.jsonl` is the durable record of every `/ship` run —
one line per stage transition, written across however many `/ship` versions
you've lived through. `scripts/signals.mjs::gatherShipJournal` reads it to
credit two Execution signals: `shipVerifyStageRecent` (Stage 2, the
verify-agent dispatch) and, as of CCE-72 (PR #113), `simplifyStageCount`
(Stage 3, the code-simplifier dispatch). This page covers why the reader has
to understand three different journal shapes to do that correctly, and how
the counts flow into `assessment.json`.

## The three journal formats

`/ship` has evolved its journal schema twice without a migration, so
`journal.jsonl` is a mix of generations on any account old enough to have
shipped through more than one version:

| Generation             | Shape                                 | Sample                                                                                                                                 |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Oldest (singular)       | `entry.stage` (integer)                | `{"ts": "...", "stage": 2}`                                                                                                             |
| Intermediate (legacy-numeric) | `entry.stages_run` (array of integers) | `{"ts": "...", "outcome": "shipped", "stages_run": [0,1,2,3,4,5,6,7]}`                                                                 |
| Latest (new-string)     | `entry.stages_run` (array of strings)  | `{"ts": "...", "outcome": "shipped", "stages_run": ["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}` |

Before PR #113, `gatherShipJournal` only matched the oldest shape
(`entry.stage === 2`). An empirical survey of a real 194-entry journal found
that shape covers just 113 of those entries — the remaining ~41%, all in the
`stages_run` cohort, were silently uncounted. The practical symptom: a user
who ran `/ship` — and its Stage 3 code-simplifier dispatch — on every PR
still scored `simplifyCommandUses = 0`, because Stage 3 dispatches a
subagent via the Task tool rather than typing the literal `/simplify` slash
command that `scanTranscriptInvocations` looks for in transcripts. The
journal was the only signal source that actually had the evidence, and it
was reading the wrong field.

## `stageRanInEntry`: one detector, three shapes

The fix is a small pure helper, exported from `scripts/signals.mjs` next to
`gatherShipJournal`:

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

It's deliberately defensive rather than clever: non-object entries return
`false` instead of throwing, and `Array.prototype.includes` is strict-equality,
so a hand-edited `stages_run: ["3"]` (string) never matches the integer `3` —
no extra type-coercion guard needed. `gatherShipJournal` calls it once per
stage of interest, per line:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The stage-number/name mapping is canonical and lives as a comment directly
above the function in `scripts/signals.mjs` — future `/ship` stages append to
the end of the list (0 pre-flight, 1 test, 2 verify-agent, 3 simplify,
4 code-review, 5 commit, 6 push-pr, 7 jira-update); they never get inserted
in the middle, which is what keeps the legacy numeric-array detector safe to
keep around indefinitely instead of becoming a ticking off-by-one.

## Lookback alignment

`gatherShipJournal`'s `lookbackDays` parameter defaulted to a hardcoded `14`,
independent of the `insightsLookbackDays` (default 30) that every
transcript-derived signal uses. Comparing a 14-day journal count against a
30-day transcript count in the same MAX-merge was comparing unlike windows.
The production call site in `gatherSignals` now passes the shared window
through:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's own default stays `14` — it only matters for callers (tests)
that don't pass the option explicitly.

## Where the counts land

`gatherShipJournal` returns `{ stage2Count, simplifyStageCount, totalRuns,
lastRunAt }`. Two different fates for the two stage counters, both wired up
in `scripts/run-assessment.mjs`'s `buildSignalsSummary`:

- **`stage2Count` → `shipVerifyStageRecent`** is a direct passthrough — the
  verify-agent scorer already consumed this field, so widening what
  `stage2Count` counts widens the scorer automatically. No projection change
  needed.
- **`simplifyStageCount` → MAX-merged into `simplifyCommandUses`**, alongside
  the existing transcript/history sources:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This is the same MAX-merge shape used elsewhere in this file (the
`/color`-style history reconciliation, and the `cliBtwUseCountAllTime`
separation described in `CLAUDE.md`): take the best-available signal across
sources rather than trusting any single one, without conflating their
semantics. `maxProbe` itself wasn't extended to take a third source —
a one-off inline `Math.max` was judged clearer than generalizing a helper
for a single call site.

## What didn't change

No new probe-catalog entries, no new `signalsSummary` keys, no new
`satisfiedWhen` predicates. This was a correctness fix to an existing signal
path, not new signal surface — the CLAUDE.md-mandated probe-tracker header
counts are unaffected. The only behavior change downstream is that two
predicates can now flip from false to true for real `/ship` users:
`automation/simplify-skill` (a next-action, which now correctly drops out of
the ranked top-N once its predicate is satisfied) and the verify-agent
scorer input feeding the Verification dimension's Execution score.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` covers all three format
generations independently, a mixed-format journal (one line of each shape,
summed correctly), the lookback-window boundary, and `stageRanInEntry` as a
pure function in isolation — including the type-strict `"3"` vs. `3`
negative case and null/non-object/missing-field inputs. The pre-existing
singular-`stage === 2` test keeps passing unchanged, since that shape is
still detector arm #1.
