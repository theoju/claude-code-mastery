---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending the `/btw` command counter (CCE-78, PR #119)

`signalsSummary.btwCommandUses` used to be a `Math.max()` blend of two
fields that don't actually measure the same thing:

- `cliBtwUseCount` — a **cumulative, all-time** invocation count of `/btw`,
  read straight off `~/.claude.json`.
- `btwCommandUses` — a **30-day windowed, session-coverage** signal (did
  `/btw` fire in *this* session), produced the same way as every other
  posture-command counter via `maxProbe(signals, "btwCommandUses")`.

`Math.max(maxProbe(signals, "btwCommandUses"), cliBtwUseCount)` in
`buildSignalsSummary` (`scripts/run-assessment.mjs`) looked like a
reasonable "take whichever signal is stronger" merge. It wasn't: it fed a
lifetime counter into a field whose whole contract is *recent* session
coverage. Any account with `/btw` habit history — even one that had gone
quiet for months — would report as if the habit were active in the current
30-day window, silently inflating the Memory Execution ratio's numerator.

## What CCE-78 found

The corruption follows the two-axis check CLAUDE.md now states as a hard
rule: classify every field going into a ratio numerator on **(a) time
window** (windowed vs. cumulative) and **(b) counter class**
(session-coverage vs. raw invocation count) before summing or blending it
with an existing numerator input. `cliBtwUseCount` fails both axes against
`btwCommandUses` — cumulative vs. windowed, and (implicitly) raw count vs.
deduped-per-session — so it never belonged in the same `Math.max`.

Worth noting: the Memory Execution *score* itself was never wrong. The
scorer body in `scripts/score.mjs` already reads `maxProbe(...)` directly
against the raw signals, bypassing `signalsSummary` entirely. Only the
`signalsSummary` surface — the flat map the rubric's `satisfiedWhen`
predicates evaluate against — was corrupted. That surface still matters:
it's what next-action gating and the probes page read.

## The fix

Two changes, both in `scripts/run-assessment.mjs`:

1. Drop the blend. `btwCommandUses` in `signalsSummary` is now
   `maxProbe(signals, "btwCommandUses")` alone — the same windowed,
   session-coverage shape as its sibling posture counters
   (`voiceCommandUses`, `clearCommandUses`, `compactCommandUses`,
   `colorCommandUses`, `fewerPermsCommandUses`).
2. Expose the cumulative counter separately, under its own name:
   `cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0`.

The rubric's `btw-side-channel` next-action (Boris tip 33/54, in the
`memory` dimension of `app/data/rubric.json`) is rerouted to match:

```diff
- "satisfiedWhen": "btwCommandUses>=1"
+ "satisfiedWhen": "cliBtwUseCountAllTime>=1"
```

That reroute is itself the correct fix, not a compromise. `btw-side-channel`
is a one-time-habit-adoption check ("have you ever used `/btw`") — exactly
the semantics a cumulative counter is supposed to answer. The bug was never
that `cliBtwUseCount` fed a predicate; it was that it fed the wrong one
(a windowed ratio numerator) via the blend.

`app/data/probe-catalog.json` and the living tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) were
updated for the new field: probe count 47→48, `signalsSummary` key count
71→72.

## Why this matters beyond one field

CLAUDE.md now carries this as a standing hard rule (see "Per-field semantic
categorization before adding to any numerator"), with CCE-78's `/btw` case
as the reference example. The failure mode is easy to reintroduce because
it *looks* like defensive engineering — "take the max of two sources of the
same signal so a weaker probe can't regress the score" — and that pattern
is legitimately correct elsewhere in the same file (e.g. merging
`history.jsonl` command mentions with JSONL transcript scans, which *are*
the same time window and counter class). The distinguishing question is
always: are both inputs windowed the same way, and do they count the same
thing? If not, they go on separate `signalsSummary` fields, not into one
`Math.max`.

## What's still open

The Memory Execution scorer's numerator composition — which fields it sums,
and whether `/btw`, `/clear`, `/compact`, and `/rewind` belong in one ratio
at all — is a separate, deeper redesign filed as **CCE-79**. This PR only
restores the `signalsSummary` field semantics; it doesn't touch the scorer
body.
