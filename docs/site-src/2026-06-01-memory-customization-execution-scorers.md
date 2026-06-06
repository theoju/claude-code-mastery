---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution Scorers (PR #116 / CCE-76)

PR #116 closes the last measurement gap in the Execution radar. Before this
change, **Memory & Context Management** and **Terminal & Customization** both
returned `noTelemetry()` stubs — their radar vertices were italic, their deficits
invisible to the next-actions ranker, and the Execution overall was silently
inflated. After the merge, all twelve scoring dimensions return a numeric
Execution score.

## What changed

Two `noTelemetry()` stubs in `scripts/score.mjs` were replaced with ratio
scorers that consume transcript-derived posture-command session-coverage signals:

| Dimension                     | Numerator signals                                         | What they measure                              |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Memory & Context Management   | `/clear` + `/compact` session-coverage count              | Active context hygiene per session             |
| Terminal & Customization      | `/color` + `/voice` + `/focus` session-coverage count     | Terminal persona customization per session     |

Both scorers use the `interactive_cli ∪ unknown` session universe — the same
universe already gating the Permission and Planning Execution scorers. Sessions
classified as `sdk_orchestrated`, `observer`, or `subagent` are excluded because
posture commands in those sessions reflect SDK defaults, not your choices.

### Per-session counting fix

`focusCommandUses` and `rewindCommandUses` were previously counted per-message
(each slash-command invocation incremented the counter). This PR unified both
to per-session counting, matching the canonical pattern already used by `/btw`,
`/clear`, and `/compact`. The denominator is now `interactiveOrUnknownSessionsAnalyzed`
— a new denominator signal added alongside the existing `interactiveSessions`
family — and a new `interactive_or_unknown` universe option was added to the
`withGates` constructor to enforce the numerator-subset-of-denominator hard rule.

### What the score drop means

The Execution overall dropped from **77 → 66** post-merge. That is the expected
and correct result. The stubs were masking real deficits: low `/clear`+`/compact`
hygiene and minimal `/color`+`/voice`+`/focus` adoption now appear as honest
gaps rather than missing data. If your radar previously showed two italic vertices
(Memory, Customization), they are now scored vertices — and the deficit, if any,
is now visible to the next-actions ranker so it can surface relevant actions.

## Implementation pattern

These two scorers follow the same `withGates({ transcripts: true })` pattern
already used by:

- **Learning** — `★ Insight` banner from transcript scan
- **Parallel** — worktree usage from transcript scan

The transcript gate is not new infrastructure; it is the documented path for
any Execution signal that can't be derived from cooked telemetry
(`~/.claude/usage-data/`). Posture commands like `/clear` and `/compact`
don't emit telemetry events — they're terminal-side session hygiene that only
appears in the `.jsonl` transcript record.

## Test coverage

The test suite grew from **647 to 666 passing tests** across 16 new
scorer-specific tests plus updates to `insights-signals`, `scan-transcript-invocations`,
and the fixture files. No new `probe-catalog.json` entries or `signalsSummary`
keys were added; the header counts in the probe tracker remain 75 tips /
12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 `signalsSummary`
keys.

## Radar rendering

Before this PR, the radar in `app/components/RadarChart.tsx` rendered Memory
and Customization with italic labels, reduced opacity, and a `¹` footnote
marker — the "unmeasured Execution" treatment. Both vertices are now rendered
normally. The italic/footnote treatment now applies only to dimensions whose
Execution scorer returns `gapReason !== null` (e.g. zero interactive sessions
in the lookback window).
