---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: decision
---

# v0.9.18 release notes

PR #117 bumps `package.json` to `0.9.18`. The PR itself carries no code —
it's a version-tag checkpoint over 13 PRs merged since v0.9.17 (2026-05-26).
Two of those PRs are the headline scoring-fidelity work; the rest are
tracked below by Jira key pending confirmed ticket summaries.

## All twelve dimensions now score Execution (CCE-76)

Before this cycle, Memory & Context Management and Terminal & Customization
were the last two dimensions with no Execution scorer — they measured
whether the tooling was configured (Platform Setup) but not whether you
actually used it. CCE-76 closes both gaps, so all 12 dimensions now report
an Execution score.

Both new scorers consume **transcript-derived posture-command coverage
signals**: the `interactive_cli ∪ unknown`-gated counters introduced in
CCE-71 (see below), evaluated against a new `interactive_or_unknown`
session universe (`sessionsByKind.interactive_cli + sessionsByKind.unknown`).
That's the same pattern already used by the `learning` scorer (the `★
Insight` banner) and the `parallel` scorer (worktree usage) — mixing
transcript signals into cooked-telemetry Execution scoring isn't new here,
just extended to two more dimensions.

One dimension stays partial: Model & Effort Tuning only scores the
Opus-usage half from transcripts, since effort level itself is a
settings-only signal with no transcript trace. On the radar, italicized
"unmeasured" labels now apply strictly to dimensions whose Execution score
returns a non-null `gapReason` (e.g., zero interactive sessions in the
scoring window) — not to a fixed list of dimensions, since that list just
shrank to (effectively) none under normal usage.

## Posture vs. volume command partition (CCE-71)

The command-counting logic that feeds posture-adjacent scorers (Memory,
Customization, and others reading transcript command usage) now honors a
partition between two kinds of slash-command signal:

- **Posture commands** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) are
  counted from transcripts only when the session classifies as
  `interactive_cli` or the conservative `"unknown"` fallback — never from
  `observer`, `sdk_orchestrated`, or `subagent` sessions, which run under
  the SDK's defaults rather than a real user's posture.
- **Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
  are counted across every scanned session kind, since autonomous-workflow
  signal is real regardless of which session type emitted it.

A fail-loud `assertCommandPartition` check runs at module load and catches
drift — disjointness violations, missing session-kind classification, or a
dead classification branch. If `npm run assess` exits non-zero with no
`assessment.json` written, check stderr for a partition-assertion error
here before assuming an environmental problem.

## Also bundled in this checkpoint

The remaining PRs folded into v0.9.18 are linked to Jira keys CCE-57,
CCE-65, CCE-66, CCE-72, and CCE-33. Of those, CCE-72 (ship-journal stage
counters, using a `stageRanInEntry`-style detector across the three
journal format generations) is independently documented elsewhere in the
project's history. The remaining tickets' summaries weren't available when
this page was drafted — treat this section as a placeholder until their
ticket detail is confirmed, rather than a complete account of what shipped
under those keys.

## Net effect

Every dimension in the rubric now has *some* Execution-axis measurement,
closing out the "are you using it?" gap that Platform Setup alone couldn't
answer. If you're auditing a dashboard snapshot from before this release,
expect Memory & Context Management and Terminal & Customization to move
off italic "unmeasured" and onto real scored values the next time you run
`npm run assess`.
