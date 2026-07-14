---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: un-blending `btwCommandUses` from the cumulative `/btw` counter

PR #119 fixes a scoring bug in the Memory & Context Management Execution
scorer. `signalsSummary.btwCommandUses` — the numerator feeding the `/btw`
side-channel signal in the Memory Execution ratio — was being computed with
a `Math.max` blend across two counters that don't share the same semantics:

- the 30-day windowed, transcript+`history.jsonl` session-coverage count for
  `/btw` usage (a `maxProbe(signals, "btwCommandUses")` call, same pattern
  used for `/focus`, `/schedule`, `/loop`, and the other posture commands), and
- `~/.claude.json`'s `btwUseCount` — a **cumulative, all-time** invocation
  counter that has nothing to do with the 30-day scoring window.

That blend was introduced during the v0.9.15 runtime-adoption-probes cycle,
where the `Math.max` read as a harmless ergonomic shortcut: "take whichever
signal is higher, so we never miss real usage." But it violates the rule this
project has stated plainly since the first time a blend like this bit us
(see the CLAUDE.md entry on not mixing cumulative counters into windowed
ratios): a numerator and its ratio's denominator must share the same time
window, and mixing counter classes — deduped session-coverage vs. raw
invocation count — inside one `sum` or `max` corrupts the ratio regardless of
which operator you use to combine them. A lifetime counter folded into a
30-day numerator only grows; it never resets when the window rolls forward.
The practical effect: the more days you've had Claude Code installed, the
more the Memory Execution score drifts upward from `/btw` alone, independent
of whether you used it in the last 30 days.

## The fix

`scripts/run-assessment.mjs`'s `buildSignalsSummary` now keeps the two
counters separate:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` is now a pure windowed session-coverage signal — safe to
sum into the Memory Execution ratio's numerator alongside `/clear` and
`/compact`, all three on the same 30-day, deduped-per-session footing.
`cliBtwUseCountAllTime` carries the cumulative signal forward on its own
field, where it belongs: a lifetime "have you ever done this" habit check,
not a windowed ratio input.

The rubric's `btw-side-channel` next-action (Boris tips 33 + 54, in the
`memory` dimension) was rerouted to match. It previously gated on the
blended field; it now reads the cumulative counter directly:

```json
{
  "id": "btw-side-channel",
  "action": "Use /btw for side questions while Claude works — Boris tip 33+54",
  "satisfiedWhen": "cliBtwUseCountAllTime>=1",
  "borisTip": [33, 54]
}
```

That's the right home for a `>=1` adoption check anyway — "have you ever
tried this" doesn't need a 30-day window, and routing it off the cumulative
field means the predicate stops depending on whether the last `/btw` call
happened to fall inside the current scoring lookback.

## Why this matters beyond one field

This is the same class of bug the project has now hit twice in the `memory`
dimension. An earlier pass narrowed the Memory Execution numerator from
`/btw + /clear + /compact + /rewind` down to just `/clear` + `/compact` (the
two genuinely windowed, session-coverage signals), surfaced `/btw` as
cumulative evidence text instead of a ratio input, kept `/rewind` as a
next-action probe only, and recalibrated the `memory` dimension's rubric
target from 92 to 60 to match the narrower, more honest ceiling — that's why
`rubric.json` shows `target: 60` today. That pass removed `/btw` from the
ratio's *sum*, but it didn't touch the separate `Math.max` blend sitting
inside the `btwCommandUses` field itself, which is what CCE-78 closes here.
The full per-field semantic audit — walking every remaining numerator input
in every Execution scorer against the two-axis table (time window × counter
class) before it's allowed into a `sum`, not just the ones already flagged —
is still open, tracked as CCE-79.

If you're adding a new field to any Execution ratio's numerator, run it
through both axes before writing the `sum`: is it windowed or cumulative, and
is it a deduped session-coverage count or a raw invocation count? If either
axis differs from what's already in the numerator, it doesn't belong in the
same `sum` — route it to a separate `signalsSummary` field, a separate
predicate, or a separate ratio with a matched denominator instead.

## What else moved in this PR

`app/data/probe-catalog.json`, `app/data/rubric.json`, and the living probe
tracker at `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
were all updated to reflect the `cliBtwUseCountAllTime` field and the
retargeted `btw-side-channel` predicate. No dimension weights or targets
changed in this PR — the `memory` target recalibration (92 → 60) happened in
the earlier CCE-79-adjacent redesign, not here.
