---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# `/ship` journal stage credit across format generations

**CCE-72 / PR #113 — shipped 2026-06-01**

Before this change, users with `/ship` deeply integrated were scoring
`simplifyCommandUses=0`, causing `automation/simplify-skill` to appear
in the top-N priority actions despite the skill being in regular use.
The root cause: `gatherShipJournal` read only the oldest journal format
(`entry.stage === 2`), missing roughly 41% of journal entries written by
newer `/ship` versions.

This page documents the decision and the data model it corrected.

## The problem: three journal format generations

`~/.claude/ship/journal.jsonl` is an append-only file written across all
of a user's `/ship` invocations. As `/ship` evolved, its schema changed
without a migration step:

| Generation | Field shape | Example |
| --- | --- | --- |
| **Oldest** (singular) | `entry.stage` (integer) | `{"ts":"…","stage":3}` |
| **Intermediate** (legacy-numeric) | `entry.stages_run` (integer array) | `{"ts":"…","outcome":"shipped","stages_run":[0,1,2,3,4,5,6]}` |
| **Latest** (new-string) | `entry.stages_run` (string array) | `{"ts":"…","outcome":"shipped","stages_run":["pre-flight","test","verify-agent","simplify","…"]}` |

An empirical survey of the dashboard author's 194-entry journal found
113 singular entries, 80 `stages_run` entries (mixed numeric/string),
and 1 malformed line. The pre-fix `gatherShipJournal` read only
`entry.stage === 2` — it was blind to the entire `stages_run` cohort.

Both affected signals had the same gap:

- **`stage2Count`** (verify-agent, Stage 2) — undercounted for anyone
  who shipped through the newer formats.
- **`simplifyStageCount`** (simplify, Stage 3) — not counted at all
  before this PR; only transcript `/simplify` invocations were credited,
  which missed the `/ship` subagent dispatch path entirely (the
  `code-simplifier:code-simplifier` subagent emits a `tool_use` block,
  not a slash-command marker).

## The fix: `stageRanInEntry`

A single pure helper collapses detection across all three generations:

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

`Array.prototype.includes` uses strict equality, so the string `"3"`
never accidentally matches the integer `3` — the intermediate and latest
formats stay unambiguous without defensive casting.

The canonical stage-number / -name mapping (future stages append to the
end, never insert in the middle):

| # | name |
| --- | --- |
| 0 | `pre-flight` |
| 1 | `test` |
| 2 | `verify-agent` |
| 3 | `simplify` |
| 4 | `code-review` |
| 5 | `commit` |
| 6 | `push-pr` |
| 7 | `jira-update` |

`gatherShipJournal` now calls `stageRanInEntry(entry, 2, "verify-agent")`
and `stageRanInEntry(entry, 3, "simplify")` for each in-window entry,
returning both `stage2Count` and `simplifyStageCount`.

## Projection: MAX-merge into `simplifyCommandUses`

`/simplify` can be credited from three sources: direct transcript
invocations, the `history.jsonl` command history, and the journal's
`simplifyStageCount`. The projection in `scripts/run-assessment.mjs`
takes the maximum:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This mirrors the pattern used for `/color` in v0.9.16 — a third source
MAX-merged at the projection boundary without changing the underlying
`maxProbe` helper. The `?? 0` guard makes a missing journal (unreadable
file, fresh install) a safe no-op.

`shipVerifyStageRecent` required no change at the projection layer — it
already consumed `signals.shipJournal?.stage2Count`, which now reflects
the widened detection automatically.

## Lookback alignment

The previous call site hardcoded `lookbackDays: 14` while transcript
signals use `insightsLookbackDays` (default 30). A MAX-merge across
mismatched windows compares unlike numerators. The fix passes
`insightsLookbackDays` to `gatherShipJournal` at the production call
site; the function's parameter default stays `14` (no-op for test
callers that don't pass `lookbackDays`).

As a side effect, `shipsRecent` (total shipped runs) is now read over
a 30-day window instead of 14, which is also the correct direction.

## User-visible outcome

For any user with `/ship` regularly invoking Stage 3 (simplify):

- `simplifyCommandUses` moves from `0` to a non-zero count reflecting
  actual journal evidence.
- The `automation/simplify-skill` next-action exits the top-N (its
  `simplifyCommandUses >= 1` predicate is now satisfied).
- The `verification/ship-verify-stage-recent` probe score rises modestly
  for users whose verify-agent runs were landing in the `stages_run`
  format but not being counted.

No new probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen`
predicates were added. The five machine-enforced header counts in the
probe tracker remain unchanged.

## Tests

Seven new test cases in `scripts/__tests__/gather-ship-journal.test.mjs`
cover each detector arm independently:

1. Singular `entry.stage === 3` credits `simplifyStageCount`.
2. Legacy-numeric `stages_run: [0,1,2,3,4,5,6,7]` credits both
   `stage2Count` and `simplifyStageCount`.
3. New-string `stages_run: ["verify-agent","simplify",…]` credits both.
4. A mixed-format journal sums correctly across all three formats.
5. Regression: singular `entry.stage === 2` entries continue to count
   (the oldest format was not broken by the new helper).
6. Entries outside the lookback window are excluded for both counters.
7. Six sub-cases for `stageRanInEntry` itself: each detector arm, the
   type-strict negative (`"3"` vs `3`), and null/missing-fields input.

## Reference

- Design spec:
  [`docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md)
- Related: PR #110 (per-command partition, which exposed the false
  negative); PR #96 (v0.9.16 `/color` MAX-merge, the architectural
  precedent).
- CLAUDE.md Conventions: the `stageRanInEntry` pattern and canonical
  stage-number / -name mapping are documented in the
  "Ship-journal counters" bullet under `## Conventions`.
