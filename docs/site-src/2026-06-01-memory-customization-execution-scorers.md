---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers (CCE-76)

PR #116 replaces the last two `noTelemetry()` stubs with live Execution scorers,
completing all twelve dimensions. Memory & Context Management and Terminal &
Customization both now produce real radar vertices instead of italic-unmeasured
placeholders.

## Why these two were last

The Execution axis reads from two sources: cooked telemetry
(`~/.claude/usage-data/`) for session-volume and integration signals, and
transcript scans (`~/.claude/projects/*/*.jsonl`) for behavioral signals gated
to interactive sessions. Learning (★ Insight banner) and Parallel (worktree
usage) already used the transcript path. Memory and Customization needed the
same infrastructure — per-session counts of posture commands — but it wasn't
wired up yet. CCE-76 extends the existing pattern rather than waiting for
cooked-telemetry support.

## Session universe

Both scorers use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.

The `interactive_or_unknown` universe is the union of `interactive_cli` and
`unknown`-classified sessions. `sdk_orchestrated`, `observer`, and `subagent`
sessions are excluded: those run with SDK defaults and contribute noise to
posture ratios, not signal. The denominator for both scorers is
`interactiveOrUnknownSessionsAnalyzed`, a new signal added to
`insights-signals.mjs` that counts sessions in this universe over the scoring
window.

This gate matches the CCE-71 posture-command partition: the same `interactive_cli
∪ unknown` guard that controls which sessions contribute posture-command counts
also controls the denominator. Numerator and denominator are drawn from the same
universe by construction.

## Memory & Context Management scorer

The Memory Execution scorer counts sessions in which the user ran at least one
of four posture commands:

| Command    | Signal field             |
| ---------- | ------------------------ |
| `/btw`     | `btwCommandUses`         |
| `/clear`   | `clearCommandUses`       |
| `/compact` | `compactCommandUses`     |
| `/rewind`  | `rewindCommandUses`      |

All four counts are per-session (deduplicated): a session that used `/compact`
three times counts once in the numerator. The ratio is
`sessions_with_any_memory_command / interactiveOrUnknownSessionsAnalyzed`,
normalized against the rubric target.

**Note — CCE-79 follow-up**: A subsequent redesign restricts the Memory
numerator to `/clear + /compact` only, recalibrates the rubric target from 92
to 60, and demotes `/btw` to cumulative evidence text (it's a lifetime
invocation count, not a session-coverage counter) and `/rewind` to a
next-action probe (near-zero binary signal). See
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md` for
the per-field semantic table and the rationale for restricting the numerator to
matched counter classes.

## Terminal & Customization scorer

The Customization Execution scorer counts sessions with at least one of three
appearance/UX posture commands:

| Command   | Signal field          |
| --------- | --------------------- |
| `/color`  | `colorCommandUses`    |
| `/voice`  | `voiceCommandUses`    |
| `/focus`  | `focusCommandUses`    |

The ratio is `sessions_with_any_customization_command / interactiveOrUnknownSessionsAnalyzed`.

## Per-session counting unification

Before this PR, `focusCommandUses` and `rewindCommandUses` were counted
per-message (incremented on each matching assistant turn). The other five posture
counters were already per-session. PR #116 normalizes both to per-session,
so every posture counter in the Memory and Customization scorers is
semantically consistent: one increment per session, regardless of how many
times the command fired within that session. This matters for the ratio
arithmetic — per-message counts in a per-session ratio can exceed 100%.

## Radar rendering

Before CCE-76, both dimensions appeared on the radar with italic labels and a
`¹` footnote indicating unmeasured Execution. After PR #116, they render as
solid vertices. A dimension's label becomes italic only when its Execution
scorer returns `gapReason !== null` (e.g., zero interactive sessions in the
scoring window). With a non-empty `interactive_or_unknown` universe, both
dimensions will produce a numeric score.

## What changed in each file

| File | Change |
| ---- | ------ |
| `scripts/insights-signals.mjs` | Added `interactiveOrUnknownSessionsAnalyzed` signal; unified `focusCommandUses` and `rewindCommandUses` to per-session counting |
| `scripts/score.mjs` | Replaced `noTelemetry()` stubs for `memory` and `customization` with `withGates({ transcripts: true, universe: "interactive_or_unknown" })` ratio scorers |
| `app/methodology/page.tsx` | Full formula breakdowns for both new scorers |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Tracker updated: Part 1 registry rows, Part 2 tip-coverage, header counts |
| `scripts/__tests__/` | Targeted unit coverage for both scorers and the new denominator signal |
