---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship journal stage credit now spans all three journal formats

`gatherShipJournal` (in `scripts/signals.mjs`) reads `~/.claude/ship/journal.jsonl`
and counts, within the lookback window, how many `/ship` runs actually
dispatched Stage 2 (verify-agent) and Stage 3 (simplify). That count feeds
`simplifyCommandUses` and the verify-agent Execution signal — real usage
signal for users who have `/ship` deeply wired into their workflow.

Before PR #113 / CCE-72, the scanner only matched `entry.stage === 2`. That
was correct for the oldest journal format, where each JSONL line described a
single stage as a singular numeric field. It silently missed everything
written by two format generations that came later:

- an intermediate format where a run entry carries `stages_run: [0, 1, 2, 3, ...]`
  — a numeric array of every stage that ran in that invocation
- the current format, where `stages_run` holds stage **names** instead of
  numbers: `["pre-flight", "test", "verify-agent", "simplify", ...]`

Those two array-based shapes account for roughly 41% of journal entries in
the field, which means a heavy `/ship` user — someone running Stage 2 and
Stage 3 on nearly every ship — could still show `simplifyCommandUses: 0` and
score as if they'd never touched the simplify pass. The bug wasn't "no
signal," it was "signal present, format not recognized."

## The fix: one predicate, three shapes

The fix is a small pure function, `stageRanInEntry(entry, legacyNumber, newName)`,
that normalizes all three detection shapes into a single `Array.includes`
check:

```js
// Stage-number / -name mapping (canonical; future stages append to end):
//   0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
//   5 commit     | 6 push-pr | 7 jira-update
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

`gatherShipJournal` calls it once per stage per entry:

```js
if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
```

Two details worth calling out because they're easy to get wrong in a
"just check if the field exists" rewrite:

- **`entry.stage === 0` (pre-flight) is a valid match, not a falsy no-op.**
  `stageRanInEntry` uses strict equality against `legacyNumber`, never a
  truthy check on `entry.stage`, so Stage 0 doesn't silently disappear in a
  future refactor that swaps in `if (entry.stage)`.
- **`Array.includes` is type-strict**, so a `stages_run` array containing the
  string `"3"` does not match the integer `3`. No defensive coercion was
  added — the three real-world formats never mix numeric and string
  encodings within one array, so a stray string entry is correctly treated
  as not matching rather than coerced into a false positive.

## Why this belongs in Execution scoring, not just a bugfix note

The dashboard's whole Execution axis exists to answer "are you actually
using the tools you set up?" — and the input here is the ground-truth
journal `/ship` itself writes on every run. A scanner that only recognizes
one of three formats a durable append-only log has accumulated over time
isn't a minor edge case; it's the same class of problem CLAUDE.md's hard
rules call out for cumulative-vs-windowed counters and posture-vs-volume
partitions — a signal source drifted out from under the code that reads it,
and the fix is to make the reader tolerant of every generation it will
actually see, not just the newest one.

`gatherShipJournal` stays intentionally tolerant elsewhere in the same way:
malformed JSON lines are skipped rather than thrown on (`parseJournalLine`
returns `null` on anything that isn't a parseable JSON object), and a
missing journal file returns all-zeros instead of erroring. Stage-format
detection now matches that posture.

## Test coverage

`scripts/__tests__/gather-ship-journal.test.mjs` pins the contract with
fixtures for each format generation individually and a mixed-format case:

- singular `entry.stage === 3` counts toward `simplifyStageCount`
- legacy-numeric `stages_run: [0,1,2,3,4,5,6,7]` counts both Stage 2 and
  Stage 3
- new-string `stages_run: ["pre-flight", ..., "verify-agent", "simplify", ...]`
  counts both
- a journal mixing all three formats across separate entries sums correctly
- the original singular `stage === 2` regression case still passes
- entries outside the lookback window are excluded regardless of format

`stageRanInEntry` itself has a separate unit-test block covering the
`stage === 0` guard, the type-strict `includes` rejection of `"3"` vs `3`,
and `null`/non-object/missing-field inputs returning `false` without
throwing.

## If you're adding a new `/ship` stage

Stage numbers are append-only — new stages go on the end of the sequence,
never inserted in the middle, so the numeric detector arm in
`stageRanInEntry` stays stable across journal-format generations. See the
canonical stage-number/-name mapping inline in `scripts/signals.mjs` and the
`stageRanInEntry()` counter pattern referenced from CLAUDE.md as the
template for any future per-stage counter (PR #113 / CCE-72 is the
reference implementation).
