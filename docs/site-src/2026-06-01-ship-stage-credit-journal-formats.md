---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# /ship stage credit now spans all three journal format generations

**CCE-72 · PR #113**

`~/.claude/ship/journal.jsonl` is the durable record `/ship` writes on every
run, and two Execution signals read it: `shipVerifyStageRecent` (Stage 2,
verify-agent) and — as of this change — `simplifyCommandUses`'s journal
contribution (Stage 3, simplify). Before PR #113, the reader only recognized
one of three format generations the journal has accumulated across `/ship`'s
own schema evolution, so a real, heavily-used habit could still score as
adoption-zero.

## The undercount

`scripts/signals.mjs`'s `gatherShipJournal` checked a single field shape:
`entry.stage === 2`. A survey of a real 194-entry journal found three
generations mixed together:

| Generation             | Shape                                 | Sample                                                            |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Oldest (singular)       | `entry.stage` (integer)                | `{ts, stage: 1}`                                                   |
| Intermediate            | `entry.stages_run` (array of integers) | `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`            |
| Latest (string-named)   | `entry.stages_run` (array of strings)  | `{ts, outcome: "shipped", stages_run: ["pre-flight", ..., "simplify"]}` |

Only the first generation matched the old check — roughly 41% of entries (the
entire `stages_run` cohort) were invisible to the scorer. On the reference
environment this meant `simplifyCommandUses` read `0` from transcripts (Stage
3 dispatches the `code-simplifier` subagent via the Task tool, which never
emits a `<command-name>/simplify</command-name>` marker) *and* `0` from the
journal, even though the journal showed 52 Stage-3 runs in the lookback
window. The `automation/simplify-skill` next-action surfaced in the top-3
priority list for a user who ships through `/simplify` on every PR.

## The fix

A single pure helper, `stageRanInEntry(entry, legacyNumber, newName)`,
collapses the three detection branches into one `Array.includes` check:

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
string-named `stages_run` array never satisfies a lookup for the integer `3`
— no defensive type coercion needed. `gatherShipJournal` now calls it twice
per entry, once per tracked stage:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

`simplifyStageCount` is new on the return shape (alongside the existing
`stage2Count`, `totalRuns`, `lastRunAt`). The stage-number/name mapping is
canonical and documented inline at `scripts/signals.mjs::stageRanInEntry`:
stages append to the end of the `/ship` workflow (0 pre-flight, 1 test, 2
verify-agent, 3 simplify, 4 code-review, 5 commit, 6 push-pr, 7 jira-update)
— they never get inserted in the middle, so the numeric detector arm stays
stable even as new stages are added.

`simplifyStageCount` is then MAX-merged into the `simplifyCommandUses`
projection in `scripts/run-assessment.mjs`, alongside the existing
transcript/history sources:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` needed no projection change — it already reads
`signals.shipJournal.stage2Count` directly, so it picks up the widened
detection automatically.

## Lookback window alignment

`gatherShipJournal`'s lookback was a hardcoded 14 days, independent of the
`--insights-lookback` flag (default 30) that governs the rest of Execution
scoring. That's now fixed at the call site in `scripts/signals.mjs`:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The function's own default parameter stays `14` — only the production call
site widens — so no other caller (tests included) needs to change.

## What didn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or
  `signalsSummary` keys. The five machine-enforced probe-tracker header
  counts are unchanged.
- `maxProbe` itself wasn't extended to take a third source; the inline
  `Math.max` at the `simplifyCommandUses` projection mirrors the existing
  v0.9.16 `/color` MAX-merge pattern rather than over-generalizing a helper
  for one use case.
- Malformed or partial-progress journal lines (the outcome-less singular
  `entry.stage` entries) are still treated as evidence the stage ran — the
  conservative-but-correct read, not a stricter schema check.

## Why this matters beyond the one bug

`stageRanInEntry` is now the reference pattern for any future `/ship`
stage-credit counter: read across all live journal-format generations rather
than assuming the newest one, and default new counters into the lookback
window that the rest of Execution scoring uses. Per the project's CLAUDE.md
Conventions, a new stage counter should follow the same shape — see CCE-72 /
PR #113 for the reference implementation.

Coverage: `scripts/__tests__/gather-ship-journal.test.mjs` adds unit tests
for each format generation individually, a mixed-format journal, lookback
exclusion, and six `stageRanInEntry` edge cases (including the type-strict
`"3"` vs `3` negative).
