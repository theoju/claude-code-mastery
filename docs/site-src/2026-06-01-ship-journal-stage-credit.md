---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# `/ship` journal stage credit was silently missing ~41% of entries

CCE-72 (PR #113) fixed a false negative in how the scorer reads
`~/.claude/ship/journal.jsonl`: `gatherShipJournal` was only crediting
Stage 2 (verify-agent) when `entry.stage === 2`. That check matches
exactly one of three journal formats the `/ship` command has written
over its lifetime, so users with `/ship` deeply integrated into their
workflow could still see `simplifyCommandUses` pinned at `0` and
`shipVerifyStageRecent` unsatisfied — even after running Stage 3
(simplify) dozens of times — which surfaced `automation/simplify-skill`
as an outstanding next-action it shouldn't have been.

## The three journal formats

`~/.claude/ship/journal.jsonl` is append-only across every `/ship` run
you've ever done, and its per-stage shape has changed generation to
generation:

1. **Oldest** — a single-stage entry: `entry.stage === 2`.
2. **Intermediate** — a numeric array: `entry.stages_run.includes(2)`.
3. **Newest** — a string-named array: `entry.stages_run.includes("verify-agent")`.

The pre-fix reader only checked form 1. Anyone whose journal history was
dominated by forms 2 or 3 — which is most active `/ship` users, since
those are the newer generations — got scored as if they'd never run
Stage 2 or Stage 3 at all.

## The fix: `stageRanInEntry`

`scripts/signals.mjs` now consolidates all three detection arms behind
one pure helper:

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

`gatherShipJournal` calls it once per stage per journal line —
`stageRanInEntry(entry, 2, "verify-agent")` for verify-agent,
`stageRanInEntry(entry, 3, "simplify")` for simplify — instead of
duplicating the three-arm check inline. `Array.prototype.includes` uses
strict equality, so a string `"3"` in a malformed entry never matches
the integer `3`; no extra coercion guard was needed.

The stage-number → stage-name mapping is the same one `/ship` itself
uses and is documented inline above the helper for the next stage that
gets appended (stages are additive, never inserted mid-sequence):

```
0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
5 commit     | 6 push-pr | 7 jira-update
```

## A new counter: `simplifyStageCount`

Before this PR, `gatherShipJournal` only tracked `stage2Count`. It now
also returns `simplifyStageCount` (Stage 3 executions in the lookback
window), and `buildSignalsSummary` in `scripts/run-assessment.mjs`
folds it into the existing `simplifyCommandUses` signal via `Math.max`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This is a credit-recovery merge, not a replacement: `simplifyCommandUses`
already had a transcript-derived source (the `/simplify` slash command
scanned from session JSONL); the journal-derived count only raises the
signal when the journal shows more Stage 3 activity than the transcript
scan caught on its own. Same pattern as the existing `/btw`
history-vs-transcript merge — take the max, never let a second source
regress a signal that was already correctly non-zero.

## Journal lookback now matches the rest of Execution scoring

The production call site previously hardcoded a 14-day lookback for the
journal scan:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

It now passes the same `insightsLookbackDays` the transcript and
insights scanners use (default 30, overridable via
`--insights-lookback`). Before this change, a `/self-assessment
--insights-lookback 30` run would score journal-derived signals against
a *different* window than every other Execution signal in the same
report — a `/ship` run from 20 days ago would count toward
`insightsSessionsAnalyzed` but silently drop out of
`shipVerifyStageRecent`. The two windows now move together.

## Net effect

- `gatherShipJournal(options)` returns
  `{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }` — the
  same shape as before, plus `simplifyStageCount`.
- `stageRanInEntry(entry, legacyNumber, newName)` is exported from
  `scripts/signals.mjs` and unit-tested directly (see
  `scripts/__tests__/gather-ship-journal.test.mjs`) against fixtures for
  all three format generations, so a future journal-format change that
  regresses detection fails CI rather than silently under-scoring users
  again.
- No rubric weight or target changed — this is a pure signal-accuracy
  fix, not a recalibration.
