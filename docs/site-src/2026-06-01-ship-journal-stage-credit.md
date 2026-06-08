---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# Ship journal stage credit — multi-format detection (PR #113)

`~/.claude/ship/journal.jsonl` has accumulated three distinct formats over
time. The scorer was only reading one of them, silently under-counting
stage execution for anyone whose `/ship` journal mixed format generations.

## What was wrong

`gatherShipJournal` originally detected Stage 2 (verify-agent) runs by
checking `entry.stage === 2` — the singular-integer form written by early
`/ship` implementations. Two other formats exist and were never read:

| Format | Shape | Was read? |
| ------ | ----- | --------- |
| Singular integer | `{ "stage": 2 }` | ✅ |
| Legacy-numeric array | `{ "stages_run": [1, 2, 3] }` | ❌ |
| New-string array | `{ "stages_run": ["test", "verify-agent", "simplify"] }` | ❌ |

The result: roughly **41% of journal entries were invisible** to the scorer.
Users who run Stage 2 (verify-agent) and Stage 3 (simplify) on every PR
came back with `simplifyCommandUses = 0`, which surfaced the
`automation/simplify-skill` next-action as a top-3 priority even though the
habit was fully adopted.

## What changed

**`scripts/signals.mjs`** — a pure helper `stageRanInEntry(entry, legacyNumber, newName)`
handles all three format generations in one place. Pass the stage's original
integer (e.g. `2`) and its string name (e.g. `"verify-agent"`) and it returns
`true` if any of the three shapes indicate that stage ran. `gatherShipJournal`
now calls this helper for both the existing `stage2Count` counter and a new
`simplifyStageCount` counter (Stage 3).

**`scripts/run-assessment.mjs`** — `simplifyStageCount` is MAX-merged into the
`simplifyCommandUses` projection using the same pattern introduced in v0.9.16
for `/color`:

```
simplifyCommandUses = Math.max(simplifyCommandUses, simplifyStageCount)
```

This lets transcript-derived `/simplify` invocations and journal-derived Stage 3
runs contribute to the same signal without double-counting.

**Journal lookback widened from 14 → `insightsLookbackDays`** (default 30),
aligning the journal window with transcript-derived signals for consistent
scoring across all `/ship`-related counters.

## Effect on your scores

If your `/ship` command was running Stage 3 (simplify) regularly but your
journal entries used the string or array forms, you'll see `simplifyCommandUses`
rise and the `automation/simplify-skill` next-action drop off the priority list.
`shipVerifyStageRecent` (Stage 2) is similarly corrected — it now reflects all
three format generations when determining whether verify-agent ran recently.

No rubric targets changed. The fix aligns the scorer with reality; it doesn't
redefine what counts as adoption.

## Adding new stage counters

The `stageRanInEntry` helper is the canonical pattern for any future `/ship`
stage signals. When you add a new stage counter:

1. Pass the stage's integer (positional number in the original chain) and its
   string name to `stageRanInEntry`.
2. Expose the result as a named counter in `gatherShipJournal`'s return value.
3. MAX-merge into the matching `/self-assessment` projection in
   `run-assessment.mjs` — not a plain assignment, which would overwrite
   transcript-derived counts.

Stage numbers are stable (0–7, appending to the end of the workflow); the
string names come from the journal entries your `/ship` implementation writes.
See the CLAUDE.md **Conventions** section (`Ship-journal counters`) for the
full stage-number/name mapping and cross-references.
