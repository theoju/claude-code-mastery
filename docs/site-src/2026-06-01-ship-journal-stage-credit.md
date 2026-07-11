---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit: fixing a 41% undercount (CCE-72 / PR #113)

`~/.claude/ship/journal.jsonl` is the durable record `/ship` writes on every
run, and the scorer's `gatherShipJournal` (`scripts/signals.mjs`) reads it to
credit two things: whether Stage 2 (verify-agent) ran, and — as of this PR —
whether Stage 3 (simplify) ran. Before PR #113, the reader only matched one of
three journal formats that have accumulated across `/ship`'s lifetime, and the
gap wasn't cosmetic: it silently zeroed out real usage for anyone whose
journal had moved past the oldest schema.

## The three formats

An empirical survey of a live 194-entry journal found:

| Format generation                 | Field shape                          | Share |
| ---------------------------------- | ------------------------------------- | ----- |
| Oldest (singular)                  | `entry.stage` (integer)                | 113   |
| Intermediate (legacy-numeric)      | `entry.stages_run` (array of integers) | 80    |
| Latest (new-string)                | `entry.stages_run` (array of strings)  | subset of the 80 |

`gatherShipJournal` originally checked only `entry.stage === 2`. That matches
the oldest format and nothing else — so the entire `stages_run` cohort,
roughly 41% of a real journal, went uncounted. Stage 3 (simplify) had no
detector at all, at any format.

## Why it mattered beyond one dimension

The immediate trigger was `/simplify` transcript scanning: `/ship` Stage 3
dispatches the `code-simplifier:code-simplifier` subagent via the Task tool,
which never emits the `<command-name>/simplify</command-name>` marker that
`scanTranscriptInvocations` looks for. A user with `/ship` fully integrated
into their shipping ritual — simplify running on every PR — scored
`simplifyCommandUses: 0` from transcripts, and the journal (the one place that
signal *does* exist) wasn't being read correctly either. The `automation/
simplify-skill` next-action surfaced in the top-priority list for someone who
had already adopted the habit.

The same undercount applied to `shipVerifyStageRecent`, which every `/ship`
user relies on for verification-dimension credit — this wasn't a
simplify-only bug, it undercounted verify-agent runs for anyone whose journal
had moved off the oldest schema.

## The fix: one format-aware detector

`stageRanInEntry(entry, legacyNumber, newName)` in `scripts/signals.mjs`
consolidates all three detection paths into one `Array.includes` check:

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
new-string array never matches the integer `3` — no defensive coercion
needed, and it's covered by an explicit regression test
(`scripts/__tests__/gather-ship-journal.test.mjs`, "rejects string '3' against
integer 3"). `gatherShipJournal` now calls it uniformly:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

`simplifyStageCount` is a new field on the `gatherShipJournal` return shape
(alongside the existing `stage2Count`, `totalRuns`, `lastRunAt`). At the
projection layer (`scripts/run-assessment.mjs`), it's MAX-merged into
`simplifyCommandUses`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no projection change — it already reads
`signals.shipJournal.stage2Count`, so the widened detection applies
automatically once the count itself is correct.

## The stage-number mapping is append-only

The canonical stage mapping lives as a comment directly above
`stageRanInEntry` in `scripts/signals.mjs`:

```
0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
5 commit     | 6 push-pr | 7 jira-update
```

This is the same convention `CLAUDE.md` documents for the ship-journal stage
counters generally: **new `/ship` stages append to the end of the workflow,
never insert in the middle.** Inserting a stage would silently renumber
everything after it and miscount every legacy-numeric journal entry written
before the change — the new-string detector arm is the forward-compatible
fallback precisely because numeric positions aren't guaranteed stable across
schema evolution, but names are.

## What didn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or
  `signalsSummary` keys — this was a correctness fix to existing counters,
  not a new signal. The probe tracker's five machine-enforced header counts
  are unchanged.
- The `lookbackDays` default on `gatherShipJournal` stays 14 for callers that
  don't override it (test-only in practice); only the production call site
  now passes the shared `insightsLookbackDays` so the journal window matches
  the transcript window instead of drifting independently.
- `gatherShipJournal`'s malformed-line tolerance (`parseJournalLine` returns
  `null` and the loop skips it) is untouched — `stageRanInEntry` itself can't
  throw, by construction: non-object input, missing fields, and
  non-array `stages_run` all short-circuit to `false`.

## Reference

- Design: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Tests: `scripts/__tests__/gather-ship-journal.test.mjs` (format-generation
  fixtures plus the `stageRanInEntry` unit cases)
- Ticket: [CCE-72](https://designitright.atlassian.net/browse/CCE-72)
