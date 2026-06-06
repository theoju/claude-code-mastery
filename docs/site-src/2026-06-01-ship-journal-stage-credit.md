---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# Ship journal stage credit — CCE-72

PR #113 fixes a systematic false negative in the `/ship` journal scorer.
Users who ran `/ship` regularly through Stage 2 (verify-agent) and Stage 3
(simplify) still saw `simplifyCommandUses=0` and received a spurious "adopt
the simplify skill" next-action. The root cause was a single-format assumption
in `gatherShipJournal` that silently skipped ~41% of real journal entries.

## Background: three journal formats

`~/.claude/skills/ship/state/*.jsonl` entries have accumulated across three
format generations as `/ship` evolved:

| Generation | Shape | Matching condition |
| ---------- | ----- | ------------------ |
| Singular `stage` | `{ "stage": 2 }` | `entry.stage === 2` |
| Legacy-numeric `stages_run` | `{ "stages_run": [1, 2, 3] }` | `entry.stages_run.includes(2)` |
| New-string `stages_run` | `{ "stages_run": ["verify-agent", "simplify"] }` | `entry.stages_run.includes("simplify")` |

The prior implementation used only `entry.stage === 2`. It matched nothing
in the `stages_run` array formats — the two formats that cover the bulk of
entries written under any `/ship` revision authored after the v0.9 cycle.

## What changed

### `stageRanInEntry(entry, legacyNumber, newName)`

A pure helper in `scripts/signals.mjs` that collapses detection across all
three generations into a single call:

```js
stageRanInEntry(entry, 2, "verify-agent")  // stage 2 / verify-agent
stageRanInEntry(entry, 3, "simplify")      // stage 3 / simplify
```

Internally it checks `entry.stage === legacyNumber`, then falls through to
`Array.includes` against a normalized `stages_run` array, matching either
the integer or the string name. Strict equality throughout — no coercion.

### Two scorers, one helper

`gatherShipJournal` now uses `stageRanInEntry` for both existing counters:

| Counter | Stage | Prior coverage | After CCE-72 |
| ------- | ----- | -------------- | ------------ |
| `stage2Count` | 2 / verify-agent | singular only | all three formats |
| `simplifyStageCount` _(new)_ | 3 / simplify | missing entirely | all three formats |

`simplifyStageCount` is MAX-merged into `simplifyCommandUses` in
`scripts/run-assessment.mjs`, mirroring the v0.9.16 `/color` pattern —
the projection contract and downstream scorer weights are unchanged.

### Lookback alignment

`gatherShipJournal` was reading 14 days of entries regardless of the
user-configured window. It now respects `insightsLookbackDays` (default 30).
If you run with `--insights-lookback 7`, journal counters use the same 7-day
window as every other Execution signal.

## Score impact

Score deltas are zero when `simplifyCommandUses` is already saturated from
other sources (e.g. direct `/simplify` invocations in the terminal). The
visible change is in **next-action predicate satisfaction**: users whose
`simplifyCommandUses` was zero solely because the journal detection missed
their entries will see the "adopt the simplify skill" next-action drop off
the top-10 list on the next `npm run assess`.

No rubric weights changed. No signals were removed. The fix is entirely at
the detection layer inside `gatherShipJournal`.

## Test coverage

13 unit tests were added in `scripts/__tests__/signals.test.mjs` covering:

- `stageRanInEntry` against all three format generations
- `stageRanInEntry` with a missing or null `stages_run`
- `gatherShipJournal` returning correct counts across mixed-format entry sets
- Edge cases: empty journal, entries with only unrelated stages, boundary
  dates at the lookback cutoff

## Conventions update

`CLAUDE.md §Conventions` documents the new pattern:

> Ship-journal counters use `stageRanInEntry()` to detect stage execution
> across all three journal format generations (singular `entry.stage`,
> legacy-numeric `stages_run`, new-string `stages_run`). Adding a new stage
> counter follows this pattern — see CCE-72 / PR #113 for the reference
> implementation.

If you add a new `/ship` stage counter in the future, reach for
`stageRanInEntry` first. The canonical stage-number / stage-name mapping
lives inline in `scripts/signals.mjs::stageRanInEntry` (stages 0–7:
pre-flight, test, verify-agent, simplify, code-review, commit, push-pr,
jira-update). New stages append to the end of the workflow, never insert in
the middle, so the numeric detector arm stays stable.
