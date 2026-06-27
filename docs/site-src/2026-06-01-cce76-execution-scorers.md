---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# CCE-76: Memory & Customization Execution Scorers

**PR #116 · 2026-06-01**

Two of the twelve radar vertices were permanently italic — Memory & Context Management and Terminal & Customization returned `noTelemetry()` from their Execution scorers, surfacing `gapReason` instead of a number. This document records why they were unmeasured, what constraint had to be resolved before they could be scored, and the exact shape of the fix that closed the last Execution coverage gap.

## Why they were unmeasured

The original scoring model said cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) contains no command-invocation breakdowns, so dimensions whose signal is "did you use `/clear` or `/compact` this month?" couldn't be scored without touching transcripts. That reasoning was correct about cooked telemetry but conflated "cooked telemetry" with "Execution scoring" entirely.

The precedent for mixing transcript signals into Execution scoring already existed:

- **Learning** — scores the `★ Insight` banner rate from transcript scans (`transcripts: true` gate in `withGates`)
- **Parallel** — credits worktree usage detected from transcript state, also gated on `transcripts: true`

The counter signals themselves existed too. `scanTranscriptInvocations` in `scripts/_usage-data.mjs` already emitted `clearCommandUses`, `compactCommandUses`, `colorCommandUses`, `voiceCommandUses`, `focusCommandUses`, `rewindCommandUses`, and `btwCommandUses` — all partition-gated to `interactive_cli ∪ "unknown"` via `allowPosture`. The blocker was something else.

## The constraint that blocked it

The CLAUDE.md hard rule from PR #97 / v0.9.17: **a ratio's numerator must be a strict subset of its denominator's universe, or the ratio can exceed 100%.** At the time, `withGates` offered two universe options:

- `"interactive_only"` → denominator = `interactiveSessionsAnalyzed` (= `sessionsByKind.interactive_cli`)
- `"all_sessions"` → denominator = `sessionsAnalyzed`

The seven posture commands are gated by `allowPosture` to `interactive_cli ∪ "unknown"`. A scorer using `universe: "interactive_only"` would put `"unknown"` sessions in the numerator (via `allowPosture`) but not in the denominator — violating the rule. `"all_sessions"` would be too wide (SDK-orchestrated, observer, subagent sessions don't reflect user posture). There was no universe that matched the partition.

## The fix

Three changes shipped together in PR #116.

### 1. New denominator signal

`scripts/insights-signals.mjs` now computes:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

This is forwarded through the `gatherInsightsSignals` return value alongside the existing `interactiveSessionsAnalyzed`. Zero new I/O — `sessionsByKind` was already collected.

### 2. New `"interactive_or_unknown"` universe in `withGates`

`scripts/score.mjs:withGates` now accepts a third universe option. When `universe: "interactive_or_unknown"` is declared, the gate uses `s.insights.interactiveOrUnknownSessionsAnalyzed` as the denominator. The function throws at construction time if an unknown universe string is passed, and stamps `wrapped.__universe` so tests can audit the contract. The existing `"interactive_only"` and `"all_sessions"` scorers are untouched.

### 3. Counter-class unification for `focus` and `rewind`

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented per-message rather than per-session-coverage. The other five posture counters (`/btw`, `/clear`, `/compact`, `/voice`, `/color`) had already been converted to per-session-coverage counting (increment once per session, regardless of how many messages in that session invoked the command). The mismatch was an artifact of when those two counters were added.

This PR aligned them: the per-message increments at `_usage-data.mjs` lines 334–335 became flag sets (`sessionHasFocus = true`, `sessionHasRewind = true`), with matching emit lines after the session loop drain. After the unification, all seven counters have uniform units: one session-coverage hit per session.

One test value changed: `scan-transcript-invocations.test.mjs` had an assertion that a single session with two `/rewind` messages produced `rewindCommandUses === 2`; it now correctly asserts `=== 1`.

## The scorer shapes

Both new scorers follow the same pattern:

```
withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => {
  const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
  // MAX-merge transcript and history sources per counter
  const sum = <numerator terms>;
  const rawRatio = sum / denom;
  const ratio = Math.min(rawRatio, 1);  // cap at 1.0
  const score = Math.round(ratio * 100);
  // surface "capped from N%" when rawRatio > 1
  ...
})
```

**Memory Execution** (`EXECUTION_SCORERS.memory`): numerator is `/clear` + `/compact`, MAX-merged from `transcriptInvocations` and `historyInvocations`. `/btw` and `/rewind` were initially included in the design but removed in CCE-79 (see below). The raw score is normalized against the rubric `memory.target`.

**Customization Execution** (`EXECUTION_SCORERS.customization`): numerator is `/color` + `/voice` + `/focus`, MAX-merged from both transcript and history sources.

The cap is intentional — a session using both `/clear` and `/compact` contributes 1 to each counter, so `sum` can exceed `denom`. The cap prevents the ratio from overstating saturation, and the evidence string surfaces `"capped from N%"` whenever `rawRatio > 1` so you can see the over-counting rather than just reading a clean 100.

## CCE-79 refinement: narrowed memory numerator

A follow-up redesign (CCE-79, same codebase) narrowed the Memory Execution numerator from four inputs (`/btw`, `/clear`, `/compact`, `/rewind`) to two (`/clear`, `/compact`). The reasoning, documented in `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`:

- `/btw` is a **cumulative all-time** invocation count (from `~/.claude.json`), not a 30-day session-coverage counter. Mixing it into a windowed ratio violates the time-window axis of the per-field semantic rule.
- `/rewind` is a keyboard shortcut, never typed as a slash command in transcripts; in practice it reads near-zero. It's kept as a binary next-action probe but removed from the ratio.

After CCE-79, `/btw`'s all-time count surfaces as evidence text via `s.signalsSummary?.cliBtwUseCountAllTime` — informational, not in the ratio. The rubric `memory.target` was also recalibrated from 92 to 60 to match the narrowed numerator's realistic ceiling.

## Score impact

The Execution composite dropped from approximately 77 to 66 after this PR. That is correct and expected: two previously-excluded dimensions joined the average. Memory and Customization were returning no score (not zero — `null`, excluded from the aggregate), so the denominator of the composite was 10 instead of 12. Two low-adoption-signal dims entering the average at their real values pulled it down.

The radar's two formerly-italic vertices for Memory and Customization now render solid. No UI code changed — `RadarChart.tsx` already renders italic + reduced opacity when `gapReason !== null`; the scorers now return `gapReason: null`.

## What didn't change

- **Five machine-enforced tracker header counts** stayed at 75/12/48/47/71. No new probe-catalog entries, no new `satisfiedWhen` predicates, no new `signalsSummary` keys. `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry `insights` block, not `signalsSummary`.
- **All existing scorer universes** are untouched — the `"interactive_only"` and `"all_sessions"` branches of `withGates` are unchanged.
- **The `allowPosture` partition in `_usage-data.mjs`** is unchanged. CCE-71's per-command partition still gates posture commands to `interactive_cli ∪ "unknown"` and volume commands unconditionally.

## Tests

PR #116 added a dedicated test file `scripts/__tests__/memory-customization-execution-scorers.test.mjs` with 17 tests: 11 for the Memory scorer (gates, cap behavior, MAX-merge, zero-signal gap, boundary conditions), 4 for Customization, 1 for the `__universe` contract on both scorers, and 1 numerator-subset-of-denominator assertion in `gather-insights-signals.test.mjs` (verifies `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for any fixture). All hand-built signal literals; no fixture-file dependency.
