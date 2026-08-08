---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: architecture
---

# /ship journal stage credit: reading all three journal format generations

`~/.claude/ship/journal.jsonl` is append-only across the lifetime of a user's
`/ship` command, and the schema it writes has evolved. `gatherShipJournal` in
`scripts/signals.mjs` used to recognize only the oldest shape
(`entry.stage === 2`), which meant it silently missed roughly 41% of journal
entries — the entire `stages_run` cohort — when crediting Stage 2
(verify-agent) and Stage 3 (simplify) execution. PR #113 fixes that by making
stage-execution detection format-aware.

## The three journal shapes

A `~/.claude/ship/journal.jsonl` accumulated across `/ship`'s lifetime mixes:

1. **Oldest, singular** — `{ts, stage: 2}`. One line per stage, no `outcome`.
2. **Intermediate, legacy-numeric** — `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`.
   One line per run, stages recorded as an integer array.
3. **Latest, new-string** — `{ts, outcome: "shipped", stages_run: ["pre-flight", "test", "verify-agent", "simplify", "code-review", "commit", "push-pr", "jira-update"]}`.
   Same array shape, but named strings instead of stage numbers.

The old reader only matched shape 1. Anyone whose journal accumulated entries
from the newer `/ship` generations — which is most active users, since the
`stages_run` shapes are the current ones — got `simplifyCommandUses=0` and an
undercounted `shipVerifyStageRecent`, even when they ran `/ship` on every PR.

## `stageRanInEntry`: one detector, three formats

The fix is a small pure helper, `stageRanInEntry(entry, legacyNumber, newName)`
in `scripts/signals.mjs`, that checks all three shapes in order:

1. `entry.stage === legacyNumber` (oldest format)
2. `entry.stages_run.includes(legacyNumber)` (legacy-numeric array)
3. `entry.stages_run.includes(newName)` (new-string array)

`Array.prototype.includes` is strict-equality, so a string `"3"` in a
`stages_run` array never matches the integer `3` — no extra type-guarding
needed. The function returns `false` (never throws) for `null`, non-object,
or missing-field input, which matters because the journal is untrusted
external-file input parsed line-by-line.

`gatherShipJournal` calls `stageRanInEntry` twice per entry inside its
per-line loop — once for stage 2 (`legacyNumber=2, newName="verify-agent"`)
to accumulate `stage2Count`, once for stage 3
(`legacyNumber=3, newName="simplify"`) to accumulate the new
`simplifyStageCount` field. Both counters, plus `totalRuns` and `lastRunAt`,
are still gated by the same lookback-window cutoff and the same
`entry.outcome === "shipped"` check as before — only the stage-detection
logic changed.

The canonical stage-number/-name mapping is documented inline next to
`stageRanInEntry` in `scripts/signals.mjs`:

| # | name |
|---|------|
| 0 | pre-flight |
| 1 | test |
| 2 | verify-agent |
| 3 | simplify |
| 4 | code-review |
| 5 | commit |
| 6 | push-pr |
| 7 | jira-update |

New `/ship` stages are expected to append to the end of this list, never
insert in the middle — the numeric detector arm depends on stage numbers
staying stable, and this convention is now recorded in this repo's CLAUDE.md.

## Where the widened count lands

`shipVerifyStageRecent` in `run-assessment.mjs`'s `buildSignalsSummary`
already read `signals.shipJournal?.stage2Count` directly, so it picks up the
widened detection automatically — no projection change needed there.

`simplifyCommandUses` needed one: it's MAX-merged across three sources now,
mirroring the v0.9.16 `/color` history-merge pattern:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This matters because a user who invokes `/simplify` exclusively through
`/ship`'s dispatched `code-simplifier:code-simplifier` subagent never emits
the `<command-name>/simplify</command-name>` transcript marker that
`scanTranscriptInvocations` looks for — that subagent dispatch is a `Task`
tool_use block, not a slash-command invocation. Without the journal
MAX-merge, that usage was invisible to the scorer entirely, and the
`automation/simplify-skill` next-action could surface as an unmet priority
for someone who runs `/ship` (and therefore simplify) on every PR.

## Lookback alignment

The production call site in `scripts/signals.mjs` also now passes
`insightsLookbackDays` into `gatherShipJournal` instead of a hardcoded `14`,
so the journal window matches the transcript-scan window used elsewhere in
the same assessment run. `gatherShipJournal`'s own parameter default stays at
14 days — that only affects callers (tests) that don't pass an explicit
`lookbackDays`.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` covers `stageRanInEntry` and
`gatherShipJournal` directly: each of the three format generations counted in
isolation, a mixed-format journal summing correctly across all three in one
file, the lookback cutoff still excluding out-of-window entries for both
counters, and the pre-existing singular-`stage===2` test passing unchanged as
a regression check. `stageRanInEntry` itself is also tested standalone,
including the type-strict rejection of a string `"3"` against the integer
`3`, and the guard against non-object/missing-field input.

## No new probes, no new predicates

This change widens what an existing signal detects; it does not add a new
probe, catalog entry, `signalsSummary` key, or `satisfiedWhen` predicate.
`shipVerifyStageRecent>=1` and the `simplifyCommandUses`-backed next-actions
consume the same fields as before — they just see more of the journal now.
