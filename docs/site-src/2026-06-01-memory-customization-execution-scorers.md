---
title: Memory & Customization Execution scorers
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Until PR #116 (CCE-76), two of the twelve dashboard dimensions — **Memory &
Context Management** and **Terminal & Customization** — had no Execution
scorer at all. `scripts/score.mjs` routed both straight to `unavailable(...)`,
so the radar rendered them in italics with a footnote rather than a real
score. The gap wasn't a missing feature so much as a false generalization:
cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) really
doesn't carry a command-invocation breakdown, but that's not the only source
Execution scorers are allowed to read — `learning` and `parallel` already
mixed transcript signals into Execution via `withGates({ transcripts: true,
… })`. This PR extends that precedent to the two remaining dims.

## What changed

- Replaced the `noTelemetry()`-style placeholders for `memory` and
  `customization` in `EXECUTION_SCORERS` (`scripts/score.mjs`) with real ratio
  scorers.
- Added a new `interactive_or_unknown` session universe to `withGates`,
  alongside the existing `interactive_only` and `all_sessions` options.
- Added `interactiveOrUnknownSessionsAnalyzed` to the object returned by
  `gatherInsightsSignals` (`scripts/insights-signals.mjs`) —
  `sessionsByKind.interactive_cli + sessionsByKind.unknown`.
- Unified `/focus` and `/rewind` counting in `scanTranscriptInvocations`
  (`scripts/_usage-data.mjs`) from raw per-message invocation counts to
  session-coverage counts (one increment per session that used the command at
  least once), matching the pattern the other five posture counters
  (`/btw`, `/clear`, `/compact`, `/color`, `/voice`) already used.

Net result: all twelve dimensions now report a measured Execution score. The
composite `executionOverall` shifts because it's a weight-normalized average
over only the dimensions that produced a numeric `executionScore`
(`scores.filter(r => typeof r.executionScore === "number")` in
`scoreAll`) — adding two real, low-usage scores into that average pulls it
down rather than leaving them excluded. In the reference environment this
cycle, the composite dropped from 77 to 66.

## Why `interactive_or_unknown`, not `interactive_only`

The seven posture commands (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
`/compact`, `/rewind`) are counted in `scanTranscriptInvocations` only when
`classifySessionKind` returns `"interactive_cli"` or the conservative
fallback `"unknown"` — see `allowPosture` in `_usage-data.mjs`. That
partition already excludes `sdk_orchestrated`, `observer`, and `subagent`
sessions, whose transcripts can echo `<command-name>` markup the user never
actually typed.

But `interactiveSessionsAnalyzed` (used by every other posture scorer, e.g.
`permissions`, `model-effort`, `learning`) is strictly
`sessionsByKind.interactive_cli` — it doesn't include `"unknown"`. Gating a
new scorer on `withGates({ universe: "interactive_only" })` while its
numerator counts `interactive_cli ∪ unknown` hits would let the numerator
exceed the denominator's universe — exactly the class of bug the project's
numerator-subset-of-denominator rule (established after the PR #97 planning
ratio regression) exists to catch. Rather than narrow `allowPosture` and
lose the `"unknown"` fallback's coverage for non-standard transcript shapes,
this PR widens the denominator to match: `interactive_or_unknown` sums
`sessionsByKind.interactive_cli + sessionsByKind.unknown`, so numerator and
denominator now share the same universe by construction.

## The scorers, as implemented

Both scorers are gated identically:

```js
withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => { ... })
```

`withGates` short-circuits to `unavailable(...)` when `s.insights` is
missing, when transcripts weren't scanned, or when the
`interactive_or_unknown` denominator is zero — so a fresh install or a run
without `--include-transcripts` still gets an honest "unmeasured" rather
than a false zero.

**Memory** (`EXECUTION_SCORERS.memory`) sums two session-coverage counters —
`clearCommandUses` and `compactCommandUses` — read via the `maxProbe(signals,
field)` helper, which takes `Math.max` of the transcript-scanned value and
the shell-history-scanned value (history has better fidelity for commands
that never reach the session JSONL). The ratio is `sum / denom`, capped at 1
before being turned into a 0–100 score.

Notably, the numerator here is **narrower** than the design originally
called for. The first cut of this scorer also summed `/btw` and `/rewind`
into the same ratio, but `/btw` is a cumulative all-time counter and
`/rewind` is a near-zero keyboard-shortcut signal — mixing a cumulative
counter and a raw-invocation signal into a windowed session-coverage sum
violates the project's per-field semantic rule (two counters can only share
a `sum` if they match on both time-window and counter-class). That was
caught and fixed as a same-cycle follow-up (CCE-79): `/btw`'s all-time count
is now surfaced as evidence text only (`s.signalsSummary.cliBtwUseCountAllTime`),
never folded into the ratio, and `/rewind` was dropped from the numerator
entirely and kept only as a binary next-action probe
(`rewindCommandUses >= 1`). The `memory` rubric target was recalibrated
92 → 60 to match the narrowed, more honest ceiling.

**Customization** (`EXECUTION_SCORERS.customization`) sums
`colorCommandUses`, `voiceCommandUses`, and `focusCommandUses` the same way —
`maxProbe` per field, ratio capped at 1, rounded to a score.

Both scorers surface the same honesty detail in evidence: if the raw ratio
exceeds 1 (a session fired more than one of the summed commands, so the sum
legitimately exceeds session count), the evidence string reports the
uncapped percentage — `"… — capped from 250% (multiple memory commands per
session)"` — rather than silently showing a clean 100 that hides the
over-count.

```js
// scripts/score.mjs — shape of both scorers
memory: withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => {
  const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
  const sum = maxProbe(s, "clearCommandUses") + maxProbe(s, "compactCommandUses");
  const rawRatio = sum / denom;
  const score = Math.round(Math.min(rawRatio, 1) * 100);
  // ...evidence + gap when sum === 0
});
```

## Counter-class unification for `/focus` and `/rewind`

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented once
per matched *message* inside `scanTranscriptInvocations`; the other five
posture counters (`/btw`, `/clear`, `/compact`, `/color`, `/voice`)
incremented once per *session* (a per-session flag set on first sighting,
emitted once after the session drains). That mismatch would have put two
different counter classes into the same ratio numerator. The fix hoists
`sessionHasFocus` / `sessionHasRewind` flags next to the existing
`sessionHasBtw` et al. and emits them the same way, so every posture counter
feeding these two scorers is now uniformly a session-coverage count — one
hit per session, regardless of how many times the command appeared inside
it.

## Net effect on the dashboard

`RadarChart.tsx` italicizes and footnotes any dimension whose Execution
entry has `gapReason !== null`. Previously `memory` and `customization`
always had a non-null `gapReason` (routed through `unavailable(...)`); now
`gapReason` is `null` whenever transcripts were scanned and at least one
`interactive_or_unknown` session exists in the lookback window, so both
vertices render solid like the other ten. The methodology page's per-scorer
formula breakdown gets matching sections describing the new measurement
basis instead of "unmeasured."

## Where to look

- `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `EXECUTION_SCORERS.customization`,
  `withGates`, `maxProbe`
- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`
- `scripts/_usage-data.mjs` — `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition,
  the `allowPosture`-gated session-coverage counters, `assertCommandPartition`
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer test suite (gating, cap behavior, zero-signal gaps, universe
  contract)
