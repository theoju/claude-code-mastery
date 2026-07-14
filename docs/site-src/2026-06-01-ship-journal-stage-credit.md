---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit now survives all three journal format generations

`~/.claude/ship/journal.jsonl` has quietly evolved its schema three times
since `/ship` shipped. `gatherShipJournal` — the reader that credits Stage 2
(verify-agent) and Stage 3 (simplify) execution toward Execution scoring —
only ever understood the oldest one. PR #113 (CCE-72) fixes that with a
small format-aware helper, and the fix matters more than its ~30-line diff
suggests: it was silently understating Execution scores for exactly the
users who ship the most.

## The three formats

An empirical survey of a real 194-entry journal found:

| Generation | Shape | Share |
| --- | --- | --- |
| Oldest (singular) | `entry.stage` is a plain integer, no `outcome` field | 113 entries |
| Intermediate (legacy-numeric) | `entry.stages_run` is an array of integers, `outcome: "shipped"` | 80 entries |
| Latest (new-string) | `entry.stages_run` is an array of stage names (`"verify-agent"`, `"simplify"`, …) | subset of the 80 |

The pre-fix reader in `scripts/signals.mjs` matched only `entry.stage === 2`
— the oldest format's shape. That silently missed the entire
`stages_run` cohort, roughly 41% of entries in the surveyed journal. A
heavy `/ship` user whose journal had migrated to the newer schema could
show `simplifyCommandUses: 0` in their assessment despite invoking the
simplify subagent on every single PR.

## The fix: `stageRanInEntry`

`scripts/signals.mjs` now exports a pure helper that normalizes across all
three generations:

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

`Array.prototype.includes` is strict-equality, so a hand-edited or
malformed `stages_run: ["3"]` never cross-matches the integer `3` —
`gather-ship-journal.test.mjs` asserts this directly, along with a
`{ stage: 0 }` regression case (stage 0 is pre-flight, and `0` is falsy —
a future `if (entry.stage)` refactor would silently break it).

`gatherShipJournal` calls the helper twice per entry and now returns a
second counter alongside the existing three:

```js
{ stage2Count, simplifyStageCount, totalRuns, lastRunAt }
```

`stage2Count` — the existing field consumed by the `shipVerifyStageRecent`
predicate — gets wider for free, since it now matches all three formats
instead of just the oldest. `simplifyStageCount` is new, and gets
MAX-merged into `simplifyCommandUses` at the projection boundary in
`scripts/run-assessment.mjs`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This is deliberate, not incidental: `/ship` Stage 3 dispatches the
`code-simplifier:code-simplifier` subagent via the Task/Agent tool, which
emits a `tool_use` block with `subagent_type` — not the
`<command-name>/simplify</command-name>` markup `scanTranscriptInvocations`
scans transcripts for. A user with `/simplify` fully delegated to `/ship`
was invisible to the transcript scanner entirely; the journal is the only
place that evidence exists.

## Lookback alignment, as a side effect

`gatherShipJournal`'s default `lookbackDays` stayed at `14` — a leftover
from before the transcript scanner's `insightsLookbackDays` (default 30)
existed. The production call site in `scripts/signals.mjs` now passes
`insightsLookbackDays` through instead of hardcoding `14`, so the journal
window matches the transcript window it's MAX-merged against. Comparing a
14-day numerator against a 30-day denominator was the kind of window
mismatch the CLAUDE.md hard rule on ratio semantics exists to catch — this
PR closes it for the journal source specifically. The function's own
parameter default is unchanged (still `14`) so no other caller's behavior
shifts.

## Stage-number mapping (canonical)

Future `/ship` stage counters should follow the same `stageRanInEntry`
pattern. The mapping is documented inline next to the helper in
`scripts/signals.mjs`:

| # | name |
| --- | --- |
| 0 | pre-flight |
| 1 | test |
| 2 | verify-agent |
| 3 | simplify |
| 4 | code-review |
| 5 | commit |
| 6 | push-pr |
| 7 | jira-update |

New stages append to the end of this list, never insert in the middle —
the numeric detector arm depends on the mapping staying stable, and the
new-string detector arm is the forward-compatible fallback if it doesn't.

## What didn't change

No new probe-catalog entries, `satisfiedWhen` predicates, or
`signalsSummary` keys came out of this fix — the probe tracker's five
machine-enforced header counts are unchanged, just annotated with a
footnote pointing here. `shipVerifyStageRecent` itself required no code
change: it already read `signals.shipJournal.stage2Count`, so widening
what feeds that field was enough. The scope was deliberately narrow —
per-repo journal filtering, generic subagent-dispatch detection, and
credit for other `/ship` stages (code-review, push-pr) are all out of
scope for this change.

## Why this is worth writing down

Two predicates flip true for real users as a result of this fix:
`automation/simplify-skill` (a next-action that should exit a heavy
`/ship` user's top-10 list, since the habit is already adopted) and
`verification/ship-verify-stage-recent` (which was undercounted for
everyone who has shipped since the `stages_run` schema landed). Both
directions are corrections, not regressions — the scorer was producing
false negatives, and this closes the gap between what the tool measures
and what the user actually does with `/ship`.
