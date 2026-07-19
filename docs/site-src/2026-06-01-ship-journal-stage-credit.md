---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship journal: credit stage execution across format generations

`gatherShipJournal` in `scripts/signals.mjs` now recognizes `/ship` stage
execution across all three historical shapes of `~/.claude/ship/journal.jsonl`,
not just the oldest one. If you run `/ship` regularly, this changes what the
scorer thinks you've been doing — for the better.

## The bug

The reader only matched `entry.stage === 2` (verify-agent). That was the
*first* journal format `/ship` ever wrote — a single integer per line, no
outcome field. Two later format generations exist:

| Format generation                 | Field shape                          | Sample                                                                    |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Oldest (singular)                  | `entry.stage` (integer)               | `{ts, stage: 1}`                                                          |
| Intermediate (legacy-numeric)      | `entry.stages_run` array of integers  | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`                   |
| Latest (new-string)                | `entry.stages_run` array of strings   | `{ts, outcome: "shipped", stages_run: ["pre-flight", …, "simplify", …]}` |

Because the reader only checked the first shape, it silently missed the
`stages_run` cohort — roughly 41% of entries in a real 194-entry journal
survey. That meant `simplifyCommandUses` could read `0` for a user who ships
constantly with Stage 3 (simplify) firing every time, which in turn surfaced
`automation/simplify-skill` as an unmet next-action even though the habit was
already deeply adopted. Live verification on the dashboard author's own
history showed `simplifyCommandUses` jump from `0` to `73` once the fix
landed, and the next-action correctly dropped out of the ranked top-10.

## The fix

A new pure helper, `stageRanInEntry(entry, legacyNumber, newName)`, checks all
three shapes for a given stage:

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
new-string array never matches the integer `3` from a legacy-numeric lookup —
no extra type coercion needed.

`gatherShipJournal` uses it for both counters it now tracks:

- `stage2Count` — verify-agent dispatches (`stageRanInEntry(entry, 2, "verify-agent")`)
- `simplifyStageCount` — simplify dispatches (`stageRanInEntry(entry, 3, "simplify")`)

The canonical stage-number/-name mapping (stable, future stages append to the
end rather than inserting in the middle):

| # | name           |
| - | -------------- |
| 0 | `pre-flight`   |
| 1 | `test`         |
| 2 | `verify-agent` |
| 3 | `simplify`     |
| 4 | `code-review`  |
| 5 | `commit`       |
| 6 | `push-pr`      |
| 7 | `jira-update`  |

## Projection: MAX-merge into `simplifyCommandUses`

`run-assessment.mjs`'s `buildSignalsSummary` already computed
`simplifyCommandUses` from a transcript/history MAX-merge (`maxProbe`). This
PR adds the journal as a third source, MAX-merged at the projection boundary
rather than inside `maxProbe` itself — extending `maxProbe` to a third source
was judged an over-generalization for a one-off merge:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no equivalent change — it already reads
`signals.shipJournal.stage2Count` directly, so it inherits the wider count
for free once `gatherShipJournal` itself is fixed.

## Lookback alignment

`gatherShipJournal`'s production call site previously hardcoded
`{ lookbackDays: 14 }` while transcript scanning used the configurable
`insightsLookbackDays` (default 30). Mixing a 14-day journal window into a
30-day transcript-derived MAX-merge compared unlike numerators. The call site
now passes `insightsLookbackDays` through, so journal-derived signals and
transcript-derived signals share the same window:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's own default (`lookbackDays = 14`) is untouched — it only
matters for callers that don't pass the option, i.e. tests.

## No new probes

This is a widening fix on existing signals, not a new signal. No new
`probe-catalog.json` entries, `satisfiedWhen` predicates, or
`signalsSummary` keys were added — the five machine-enforced tracker header
counts are unchanged. See the CLAUDE.md Conventions entry for
`stageRanInEntry` and the reference test file,
`scripts/__tests__/gather-ship-journal.test.mjs`, which now exercises all
three format generations plus mixed-format journals and lookback-window
exclusion.

## Where this could go next

There's no `architecture/` or `archive/` section under the core lens yet, so
this lands as a flat dated page. If a scoring-model architecture page gets
scaffolded later, folding the `stageRanInEntry` pattern and the canonical
stage 0–7 mapping into it (rather than leaving them in a dated one-off) would
be the natural next step.
