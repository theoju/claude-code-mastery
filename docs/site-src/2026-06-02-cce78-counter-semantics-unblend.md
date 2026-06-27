---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Counter Semantics Unblend — `btwCommandUses` vs `cliBtwUseCountAllTime`

**PR #119 · 2026-06-02 · non-breaking**

## What changed

`buildSignalsSummary` in `scripts/run-assessment.mjs` previously computed:

```js
btwCommandUses: Math.max(maxProbe(signals, "btwCommandUses"),
                         signals.settings.cliBtwUseCount ?? 0),
```

That line blended two counters with incompatible semantics into a single
`signalsSummary` field. PR #119 removes the blend and exposes the two signals
on separate keys:

```js
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The rubric predicates for Boris tips 33 and 54 — which check "have you ever
adopted the `/btw` habit?" — were rerouted to `cliBtwUseCountAllTime` so
they continue to work against the all-time source they actually need.

`signalsSummary` key count moved from 71 → 72; probe-catalog entries from
47 → 48.

## Why the blend was wrong

Every counter in `buildSignalsSummary` sits on two independent semantic axes:

| Axis              | `btwCommandUses` (old blend numerator)        | `settings.cliBtwUseCount` (old blend addend) |
| ----------------- | --------------------------------------------- | -------------------------------------------- |
| (a) Time window   | 30-day windowed (session-coverage window)     | Cumulative all-time                          |
| (b) Counter class | Per-session-coverage (deduped per session)    | Raw invocation count (monotonically growing) |

The original `Math.max` looked ergonomic — it prevented the windowed
session-coverage field from being zero when the user had clearly used `/btw`
in the past. But it silently produced a number that is neither "sessions in
the last 30 days that used /btw" nor "lifetime invocations of /btw." It's
the larger of the two, which is a third thing that satisfies neither
predicate consumer nor Execution scorer.

The concrete failure mode: `settings.cliBtwUseCount` is sourced from
`~/.claude.json`, where Anthropic's client writes a monotonically growing
lifetime counter. As the account ages, this value only increases. A
`Math.max` over a 30-day windowed value and a lifetime counter causes the
blended field to drift upward with account age — regardless of whether the
user touched `/btw` in the last month. Any Execution ratio that drew on
this field would report "improving" posture even during months of disuse.

## What was actually affected

The Memory Execution scorer itself was **not** directly corrupted by this
blend. Its scorer body calls `maxProbe(signals, "btwCommandUses")`
directly against the raw signal, bypassing `signalsSummary`. The problem
was confined to the `signalsSummary` surface that the predicate engine
reads when evaluating `satisfiedWhen` expressions in `rubric.json`.

Two predicates were incorrectly satisfied:

- **Tip 33** (`btwCommandUses >= 1`) — was satisfied whenever `cliBtwUseCount`
  exceeded zero, which is true for any account that has ever invoked `/btw`.
- **Tip 54** (same signal path) — same false-positive behaviour.

With the fix, both predicates route to `cliBtwUseCountAllTime`, which
preserves the "have you ever adopted this habit" semantics they actually
want — while leaving the 30-day windowed `btwCommandUses` clean for any
Execution ratio that might use it.

## The two-axis classification rule

This incident codified a hard rule now in `CLAUDE.md`:

> Before adding any field to a ratio numerator (or summing multiple fields
> into one), classify each field on both axes — time window and counter class.
> If the new field's class on either axis differs from existing numerator
> inputs, it doesn't belong in the same `sum`.

The reference case is CCE-79 (follow-up): the original Memory Execution
numerator summed `/btw + /clear + /compact + /rewind` despite those four
signals spanning three different class combinations. The redesign restricts
the numerator to the two genuine session-coverage signals (`/clear +
/compact`) and recalibrates the rubric target accordingly.

## Tests

`scripts/__tests__/signals-summary.test.mjs` contains the three new
regression assertions added by this PR:

```
btwCommandUses takes MAX of transcript and history only — NOT cliBtwUseCount (CCE-78)
exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)
cliBtwUseCountAllTime defaults to 0 when settings.cliBtwUseCount is missing
```

The snapshot test (`output keys form a stable contract`) was updated to
include `cliBtwUseCountAllTime` in the sorted key list.

## What's not changed

- The Memory Execution scorer's own `rawScore` computation — it already used
  `maxProbe` directly and was unaffected.
- Any cooked-telemetry Execution signal — this change only touches the
  `signalsSummary` projection layer.
- The `/btw` counting logic itself — `maxProbe` still takes the higher of
  the transcript scan and `history.jsonl` counts for the windowed field.

## Follow-up: CCE-79

The deeper redesign — replacing the fungible numerator sum in the Memory
Execution scorer with a per-field semantic model — is tracked as CCE-79.
That PR will narrow the numerator to `/clear + /compact` session-coverage,
surface `/btw` as cumulative evidence text, retire `/rewind` from the
numerator, and recalibrate the rubric target from 92 → 60 to match the
narrowed realistic ceiling.
