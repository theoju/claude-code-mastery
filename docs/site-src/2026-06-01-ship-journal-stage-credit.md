---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Crediting `/ship` stage execution across journal format generations

`~/.claude/ship/journal.jsonl` has evolved through three shapes since
`/ship` was first written, and until PR #113 (CCE-72) the scorer only
understood the oldest one. That gap meant a user who ran `/ship`
religiously — dispatching the verify-agent and `/simplify` on every
PR — could still see `simplifyCommandUses=0` and an undercounted
`shipVerifyStageRecent`, because their journal entries were written in
a format `gatherShipJournal` didn't recognize.

## The gap

`/ship` Stage 3 (simplify) and Stage 2 (verify-agent) both dispatch
subagents via the Task/Agent tool rather than typing a literal
`/simplify` slash command into the transcript. `scanTranscriptInvocations`
scans for the `<command-name>/simplify</command-name>` marker, so it
never sees a dispatch-based simplify run — the journal is the only
structured record of it.

The trouble was that `gatherShipJournal` in `scripts/signals.mjs`
counted only `entry.stage === 2`, which matched the oldest single-stage
journal format. An empirical survey of a 194-entry journal (documented
in `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`)
found three format generations in the wild:

| Generation   | Field shape                          | Share of surveyed entries |
| ------------ | ------------------------------------- | -------------------------- |
| Oldest       | `entry.stage` (integer)               | 113 of 194                 |
| Intermediate | `entry.stages_run` (array of integers) | 80 of 194 (subset)          |
| Latest       | `entry.stages_run` (array of strings)  | subset of the 80            |

The old check matched only the first generation — roughly 41% of real
entries, the entire `stages_run` cohort, went uncounted. That's why the
`automation/simplify-skill` next-action could surface as a top-3
priority for someone who already had the habit fully adopted.

## The fix

A single format-aware detector, `stageRanInEntry(entry, legacyNumber, newName)`,
now centralizes the three-way check and replaces the old
`entry.stage === 2` comparison. It returns true if any of:

1. `entry.stage === legacyNumber` (oldest format)
2. `entry.stages_run.includes(legacyNumber)` (intermediate, numeric array)
3. `entry.stages_run.includes(newName)` (latest, string-named array)

`Array.prototype.includes` uses strict equality, so a string `"3"` never
matches the integer `3` — the type-strict behavior of `includes` does
the defensive work without extra code, per `stageRanInEntry` in
`scripts/signals.mjs`.

`gatherShipJournal` uses the detector for both counters it returns:
`stage2Count` (verify-agent, feeding `shipVerifyStageRecent`) and a new
`simplifyStageCount`. The stage-number/name mapping is documented inline
in `scripts/signals.mjs` next to the helper — future `/ship` stages are
expected to append to the end of the workflow rather than renumber
existing ones, so the numeric detector arm stays stable and the
string-named arm gives forward compatibility if the mapping ever needs
to shift.

`simplifyStageCount` is then MAX-merged into the `simplifyCommandUses`
projection in `run-assessment.mjs`, alongside the existing
transcript-and-history merge — the same MAX-merge pattern used for
`/color` history credit. `shipVerifyStageRecent` needed no projection
change: it already reads `signals.shipJournal?.stage2Count`, so it
picks up the widened detection automatically.

## Lookback alignment

`gatherShipJournal`'s default lookback window was 14 days, a holdover
from an earlier version of `/ship`, while the transcript- and
history-derived signals it's MAX-merged against use the configurable
`insightsLookbackDays` (default 30). The production call site in
`scripts/signals.mjs` now passes `insightsLookbackDays` through instead
of the hardcoded `14`, so a journal-derived counter and its
transcript-derived counterpart are always comparing the same window.
The function's own parameter default stays 14 — only the production
call site widens — so no other caller is affected.

## What didn't change

No new probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen`
predicates came out of this fix — it's a detection-accuracy fix to two
existing counters, not a new signal. The probe tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
carries a footnote on the `shipVerifyStageRecent` and `simplifyCommandUses`
rows pointing back to this change, and its machine-enforced header
counts are unchanged.

Also unchanged: journal entries aren't filtered by branch or repo (a
user's cross-repo `/ship` habit is credited as habit adoption, not
scoped per-project), and `maxProbe` wasn't generalized to take a third
source — the inline `Math.max` at the `simplifyCommandUses` projection
site was judged clearer than over-generalizing a helper for one call
site.

## Why this direction, not the alternatives

The design considered scanning transcripts generically for `Task`
tool_use blocks with `subagent_type: code-simplifier:code-simplifier`
instead of reading the journal. That was rejected: the journal is
already a clean, structured signal source purpose-built for this, while
generic subagent-dispatch scanning would also surface every adversarial
review subagent a user dispatches for unrelated reasons — noise the
journal doesn't have.

## Related

- Design spec: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Ticket: [CCE-72](https://designitright.atlassian.net/browse/CCE-72)
- Prior art: PR #110 (the per-command posture/volume partition that
  first exposed the `simplifyCommandUses=0` false negative) and PR #96
  (the `/color` history MAX-merge this fix's projection change mirrors)
- `/ship` itself: [`docs/site-src/ship-pattern.md`](ship-pattern.md)
