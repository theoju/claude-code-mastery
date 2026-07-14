---
title: v0.9.18 release notes
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: decision
---

# v0.9.18

`package.json` bumps to `0.9.18` in [PR #117](https://github.com/theoju/claude-code-self-assessment/pull/117).
The PR itself carries no code changes — it's a version tag marking the
milestone that closes out 13 PRs merged since v0.9.17 (2026-05-26).

## Headline: all 12 dimensions now have Execution scorers

The PR this release tags is **CCE-76 / PR #116**, which replaced the
`noTelemetry()` placeholders on the Memory & Context Management and Terminal &
Customization Execution scorers with gated ratio scorers:

```js
withGates({ transcripts: true, universe: "interactive_or_unknown" });
```

Both scorers now consume **transcript-derived posture-command coverage
signals** — the `interactive_cli ∪ unknown`-gated counters introduced in
CCE-71 — against the `interactive_or_unknown` session universe
(`sessionsByKind.interactive_cli + sessionsByKind.unknown`). That's a real
shift in what backs those two dims' Execution numbers: they now mix
transcript signals into Execution scoring, following the same precedent
`learning` (`★ Insight` banner) and `parallel` (worktree usage) already set.

Before this PR, Memory & Context Management and Terminal & Customization were
the last two of the twelve rubric dimensions still routing to *unmeasured*
Execution (`gapReason !== null`) rather than a scored ratio. With PR #116
merged, **all twelve dimensions have an Execution-axis scorer** — the radar's
italic-unmeasured convention now only fires for dims whose Execution score
returns a non-null `gapReason` at runtime (e.g. zero interactive sessions in
the scoring window), not for a structurally-missing scorer.

One dimension remains partially measured on purpose: **Model & Effort
Tuning**. The Opus-usage half is scored from transcripts; effort level stays
settings-only, so it doesn't get a full ratio scorer the way the other eleven
do.

## What this means if you're reading scores from this version forward

- If your Memory & Context Management or Terminal & Customization Execution
  score was previously blank/unmeasured on the radar, expect it to populate
  the next time you run `npm run assess --include-transcripts` (or the
  scheduled run, if transcript scanning is enabled) — assuming you have
  `interactive_cli` or `unknown`-kind sessions in the scoring window.
- The score reflects posture-command usage coverage (things like `/clear`,
  `/compact`, and the customization-side posture commands), not raw
  invocation counts — consistent with the posture-vs-volume partition this
  project already enforces for command counting.

## Release mechanics

This is a version-bump-only release commit: `package.json`'s `version` field
moves to `0.9.18`, no other files change in PR #117. The substantive
scoring-fidelity work lives entirely in PR #116 / CCE-76, already merged
ahead of this tag. Treat this page as the release-boundary record for that
milestone, not as a second description of the scorer change itself.
