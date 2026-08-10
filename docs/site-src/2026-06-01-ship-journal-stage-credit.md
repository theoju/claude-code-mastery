---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Credit `/ship` stage execution across all three journal format generations

## Problem

`~/.claude/ship/journal.jsonl` is the durable record of `/ship` runs, and the
scorer reads it via `gatherShipJournal` in `scripts/signals.mjs` for two
things: verify-agent credit (`stage2Count`, feeding the `shipVerifyStageRecent>=1`
predicate) and — as of this change — simplify-stage credit
(`simplifyStageCount`). The journal's schema evolved across three generations
as `/ship` itself changed shape:

1. **Oldest** — one journal line per stage, `entry.stage` as a bare integer
   (`{ts, stage: 2}`).
2. **Intermediate** — one line per run, `entry.stages_run` as an array of
   integers (`{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`).
3. **Latest** — one line per run, `entry.stages_run` as an array of stage
   names (`{ts, outcome: "shipped", stages_run: ["pre-flight", "test",
"verify-agent", "simplify", ...]}`).

The prior `gatherShipJournal` implementation checked only `entry.stage === 2`
— format 1, and only for the verify-agent stage. It never looked at
`stages_run` at all, so every journal entry written after `/ship` moved to
the run-summary shape was invisible to the scorer. On the dashboard author's
own 194-entry journal, that cohort was roughly 41% of all entries.

The consequence was concrete: a user whose `/ship` deeply dispatches the
simplify stage (Stage 3, the `code-simplifier:code-simplifier` subagent) on
every run still scored `simplifyCommandUses=0`, because `/simplify` invoked
*through* `/ship` never emits the `<command-name>/simplify</command-name>`
transcript marker that `scanTranscriptInvocations` looks for — only a
subagent dispatch. The journal was the one signal source that could see it,
and the scorer wasn't reading it. That false negative surfaced concretely
enough to pull the `automation/simplify-skill` next-action into the
top-3 priority list for someone who'd already adopted the habit.

## Decision

Replace the single `entry.stage === 2` check with a format-aware detector,
`stageRanInEntry(entry, legacyNumber, newName)`, and use it for both the
existing verify-agent counter and a new `simplifyStageCount` counter:

```
stageRanInEntry(entry, legacyNumber, newName):
  entry.stage === legacyNumber                    → true   (format 1)
  entry.stages_run.includes(legacyNumber)          → true   (format 2)
  entry.stages_run.includes(newName)               → true   (format 3)
  otherwise                                        → false
```

`gatherShipJournal` now calls `stageRanInEntry(entry, 2, "verify-agent")` and
`stageRanInEntry(entry, 3, "simplify")` per line and returns both counts
alongside the existing `totalRuns`/`lastRunAt` fields. `stageRanInEntry`
itself is a pure function with no journal-reading side effects, which is what
makes it independently testable — `scripts/__tests__/gather-ship-journal.test.mjs`
exercises it directly (`describe("stageRanInEntry", ...)`) as well as through
`gatherShipJournal` fixtures covering each format generation individually and
a mixed-format journal summing correctly across all three.

`Array.prototype.includes` is strict-equality, so a `stages_run` entry
containing the string `"3"` does not match the integer legacy number `3` —
the format-2/format-3 boundary is type-safe without any extra guard code
(covered by the `rejects string '3' against integer 3` test case).

The canonical stage-number/name mapping is recorded as a comment directly
above `stageRanInEntry` in `signals.mjs`, since it's the shared vocabulary
between the two array shapes:

| # | name | | # | name |
|---|------|---|---|------|
| 0 | `pre-flight` | | 4 | `code-review` |
| 1 | `test` | | 5 | `commit` |
| 2 | `verify-agent` | | 6 | `push-pr` |
| 3 | `simplify` | | 7 | `jira-update` |

Future `/ship` stages append to the end of this list; the numeric mapping
never gets renumbered in the middle, so old journal lines keep decoding
correctly under new code.

### Wiring `simplifyStageCount` into the scorer

`run-assessment.mjs`'s `buildSignalsSummary` already MAX-merges
`simplifyCommandUses` from two sources — transcript scan and history.jsonl —
via `maxProbe(signals, "simplifyCommandUses")`. This change adds the journal
as a third source in the same MAX-merge:

```
simplifyCommandUses = max(
  maxProbe(signals, "simplifyCommandUses"),   // transcript ∪ history
  signals.shipJournal.simplifyStageCount,      // /ship Stage 3 dispatches
)
```

MAX rather than sum, consistent with the existing merge pattern elsewhere in
`buildSignalsSummary` (e.g. the `/btw` history merge): the three sources
overlap in what they can see, and a MAX-merge can only recover signal a
narrower source missed, never double-count a single invocation across
sources.

### Lookback alignment

`gatherShipJournal`'s window was previously a fixed 14-day `lookbackDays`
default, independent of the transcript/history scanners' windows. It's now
called from `gatherSignals` with `lookbackDays: insightsLookbackDays` (the
same `--insights-lookback` value, defaulting to 30) that already governs the
transcript and history scans, so all three `simplifyCommandUses` inputs
share one window instead of the journal silently looking back a narrower
range than the other two.

## Consequences

- `shipVerifyStageRecent` (verify-agent credit) stops undercounting for
  anyone who has shipped since `/ship`'s journal format moved past the
  single-`stage` shape — not just the simplify-stage fix, since both
  counters were reading the same narrow format before this change.
- `simplifyCommandUses` now reflects simplify-stage dispatches that never
  produce a transcript slash-command marker, closing the specific false
  negative described above.
- The fix is intentionally narrow in scope: it's a detection-completeness
  correction inside `gatherShipJournal` and one MAX-merge line in
  `run-assessment.mjs`, not a rubric or weight change. Existing predicates
  (`shipVerifyStageRecent>=1`) and rubric targets are unaffected.

## References

- PR [#113](https://github.com/theoju/claude-code-self-assessment/pull/113)
- `scripts/signals.mjs` — `stageRanInEntry`, `gatherShipJournal`
- `scripts/run-assessment.mjs` — `buildSignalsSummary`'s `simplifyCommandUses` merge
- `scripts/__tests__/gather-ship-journal.test.mjs`
- Design spec: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
