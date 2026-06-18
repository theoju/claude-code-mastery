---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Decision: Memory & Customization Execution Scorers (CCE-76)

**PR #116 · CCE-76 · 2026-06-01**

Before this PR, two of the twelve scored dimensions — Memory & Context Management and Terminal & Customization — returned `noTelemetry()` from their Execution scorers. The radar rendered both with italic labels and a footnote; neither contributed to the Execution average. This meant real usage deficits in those dimensions were invisible and could not surface as next-action recommendations.

## What was blocking measurement

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) contains no command-invocation breakdown, so the original assessment correctly routed these dims to `noTelemetry()`. The mistake was conflating "cooked telemetry" with "Execution." Two other dims already mixed transcript signals into Execution scoring: `learning` (via the `★ Insight` banner scan) and `parallel` (via worktree-usage transcript scan). The posture-command partition from CCE-71 had already gated the relevant counters to `interactive_cli ∪ "unknown"` sessions, eliminating observer/SDK echo inflation. The signal was trustworthy — it just hadn't been wired to a scorer.

## The decision

Replace both `noTelemetry()` stubs with real ratio scorers of the form:

```
score = min(sum_of_session_coverage_hits / interactiveOrUnknownSessionsAnalyzed, 1) × 100
```

- **Memory inputs** (CCE-76 original): `/btw`, `/clear`, `/compact`, `/rewind`
- **Customization inputs**: `/color`, `/voice`, `/focus`

Each input is a session-coverage counter — incremented once per session that used the command at least once, regardless of how many times it appeared in that session.

> **CCE-79 refinement (landed separately):** The Memory numerator was later narrowed to `/clear` and `/compact` only. `/btw` is cumulative all-time (not 30-day windowed) and violates the windowed-vs-cumulative rule; it surfaces as evidence text instead. `/rewind` is a keyboard shortcut that almost never appears as typed text in transcripts (excluded from `HISTORY_COMMAND_LIST`); it was dropped to a binary next-action probe.

## New denominator: `interactiveOrUnknownSessionsAnalyzed`

The CLAUDE.md hard rule from PR #97 requires that a ratio's numerator be a strict subset of its denominator's universe. The posture-command counters gate on `interactive_cli ∪ "unknown"` via `allowPosture`, but the existing `interactiveSessionsAnalyzed` is strict `interactive_cli`. Using that denominator would allow any `"unknown"`-classified session to push the ratio above 100%.

The fix introduces a new denominator signal:

```js
// scripts/insights-signals.mjs
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`"unknown"` is the conservative fallback for sessions where `classifySessionKind` can't determine the kind (truncated, legacy, or new-format transcripts). Including it in the denominator is principled and avoids under-counting for users with non-standard transcript shapes.

`withGates` was extended to accept `universe: "interactive_or_unknown"` as a third option alongside the existing `"interactive_only"` and `"all_sessions"`. The selected universe is recorded on the wrapped function as `__universe` so tests and the methodology page can audit the contract.

## Counter-class unification

Before CCE-76, `focusCommandUses` and `rewindCommandUses` incremented per-message. The other five posture counters had already been unified to per-session. This mismatch was an artifact of when each counter was added. CCE-76 retrofitted the two outliers to the canonical pattern:

```js
// before (per-message)
if (found.has("focus") && allowPosture) counts.focusCommandUses++;

// after (per-session flag, emitted once per session drain)
if (found.has("focus") && allowPosture) sessionHasFocus = true;
// … emit block after session drain:
if (sessionHasFocus) counts.focusCommandUses++;
```

After the unification, the scorer math has uniform units — every numerator term represents one session that used the command at least once.

## Cap visibility

A session that used both `/clear` and `/compact` contributes 1 to each counter. Summing them can produce `rawRatio > 1` even though no individual counter exceeded the denominator. The score is capped to [0, 100], but the cap is surfaced in the evidence string rather than silently applied:

```
Memory hygiene commands: 160 session-coverage hits across 100 interactive_cli∪unknown sessions
(100%) — capped from 160% (multiple memory commands per session)
```

## Score impact

The author's environment post-PR (30-day window, ~120 interactive-or-unknown sessions):

| Dimension | Before | After |
|-----------|--------|-------|
| Memory Execution | italic-unmeasured | 57/100 (CCE-76); 19/100 after CCE-79 recalibration |
| Customization Execution | italic-unmeasured | 3/100 |
| Execution overall | 77/100 | 66/100 |

The Execution overall drop is intentional. Two previously-excluded low-scoring dims joined the average. A higher overall score achieved by hiding weak signal is not better scoring.

## What is not measured

These scorers measure whether you invoke the commands, not whether the underlying workflow is correct. A session using `/compact` aggressively near the context limit scores the same as one using it every 20 messages. The rubric targets reflect that reality — they are calibrated to what a well-configured user actually achieves, not to a theoretical ceiling.

The cleaner approach — tracking `sessionsWithAnyMemoryCommand` as a true union (at most 1 per session regardless of how many memory commands fired) — is deferred to a v2 PR. The current multi-counting risk is mitigated by the cap and the cap-visibility evidence string.

## Files touched

| File | Change |
|------|--------|
| `scripts/_usage-data.mjs` | Hoist `sessionHasFocus`/`sessionHasRewind` to per-session flags; emit after session drain |
| `scripts/insights-signals.mjs` | Compute and return `interactiveOrUnknownSessionsAnalyzed` |
| `scripts/score.mjs` (`withGates`) | Add `"interactive_or_unknown"` universe option and denom branch |
| `scripts/score.mjs` (`EXECUTION_SCORERS`) | Replace `memory` and `customization` `noTelemetry()` stubs |
| `scripts/__tests__/memory-customization-execution-scorers.test.mjs` | 17 new tests (scorer behavior, universe contract, numerator-subset guard) |
| `scripts/__tests__/scan-transcript-invocations.test.mjs` | One assertion flipped `toBe(2)` → `toBe(1)` after counter-class unification |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | New Part 1 row for `interactiveOrUnknownSessionsAnalyzed`; footnote anchors on 7 transcript-counter rows; Part 2 Axis adjustments (P → P+E) |

The five machine-enforced probe-tracker header counts (75/12/48/47/71) are unchanged — no new catalog entries, no new `signalsSummary` keys. The new `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry insights block, not `signalsSummary`.
