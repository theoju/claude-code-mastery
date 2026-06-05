---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution scorers — CCE-76

PR #116 activates real Execution scorers for the two dimensions that previously
reported as unmeasured: **Memory & Context Management** and **Terminal &
Customization**. All twelve dimensions now have Execution scorers.

## What changed

Before this PR, `EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization`
both returned `noTelemetry()`. Cooked telemetry (`~/.claude/usage-data/`) never
contains per-command breakdowns for these dimensions, so they were excluded from
the Execution radar and rendered with italic labels and a footnote rather than a
scored vertex.

The fix extends the same transcript-scanning pattern that already powered the
`learning` scorer (`★ Insight` banner detection) and the `parallel` scorer
(worktree usage detection). Two concrete changes make it work:

**1. Counter-class unification.** `focusCommandUses` and `rewindCommandUses`
were previously per-message total-invocation counters. Both are now per-session
session-coverage counters — the same counting class as `/clear`, `/compact`,
`/color`, `/voice`, and `/simplify`. This matters because the ratio scorer needs
a uniform unit in the numerator: a mix of per-message and per-session increments
violates the per-field semantic categorization rule and would produce a
denominator that can't be meaningfully compared against either class.

**2. New denominator universe.** A new signal, `interactiveOrUnknownSessionsAnalyzed`,
counts sessions classified as `interactive_cli ∪ unknown`. The `unknown`
fallback is included because the session-kind classifier conservatively falls
back to `"unknown"` when no SDK/subagent marker is present — treating those
sessions as posture-settable is correct. This universe is wired into
`withGates({ universe: "interactive_or_unknown" })` so the ratio's numerator
(posture-command coverage, which only scans `interactive_cli ∪ unknown`
sessions) is guaranteed to be a subset of the denominator — closing the
numerator-superset-of-denominator bug class identified in PR #97.

With these foundations in place, both scorers are gated on `transcripts: true`
(they require `--include-transcripts`) and return a real ratio rather than
`gapReason !== null`.

## The Execution composite will drop

If you compare your Execution composite before and after upgrading to a build
that includes this PR, you will likely see a drop — in the reference environment
it moved from **77 → 66**. This is expected and correct, not a regression.

Two dimensions that previously contributed zero weight to the Execution average
(because they were excluded as unmeasured) now contribute real, often low,
scores. Posture commands like `/focus`, `/color`, `/voice`, and `/rewind` are
typically rare in raw usage data. The composite reflects your actual practice
across all twelve dimensions rather than the rosier average of only the ten that
were previously measured.

Historical snapshots taken before this PR are not comparable to snapshots taken
after. If you track trends over time, treat the first post-PR run as a new
baseline.

## Which commands feed each scorer

| Dimension | Commands scored (session-coverage) |
| --------- | ----------------------------------- |
| Memory & Context Management | `/clear`, `/compact`, `/rewind` |
| Terminal & Customization | `/color`, `/voice`, `/focus`, `/simplify` |

All seven counters now share the same counting class: each increments by at most
1 per session regardless of how many times the command appears in that session's
transcript. Denominator: `interactiveOrUnknownSessionsAnalyzed` (sessions in the
30-day insights lookback window classified as `interactive_cli` or `unknown`).

`/btw` is **not** in either numerator. It is a cumulative all-time counter
(`cliBtwUseCountAllTime`) with a different time window and counter class; mixing
it into a windowed session-coverage ratio would corrupt the numerator. It is
surfaced as evidence text on the Memory dimension and gates the tip-33 predicate
separately. See the CCE-79 redesign spec for the full per-field semantic
breakdown.

## Running the new scorers

The scorers require the transcript scan opt-in:

```bash
npm run assess -- --include-transcripts
```

Without `--include-transcripts`, Memory and Customization Execution scores
return `gapReason: "no_transcripts"` and the radar renders them italic, same
as before. The `transcripts: true` gate is intentional — transcript scanning is
opt-in because it touches `~/.claude/projects/*/*.jsonl` conversation files.

## Implementation reference

- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed` signal,
  per-session counting logic for `focusCommandUses` and `rewindCommandUses`
- `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `EXECUTION_SCORERS.customization`,
  `withGates({ universe: "interactive_or_unknown" })`
- `scripts/_usage-data.mjs` — `POSTURE_COMMANDS` partition and
  `assertCommandPartition` boundary check
- Design spec (implementation detail):
  `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
