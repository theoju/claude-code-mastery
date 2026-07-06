---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: un-blending the `/btw` counter's cumulative and windowed semantics

## The bug

`signalsSummary.btwCommandUses` is supposed to be a 30-day windowed
session-coverage number — how many recent sessions used `/btw` as a
side-channel — feeding the `btw-side-channel` next-action for Boris tip
33+54. Before PR #119, `run-assessment.mjs`'s `buildSignalsSummary()`
computed it with:

```js
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),
  signals.settings?.cliBtwUseCount ?? 0,
),
```

`cliBtwUseCount` comes from `~/.claude.json` and is a **lifetime** invocation
counter — it only grows, never resets, and has no relationship to the
30-day lookback window every other Execution ratio numerator respects. The
`Math.max` blend was added during the v0.9.15 runtime-adoption-probes cycle
to make the tip-33 predicate more forgiving (so a user who'd typed `/btw`
once, long ago, wouldn't show it as an outstanding action). That ergonomic
goal was reasonable; blending it straight into `btwCommandUses` wasn't —
it silently corrupted a windowed session-coverage field with an
ever-growing lifetime count, so the reported number would drift upward
with account age regardless of whether the user had touched `/btw`
recently.

CLAUDE.md now states the general rule this violated: numerator counters
that share a ratio with a windowed denominator must also be windowed;
mixing a cumulative all-time source into that numerator "overstates
session-coverage and produces ratios that drift up with account age
rather than recent posture." Two independent axes have to match — time
window (windowed vs. cumulative) and counter class (session-coverage vs.
raw invocation count) — and the old code conflated both in one `Math.max`.

## The fix

`buildSignalsSummary()` (`scripts/run-assessment.mjs`) now keeps the two
sources apart:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` goes back to being a pure `maxProbe` read (history.jsonl
MAX-merged with transcripts, windowed to the lookback), and
`cliBtwUseCountAllTime` is a new, separately named field carrying the
lifetime count. The `btw-side-channel` next-action in `rubric.json`
(memory dimension, Boris tip 33+54) is rerouted to key off the cumulative
field:

```json
{
  "id": "btw-side-channel",
  "action": "Use /btw for side questions while Claude works — Boris tip 33+54",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

That's the correct semantic match: "have you ever adopted this habit" is
a lifetime question, so it belongs on the lifetime field, not smuggled
into the windowed one.

`probe-catalog.json` documents the split explicitly on both entries —
`btwCommandUses` now notes it's "NOT blended with cliBtwUseCountAllTime,"
and `cliBtwUseCountAllTime` notes it's the source that predicate reads,
distinct from the windowed field.

## What didn't change

The Memory Execution score itself is unaffected — it stayed at 16 across
this PR. The scorer body (`scripts/score.mjs`) already called `maxProbe()`
directly for its ratio inputs and never consumed the blended
`signalsSummary.btwCommandUses` field in the first place; the corruption
was confined to the reporting surface (`signalsSummary`, and anything
reading it — the probes page, the predicate engine). So this PR is a
correctness fix for what next-actions get marked satisfied and what the
probes/methodology pages report, not a score-recalibration.

A deeper redesign of the Memory Execution numerator's field composition
— which commands should count toward the ratio at all — is deliberately
out of scope here and tracked separately as **CCE-79**.

## Bookkeeping

PR #119 also:

- Adds the CLAUDE.md hard rule against blending cumulative-all-time
  counters into windowed ratio numerators (the rule quoted above), so
  the next person adding a `/`-command counter has the axis check
  in front of them before they reach for `Math.max`.
- Updates `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`'s
  header counts: total signals 47→48, `signalsSummary` keys 71→72
  (the tracker's own convention requires this in the same PR as any
  probe change — `cliBtwUseCountAllTime` is a new catalog entry and a
  new `signalsSummary` key).

There's no user-facing UI change beyond the corrected `signalsSummary`
field and its evidence text — the dashboard doesn't render either field
directly, but the probes page and the `btw-side-channel` next-action's
✓/pending state both read through it.
