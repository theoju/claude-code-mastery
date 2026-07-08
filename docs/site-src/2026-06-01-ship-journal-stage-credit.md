---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit now spans all three journal formats

`~/.claude/ship/journal.jsonl` has evolved through three field shapes
since `/ship` shipped: a singular `entry.stage` integer (oldest), a
`stages_run` array of integers (intermediate), and a `stages_run` array
of stage-name strings (newest — `"pre-flight"`, `"test"`,
`"verify-agent"`, `"simplify"`, `"code-review"`, `"commit"`, `"push-pr"`,
`"jira-update"`). `gatherShipJournal` in `scripts/signals.mjs` only ever
read the first of the three (`entry.stage === 2`), so anyone whose
journal had migrated to the array formats was silently undercounted —
on the dashboard author's own 194-entry journal, that was roughly 41%
of entries (the entire `stages_run` cohort).

The practical symptom: a user who runs `/ship` on nearly every PR, with
Stage 3 (simplify) dispatching the `code-simplifier:code-simplifier`
subagent on every shipped change, still scored `simplifyCommandUses: 0`.
Transcripts don't help here either — `scanTranscriptInvocations` looks
for the literal `<command-name>/simplify</command-name>` markup, and a
subagent dispatch via the Task/Agent tool never emits that marker. The
journal was the only place this signal existed, and the reader wasn't
looking at most of it. The same gap applied to Stage 2 (verify-agent),
which feeds the `shipVerifyStageRecent >= 1` predicate directly.

## The fix

`scripts/signals.mjs` now exports a small pure helper, `stageRanInEntry(entry, legacyNumber, newName)`,
that checks all three formats:

1. `entry.stage === legacyNumber` (oldest, single-stage entries)
2. `entry.stages_run.includes(legacyNumber)` (intermediate, numeric array)
3. `entry.stages_run.includes(newName)` (latest, string-named array)

`Array.prototype.includes` is strict-equality, so a string `"3"` in a
`stages_run` array never accidentally matches the integer `3` — no extra
type-guarding needed. `gatherShipJournal` calls it twice per journal
line — `stageRanInEntry(entry, 2, "verify-agent")` and
`stageRanInEntry(entry, 3, "simplify")` — and now returns a new
`simplifyStageCount` field alongside the existing `stage2Count`,
`totalRuns`, and `lastRunAt`.

The stage-number/name mapping is canonical and documented inline next
to `stageRanInEntry`:

| # | name | | # | name |
|---|------|---|---|------|
| 0 | `pre-flight` | | 4 | `code-review` |
| 1 | `test` | | 5 | `commit` |
| 2 | `verify-agent` | | 6 | `push-pr` |
| 3 | `simplify` | | 7 | `jira-update` |

Future `/ship` stages append to the end of this list rather than
inserting in the middle — that's what keeps the numeric detector arm
stable across journal-format generations without needing a version
field.

## Where the new signal lands

`simplifyCommandUses` in `run-assessment.mjs`'s `buildSignalsSummary`
projection is now a three-way `Math.max` across the transcript scanner,
the `history.jsonl` scan, and the journal's `simplifyStageCount`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no projection change — it already reads
`signals.shipJournal?.stage2Count`, which is now correctly populated
across all three formats.

One more fix rode along: `gatherShipJournal`'s production call site was
hardcoded to `lookbackDays: 14` while every other Execution signal uses
`insightsLookbackDays` (default 30). A `Math.max` across mismatched
windows was comparing unlike numerators, so the call site now passes
`insightsLookbackDays` through. The function's own default parameter
stays `14` — nothing else calls it without an explicit value.

## Coverage

`scripts/__tests__/gather-ship-journal.test.mjs` adds fixture coverage
for each format individually, a mixed-format journal that sums correctly
across all three in the same file, a lookback-window exclusion case, and
direct unit tests of `stageRanInEntry` covering the type-strict
`"3"` vs. `3` edge case and null/non-object input. The pre-existing
`entry.stage === 2` regression test still passes unchanged — the new
detector preserves that check as its first arm.

No new probe-catalog entries, `satisfiedWhen` predicates, or
`signalsSummary` keys came out of this change — it widens what an
existing signal (`shipJournal.stage2Count` / the new `simplifyStageCount`)
actually counts, rather than adding a new one. The probe-implementation
tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
was annotated in place rather than gaining new rows.

## Why this shape and not something else

Detecting subagent dispatches generically — scanning transcripts for
`Task` tool_use blocks with `subagent_type: code-simplifier:code-simplifier`
— was considered and dropped. The journal is a structured, purpose-built
signal source for exactly this; generic subagent-dispatch detection
would also pick up every adversarial-review subagent a user runs,
which is noise this scorer doesn't want. The journal's older,
outcome-less `entry.stage` entries (partial-progress markers from
earlier `/ship` runs, with no `outcome` field) are still treated as
evidence the stage ran — the conservative-but-correct call, since a
stage that ran and then halted still ran.
