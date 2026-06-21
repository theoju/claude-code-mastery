---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# CCE-76 Decision Record: Execution Scorers for Memory & Customization

**PR:** [#116](https://github.com/theoju/claude-code-self-assessment/pull/116)
**Ticket:** CCE-76
**Date:** 2026-06-01
**Status:** Shipped

## Problem

Before PR #116, the `memory` and `customization` dimensions returned `noTelemetry()` on the Execution axis. Both appeared as italic-unmeasured vertices on the radar and were excluded from the Execution composite average. That left ten of twelve dimensions measured and two honest holes, even though transcript-derived signal for both already existed in `scanTranscriptInvocations` via the CCE-71 posture-command partition.

The `learning` and `parallel` dimensions had already established a precedent: mixing transcript signals into Execution scoring through `withGates({ transcripts: true, … })`. CCE-76 extends that pattern to `memory` and `customization`.

## Decisions

### 1. Use the `interactive_or_unknown` universe — not `interactive_only`

**Decision:** Introduce a new `"interactive_or_unknown"` universe option in `withGates` and use it for both scorers.

**Why not `interactive_only`?** The seven posture-command counters (`/btw`, `/clear`, `/compact`, `/rewind`, `/color`, `/voice`, `/focus`) are gated in `scanTranscriptInvocations` by `allowPosture`, which fires when `classifySessionKind` returns `"interactive_cli"` OR `"unknown"`. The `"unknown"` branch is a deliberate conservative fallback from CCE-71 for sessions where the kind can't be determined (truncated, legacy, or non-standard transcript shapes). If you use `universe: "interactive_only"`, the denominator (`interactiveSessionsAnalyzed = sessionsByKind.interactive_cli`) excludes `"unknown"` sessions, while the numerator still includes them — violating the hard rule established in PR #97 that a ratio's numerator must be a strict subset of its denominator's universe.

**Implementation:** `insights-signals.mjs` computes `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown` alongside the existing `interactiveSessionsAnalyzed`. `withGates` gains a third branch that routes to this new denominator. The function records `__universe` on the wrapped scorer so tests and the methodology page can audit the contract. Validation at construction time throws if a caller supplies any string other than the three enumerated values.

**Alternative not taken:** Tighten `allowPosture` to `interactive_cli` only (drop the `"unknown"` branch). This would preserve the existing `interactive_only` denominator but regress CCE-71's conservative fallback and under-count for users with non-standard transcript shapes — a higher cost than widening the denominator.

### 2. Session-coverage counting for all seven posture commands

**Decision:** Unify `focusCommandUses` and `rewindCommandUses` from per-message to per-session increment, matching the pattern the other five posture counters already used.

**Why it matters:** Before this PR, `focusCommandUses` and `rewindCommandUses` incremented on every matching user message (lines 334–335 of `_usage-data.mjs`). The other five counters (`simplify`, `/btw`, `/voice`, `/clear`, `/compact`, `/color`, `/fewer-permission-prompts`) already used per-session flags that incremented once after the session drain. If the memory and customization scorers summed across mixed counting classes — some per-message, some per-session — the numerator units would be incoherent: a session with three `/focus` invocations would contribute 3 to the numerator while a session with three `/clear` invocations contributed 1.

**Implementation:** Lines 334–335 become `sessionHasFocus = true` / `sessionHasRewind = true` flag-sets; `let sessionHasFocus = false; let sessionHasRewind = false;` are hoisted to the per-session reset block alongside the existing `sessionHasBtw` et al.; `if (sessionHasFocus) counts.focusCommandUses++; if (sessionHasRewind) counts.rewindCommandUses++;` append to the emit block after the drain. After this change all seven posture counters have uniform units: one count = one session that used the command at least once.

**Test impact:** `scan-transcript-invocations.test.mjs` had one fixture that wrote two `/rewind` messages in a single session and asserted `toBe(2)`. Under session-coverage this becomes `toBe(1)`. The assertion was updated; no other test values changed.

### 3. Memory Execution scorer numerator: btw + clear + compact + rewind

**Decision (as shipped in CCE-76):** The Memory Execution scorer sums `btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses` over `interactiveOrUnknownSessionsAnalyzed`.

**Counter-source note:** All four are MAX-merged across `transcriptInvocations` and `historyInvocations` via `maxProbe`. `/rewind` is transcript-only — the history scanner excludes it because it's a keyboard shortcut never typed as a slash command; `historyInvocations.rewindCommandUses` always reads zero.

**Follow-on refinement (CCE-79):** After live data revealed that `/btw` is cumulative all-time (not 30-day windowed) and `/rewind` is near-zero, CCE-79 redesigned the Memory numerator to restrict it to session-coverage signals only (`/clear + /compact`). `/btw` was moved to evidence text sourced from `cliBtwUseCountAllTime`; `/rewind` is retained only as a binary next-action probe. The current `score.mjs` reflects the CCE-79 state — this decision record documents the CCE-76 choices and the gap that led to the follow-on.

### 4. Customization Execution scorer numerator: color + voice + focus

**Decision:** The Customization Execution scorer sums `colorCommandUses + voiceCommandUses + focusCommandUses` over `interactiveOrUnknownSessionsAnalyzed`. All three are session-coverage counters after the unification in decision 2.

### 5. Cap at 1.0 with evidence disclosure when the cap fires

**Decision:** Both scorers apply `Math.min(rawRatio, 1)` before rounding to bound the score to [0, 100], but the evidence string surfaces `— capped from N% (multiple … commands per session)` when `rawRatio > 1`. The cap is not silent.

**Why:** A session that uses both `/clear` and `/compact` contributes 1 to each counter. Summing them double-counts that session in the numerator without a matching increment in the denominator. The proper fix — a single `sessionsWithAnyMemoryCommand` aggregate at the scanner layer — was deferred as out of scope. The cap with disclosure is the intermediate mitigation: the displayed score stays ≤ 100 and the evidence string makes the over-counting visible to anyone reading the detail.

## Consequence: Execution composite dropped from 77 to 66

Both new scorers joined the Execution composite average with low initial scores (Memory Execution ~57, Customization Execution ~4 in the author's environment at merge time). The composite decrease is correct and expected — two previously-excluded low-scoring dimensions entered the average. This is the same effect documented in CLAUDE.md's scoring model section: italic-unmeasured dims were excluded from the composite, so their graduation to measured lowered the number. The number became more honest, not worse.

## What didn't change

- **No new probe-catalog entries.** The five machine-enforced header counts in the probe-tracker spec remain at 75/12/48/47/71.
- **No new signalsSummary keys.** `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry `insights` block, which has its own probe-tracker rows but is not part of `buildSignalsSummary`.
- **Radar rendering.** The `RadarChart` component renders italic labels and 0.65 opacity for any dimension whose Execution scorer returns `gapReason !== null`. Because both scorers now return `gapReason: null`, the radar vertices for Memory and Customization automatically became solid — no UI code change required.
- **Model & Effort Tuning.** Still the only partially-measured dimension after this PR. The Opus-usage half is scored from transcripts; effort level remains settings-only.

## Related decisions

- **CCE-71** — established the `allowPosture` per-command partition (`interactive_cli ∪ unknown`) that makes the transcript counters trustworthy. CCE-76 extends the existing pattern rather than inventing new gating.
- **PR #97 / v0.9.17** — established the numerator-must-be-subset-of-denominator hard rule after the `36/34 = 105.88%` planning ratio bug. CCE-76's new `interactive_or_unknown` universe is a direct consequence of applying that rule to the posture-command counter set.
- **CCE-79** — follow-on redesign of the Memory Execution numerator to eliminate the cumulative/windowed counter-class mismatch introduced by including `/btw` in the CCE-76 numerator.
