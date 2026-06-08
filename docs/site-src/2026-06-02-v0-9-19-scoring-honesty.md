---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
---

# v0.9.19 — Scoring Honesty (CCE-78)

**Released 2026-06-02**

v0.9.19 ships one scoring-honesty fix and routine plan archival. No dimension
targets change; no new probes are added.

## The fix: `btwCommandUses` no longer blends cumulative all-time data

`signalsSummary.btwCommandUses` previously used a `Math.max` blend to paper
over the gap between two incompatible sources:

```js
btwCommandUses: Math.max(windowedSessionCount, cliJson.btwUseCount)
```

Those two inputs belong to different counter classes:

| Source | Time window | Counter class |
| --- | --- | --- |
| `~/.claude/usage-data/` session facets | 30-day windowed | session-coverage (deduped per session) |
| `~/.claude.json#btwUseCount` | cumulative all-time | raw invocation count |

Mixing them into a single field corrupts any ratio that uses `btwCommandUses`
as a numerator. For users with heavy historical `/btw` usage but low recent
activity, the cumulative all-time count wins the `Math.max` and the numerator
silently grows with account age — scores drift upward regardless of actual
30-day posture.

### What changes in the data layer

`btwCommandUses` now returns only the 30-day windowed session-coverage count
from `usage-data/`. A new field, `cliBtwUseCountAllTime`, exposes the
cumulative `~/.claude.json#btwUseCount` value separately.

The `btw-side-channel` predicate that backs tips 33 and 54 is rerouted to
`cliBtwUseCountAllTime`. Both tips continue to show satisfied for any user who
has adopted `/btw` — the adoption check doesn't need recency, so the cumulative
source is the right one for that predicate.

### What doesn't change

Memory Execution scores are **unchanged by design**. The Memory Execution
scorer's ratio numerator was already computed on a path independent of
`btwCommandUses`; this fix only cleans up the `signalsSummary` surface. You
should see no score movement when upgrading.

## If you consume `signalsSummary.btwCommandUses` directly

`assessment.json` consumers that branch on `btwCommandUses` will see lower
values for users with significant historical `/btw` usage and low recent
activity. That's correct — the field now reflects genuine 30-day posture.

If your check is "has this user ever used `/btw`?", read
`cliBtwUseCountAllTime` instead. The two fields answer different questions and
should not be substituted for each other.

## Plan archival

The plans for CCE-72 (transcript posture-command coverage signals) and CCE-76
(all-twelve-dimensions Execution scorers) are moved to
`docs/superpowers/plans/archived/`. Both shipped in prior releases; the
archival is bookkeeping.

## What's next

**CCE-79** is filed for a broader Memory Execution scorer redesign. The current
numerator still sums `/clear` and `/compact` session-coverage signals with
other fields that belong in separate categories under the per-field semantic
classification rules (`CLAUDE.md` §Hard rules). CCE-79 will restrict the
numerator to genuinely homogeneous inputs and recalibrate the rubric target
(currently 92) to match the narrowed realistic ceiling.
