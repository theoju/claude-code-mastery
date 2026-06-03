---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution Scorers (CCE-76)

**PR #116** replaces the `noTelemetry()` placeholder stubs for the **Memory & Context Management** and **Terminal & Customization** Execution scorers with real ratio scorers. This completes all 12 dimension Execution scorers — two formerly italic-unmeasured radar vertices now produce real scores.

## What changed

Previously, both dimensions returned `gapReason !== null` from their Execution scorer, which caused the radar to render them with italic labels, reduced opacity, and a ¹ footnote indicating unmeasured status. The cooked telemetry in `~/.claude/usage-data/` lacks per-command invocation breakdowns, so there was no direct signal to score against.

The fix extends the transcript-scan pattern already used by the learning (★ Insight banner) and parallel (worktree usage) scorers. Both new scorers are declared with:

```js
withGates({ transcripts: true, universe: "interactive_or_unknown" })
```

The `interactive_or_unknown` universe covers `interactive_cli` plus `unknown` sessions (the conservative fallback kind). Denominator and numerator universes are aligned per the hard rule from PR #97: posture commands are only counted from transcripts where `classifySessionKind` returns `interactive_cli` or `unknown`, so the ratio cannot exceed 100%.

### Memory & Context Management scorer

Counts session coverage across four posture commands: `/btw`, `/clear`, `/compact`, `/rewind`. Each is a MAX-merged per-session counter — a session counts once regardless of how many times the command fires within it.

As a prerequisite, `rewindCommandUses` was unified from per-message to per-session counting, matching the existing pattern for `/btw`, `/clear`, and `/compact`.

### Terminal & Customization scorer

Counts session coverage across three posture commands: `/color`, `/voice`, `/focus`. Same MAX-merge pattern.

`focusCommandUses` was also unified from per-message to per-session counting as part of this work.

### New insights-signals field

`interactiveOrUnknownSessionsAnalyzed` was added to the insights-signals shape as the shared denominator for both scorers. It counts sessions in the `interactive_or_unknown` universe within the scoring window.

## Why transcript-based scoring here

The cooked telemetry in `~/.claude/usage-data/facets/` and `session-meta/` doesn't break down by individual command. The `/insights` surface aggregates usage patterns but doesn't expose per-command invocation counts at session granularity.

The transcript scanner in `scripts/_usage-data.mjs` already walks `~/.claude/projects/*/*.jsonl` for behavioral signals. The posture-command partition introduced in CCE-71 made those signals trustworthy enough to score against by gating them on session kind — posture commands are only counted from `interactive_cli` and `unknown` sessions, not `sdk_orchestrated`, `observer`, or `subagent` sessions where the user isn't setting posture.

## Effect on the dashboard

Before this PR, the Memory and Customization radar vertices rendered italic with reduced opacity and a ¹ footnote. After this PR, both vertices render as normal scored vertices when `interactiveOrUnknownSessionsAnalyzed > 0`.

If you have zero interactive-or-unknown sessions in the scoring window, both scorers still return `gapReason !== null` and the italic rendering applies. That's correct: no signal means no score, not a zero.

## Probe tracker and counts

No new `probe-catalog.json` entries or `signalsSummary` keys were added. The five machine-enforced header counts remain at **75 tips / 12 dims / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys**.

The probe-implementation-status tracker at `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` was updated in this PR to reflect the scorer status change for both dimensions.

The design spec lives at `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`.
