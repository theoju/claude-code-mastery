---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory + Customization get real Execution scorers (CCE-76 / PR #116)

Before this change, two of the twelve scored dimensions — Memory & Context
Management and Terminal & Customization — rendered italic and unmeasured on
the Execution radar. The scorer for both was `noTelemetry()`: cooked
telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never carried
a per-command breakdown, so there was nothing to score against. PR #116 fixes
that by giving `memory` and `customization` real ratio scorers in
`EXECUTION_SCORERS` (`scripts/score.mjs`), closing the last gap in Execution
coverage. As of this PR, all twelve dimensions have an Execution scorer —
Model & Effort Tuning remains the only *partially*-measured one (Opus usage
is scored from transcripts; effort level stays settings-only).

## Why `noTelemetry()` was the wrong call

The reasoning that put Memory and Customization behind `noTelemetry()` was
correct about the data source but wrong about the conclusion: cooked
telemetry doesn't carry command breakdowns, but "Execution" isn't limited to
cooked telemetry. Two other dimensions already mixed transcript signals into
Execution scoring — `learning` scans transcripts for the `★ Insight` banner,
`parallel` scans for worktree usage — both via `withGates({ transcripts:
true, … })`. The posture-command counters this PR consumes
(`clearCommandUses`, `compactCommandUses`, `colorCommandUses`,
`voiceCommandUses`, `focusCommandUses`, and friends) were already being
scanned out of `~/.claude/projects/*/*.jsonl` transcripts for Platform Setup
credit; PR #116 is the same signal, read a second time for the Execution
axis.

## Closing the numerator/denominator universe gap

The posture-command counters in `scanTranscriptInvocations`
(`scripts/_usage-data.mjs`) are gated by `allowPosture`, which admits
sessions classified `interactive_cli` **or** `"unknown"` — the conservative
fallback CCE-71 introduced for transcripts `classifySessionKind` can't
confidently place (truncated or legacy-format sessions). That partition
predates this PR. The existing `interactive_only` universe in `withGates`,
however, gates on the strict `interactiveSessionsAnalyzed =
sessionsByKind.interactive_cli` count — narrower than the numerator's
`interactive_cli ∪ unknown` set. Scoring the new dimensions against
`interactive_only` would have violated the numerator-subset-of-denominator
rule this project has enforced since the PR #97 planning-ratio bug (a ratio
whose numerator draws from a broader session set than its denominator can
exceed 100%, silently masked by the score's cap).

PR #116 closes the gap by adding a matching universe. `gatherInsightsSignals`
(`scripts/insights-signals.mjs`) now computes and returns
`interactiveOrUnknownSessionsAnalyzed`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` (`scripts/score.mjs`) accepts a third `universe` option,
`"interactive_or_unknown"`, alongside the existing `interactive_only` and
`all_sessions`, routing to that new denominator. Every `EXECUTION_SCORERS`
entry records its chosen universe as `__universe` on the wrapped function so
tests — and the methodology page — can audit the contract directly.

## Counter-class unification

Two of the seven posture counters, `focusCommandUses` and
`rewindCommandUses`, had been counted as raw per-message invocation totals
rather than per-session-coverage hits, an artifact of when each counter was
first added. The other five (`btwCommandUses`, `clearCommandUses`,
`compactCommandUses`, `colorCommandUses`, `voiceCommandUses`) already
incremented once per session that used the command at least once. PR #116
retrofits `focusCommandUses` and `rewindCommandUses` onto the same
session-coverage pattern in `scanTranscriptInvocations`, so a ratio scorer
summing multiple counters over a session-count denominator has uniform units
throughout — every numerator term is a "did this session use the command at
least once" hit, not a mix of hits and raw counts.

## What the scorers do today

Read directly from `EXECUTION_SCORERS.memory` and `.customization` in
`scripts/score.mjs`, both gated `withGates({ transcripts: true, universe:
"interactive_or_unknown" })`:

- **Memory** sums `clearCommandUses` and `compactCommandUses` (via the
  `maxProbe` helper, which MAX-merges the transcript-scanned count against
  the `history.jsonl`-scanned count for the same field) and divides by
  `interactiveOrUnknownSessionsAnalyzed`, capped at 1.0. `/btw` is **not**
  in this ratio — it's a cumulative all-time counter
  (`signalsSummary.cliBtwUseCountAllTime`), surfaced only as evidence text
  ("Plus N all-time /btw invocations, cumulative, not in ratio"), never
  blended into a windowed numerator. `/rewind` is likewise excluded from the
  ratio and left as a binary next-action probe. Both exclusions post-date
  PR #116 itself — CCE-79's per-field semantic audit found that the
  original numerator (`btw + clear + compact + rewind`) mixed a cumulative
  counter and a near-zero binary signal into a windowed session-coverage
  sum, and narrowed it to the two counters that actually share a semantic
  class. `memory.target` in `app/data/rubric.json` moved from 92 to 60 in
  the same pass, to match the narrower realistic ceiling.
- **Customization** sums `colorCommandUses`, `voiceCommandUses`, and
  `focusCommandUses` (same `maxProbe` merge) over the same denominator,
  also capped at 1.0.

Both evidence strings surface the cap explicitly when it fires — "capped
from N%" — rather than letting `Math.min(ratio, 1)` quietly present a clean
100 when a session used more than one covered command. A session that ran
both `/clear` and `/compact` contributes 1 to each counter, so multi-command
sessions inflate the raw ratio above 1.0; the evidence string is how a user
finds that out instead of assuming perfect single-command coverage.

## What this means for the radar

The Execution vertices for Memory and Customization stop rendering
italic-with-footnote and start rendering as ordinary solid scores — the
`RadarChart` component's italic/opacity treatment is driven by
`gapReason !== null`, and both scorers now return `gapReason: null` whenever
transcripts have been scanned and at least one interactive-or-unknown
session exists in the lookback window. If a user runs without
`--include-transcripts`, or has zero qualifying sessions in the window, the
`withGates` wrapper still routes to `unavailable()` (`NO_TRANSCRIPTS` /
`NO_SESSIONS`) and the dimension falls back to unmeasured for that run — the
new scorers don't force a score out of missing data, they just stop being
permanently gated when the data is present.
