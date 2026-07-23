---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit now spans all three journal formats

`~/.claude/ship/journal.jsonl` has evolved its schema three times over the
life of `/ship`, and until PR #113 the scorer only understood the oldest
one. If you've been shipping through `/ship` for a while, your Stage 2
(verify-agent) and Stage 3 (simplify) dispatches were being undercounted —
in the worst case, silently scored as zero.

## The gap

`gatherShipJournal` in `scripts/signals.mjs` reads the journal line by line
and counts stage executions within a lookback window. The original
implementation checked exactly one shape: `entry.stage === 2`. But the
journal has three format generations on disk:

1. **Singular** — `{ts, stage: 1}`, one stage per line, no `outcome` field.
2. **Legacy-numeric** — `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`,
   an array of integer stage numbers.
3. **New-string** — `{ts, outcome: "shipped", stages_run: ["pre-flight",
   "test", "verify-agent", "simplify", "code-review", "commit", "push-pr",
   "jira-update"]}`, the same array shape but with named stages.

A journal that mixes all three generations (which is the normal case for
anyone who's been running `/ship` since before the schema changed) meant
real Stage 2/Stage 3 executions in the `stages_run`-shaped entries were
invisible to the counter. `simplifyCommandUses` — the signal behind the
`automation/simplify-skill` next-action — could read `0` for a user who
was dispatching the `code-simplifier` subagent through `/ship` on every
single PR, because that dispatch never emits the
`<command-name>/simplify</command-name>` transcript marker the transcript
scanner looks for. The journal was the one place that adoption was
actually visible, and it was only half-read.

## The fix: `stageRanInEntry`

A single pure helper, `stageRanInEntry`, collapses the three detection
paths into one strict-equality check:

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

It's deliberately defensive: non-object input, missing fields, and
type-mismatched array entries all resolve to `false` rather than throwing.
`Array.prototype.includes` is strict-equality under the hood, so a
hand-edited or malformed entry with `stages_run: ["3"]` (string) will
never falsely match `legacyNumber = 3` (integer) — no extra type-guard
needed. `gatherShipJournal` calls it twice per line:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

The stage-number-to-name mapping is canonical and append-only — future
`/ship` stages are expected to append to the end of the workflow rather
than insert in the middle, so the numeric detector arm doesn't need to be
revisited as the string names evolve:

| # | name | | # | name |
|---|------|---|---|------|
| 0 | pre-flight | | 4 | code-review |
| 1 | test | | 5 | commit |
| 2 | verify-agent | | 6 | push-pr |
| 3 | simplify | | 7 | jira-update |

## Where the count lands

The new `simplifyStageCount` isn't scored on its own — it's MAX-merged into
the existing `simplifyCommandUses` signal at the projection boundary in
`buildSignalsSummary` (`scripts/run-assessment.mjs`):

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This follows the same MAX-merge pattern already used for the `/color`
history reconciliation (v0.9.16): a second, independent source of the
same behavioral signal can only push the counter up, never down, and the
existing `maxProbe` helper wasn't extended with a third argument — the
inline `Math.max` stays closer to the one-off nature of this merge.
`shipVerifyStageRecent` (feeding the `verification/ship-verify-stage-recent`
predicate) needed no equivalent change — it already reads
`signals.shipJournal?.stage2Count` directly, so it inherits the wider count
automatically now that `stage2Count` itself is computed across all three
formats.

The verified live effect: a real 194-entry journal survey during design
showed `simplifyCommandUses` jumping from `0` to `73` once all three
generations were honored, and the `automation/simplify-skill` next-action —
previously a false-positive top-3 priority — dropped out of the ranked
list entirely, because the underlying habit was already there.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` adds direct coverage for
each format generation individually, a mixed-format journal that sums
correctly across all three in one file, lookback-window exclusion for the
new counter, and a `describe("stageRanInEntry")` block exercising the
pure helper in isolation — including the type-strict rejection of
`stages_run: ["3"]` against the integer `3`. The original
`"counts stage===2 entries within lookback window"` test is unchanged and
still green; the fix is additive, not a rewrite of the existing detection
path.

No new probes, `probe-catalog.json` entries, or `signalsSummary` keys came
out of this change — it widens what an existing signal (`stage2Count` /
`simplifyStageCount`) is willing to count, rather than adding a new one.
