---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Customization Execution scorers (CCE-76)

PR #116 replaced the two remaining `noTelemetry()` stubs in `scripts/score.mjs`
with real ratio scorers for the **Memory & Context Management** and **Terminal &
Customization** dimensions. After this change all twelve scored dimensions carry
Execution scores; the radar no longer shows any italic-unmeasured vertices for
these two dims.

## Why these two were unmeasured

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never
contains per-command breakdowns — only session-level aggregates. The original
CLAUDE.md note correctly said "cooked telemetry can't measure these." What it
didn't capture was that **transcript signals already existed** for all seven
relevant commands: `/clear`, `/compact`, `/color`, `/voice`, `/focus`, `/btw`,
and `/rewind` were being counted by `scanTranscriptInvocations` with
partition-gating already in place from CCE-71. Mixing transcript signals into
Execution scoring isn't new: the `learning` scorer already reads the `★ Insight`
banner from transcripts; the `parallel` scorer reads worktree usage the same way.
CCE-76 extends that pattern to the remaining two dims.

## The `interactive_or_unknown` universe

The CLAUDE.md hard rule from v0.9.17 (PR #97) requires that a ratio scorer's
**numerator must be a strict subset of its denominator's universe**. The seven
posture-command counters are partition-gated by `allowPosture` in
`_usage-data.mjs:300-301`:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

The `unknown` category is the conservative fallback for sessions where
`classifySessionKind` can't determine the kind (truncated, legacy, or
new-format transcripts). A scorer using `universe: "interactive_only"` would
use `interactiveSessionsAnalyzed = sessionsByKind.interactive_cli` as its
denominator — which excludes `unknown` sessions — while the numerator counters
include them. That violates the hard rule and produces ratios that silently
exceed 100%.

The fix introduces a new `"interactive_or_unknown"` universe option in
`withGates`:

```js
// scripts/insights-signals.mjs
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates({ transcripts: true, universe: "interactive_or_unknown" }, fn)` now
routes to this denominator. Both scorers declare `__universe ===
"interactive_or_unknown"`; a cross-cutting test in
`memory-customization-execution-scorers.test.mjs` asserts the contract at
import time so a future universe-drop fails CI.

## Counter-class unification

Before CCE-76, `focusCommandUses` and `rewindCommandUses` incremented
**per-message** (lines 334-335 of `_usage-data.mjs` at the time). The other
five posture counters incremented **per-session**. The mismatch was an artifact
of when each counter was added; it would have inflated the numerator relative to
a session-coverage denominator, violating the per-field semantic categorization
rule.

The fix converts those two from `counts.focusCommandUses++` inside the message
loop to `let sessionHasFocus = false` / `let sessionHasRewind = false` flags,
set on first sighting within a session and emitted once after the session drain
— the same pattern used by `sessionHasBtw`, `sessionHasClear`, etc. at lines
406-417 of `_usage-data.mjs`. After unification every posture counter is a
session-coverage count (max value = number of interactive-or-unknown sessions
scanned), giving the scorer math uniform units.

## What the scorers measure

### Memory Execution (post-CCE-79 refinement)

The CCE-76 scorer originally summed all four memory commands: `/btw`, `/clear`,
`/compact`, and `/rewind`. A follow-up redesign (CCE-79) narrowed the numerator
after auditing the per-field semantics of each:

| Signal | Counting class | Time window | Verdict |
|---|---|---|---|
| `/clear` | session-coverage | 30-day windowed | ✅ in ratio |
| `/compact` | session-coverage | 30-day windowed | ✅ in ratio |
| `/btw` (`cliBtwUseCountAllTime`) | raw invocation count | cumulative all-time | ❌ shown as evidence text only |
| `/rewind` | session-coverage | 30-day windowed | ❌ near-zero binary signal; kept only as next-action probe |

The current Memory Execution scorer (confirmed in `scripts/score.mjs:977-1009`):

```
numerator = MAX-merge(transcriptInvocations, historyInvocations) for
            clearCommandUses + compactCommandUses
denominator = interactiveOrUnknownSessionsAnalyzed
rawScore = round(min(sum / denom, 1) × 100)
```

`/btw` all-time invocations surface as a plain-language suffix in the evidence
string when non-zero ("Plus N all-time /btw invocations (cumulative, not in
ratio)"), so you can see the adoption signal without it distorting the ratio.
The rubric `target` for memory was recalibrated from 92 → 60 to match the
narrowed realistic ceiling.

Note: `/rewind` is transcript-only regardless — `HISTORY_COMMAND_LIST` in
`_history-data.mjs` excludes it (it's a keyboard shortcut, never typed). The
MAX-merge for rewind always reads 0 from the history side.

### Customization Execution

Sums `/color`, `/voice`, and `/focus` session-coverage hits over
`interactiveOrUnknownSessionsAnalyzed`. All three are session-coverage,
30-day windowed, and genuinely represent interactive posture choices.

```
numerator = colorCommandUses + voiceCommandUses + focusCommandUses
denominator = interactiveOrUnknownSessionsAnalyzed
rawScore = round(min(sum / denom, 1) × 100)
```

Rubric `target` for customization is 80.

### Cap visibility

Both scorers surface when the ratio exceeds 1.0 — which can happen because
summing multiple session-coverage counters double-counts sessions where you used
more than one command in the same session. A session using both `/clear` and
`/compact` contributes 1 to each counter but is still one session. The cap
bounds the displayed score to [0, 100], and the evidence string reports the
uncapped percentage ("capped from N%") so you can see the over-use rather than
a misleadingly clean 100.

## Score deltas

These are **honest measurements of previously hidden deficits**, not
regressions. The unmeasured state was returning `gapReason !== null` and
rendering italic on the radar; switching to `gapReason: null` makes the actual
usage visible.

Author-environment baseline (30-day window, ~120 interactive-or-unknown
sessions):

| Dimension | Before | After |
|---|---|---|
| Memory Execution | italic (unmeasured) | ~16/100 (raw 10/60, narrow CCE-79 numerator) |
| Customization Execution | italic (unmeasured) | ~3/100 (raw 4/80) |
| Execution composite | 77 | ~66 |

The composite drop reflects genuine low posture-command usage in those two
dims, not a scoring error. If you're seeing a similar drop it means you have
the tools configured but aren't firing them regularly in sessions.

## Data flow

```
~/.claude/projects/*/*.jsonl  (transcripts)
   │
   ▼
scanTranscriptInvocations
   allowPosture = (sessionKind === "interactive_cli" || "unknown")
   session-coverage flags: sessionHasClear, sessionHasCompact,
                           sessionHasColor, sessionHasVoice, sessionHasFocus
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │
   │  MAX-merge with historyInvocations (history side = 0 for focus/rewind)
   │
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   rawScore = round(ratio × 100)
   │
   ▼
normalize(rawScore, dim.target) → radar vertex
```

## Fallback behavior

`withGates` short-circuits to an `unavailable` result in three cases:

- `s.insights` is missing → `NO_INSIGHTS`
- `transcripts: true` but `s.insights.transcriptsScanned` is falsy → `NO_TRANSCRIPTS` (run with `--include-transcripts`)
- `interactiveOrUnknownSessionsAnalyzed === 0` → `NO_SESSIONS`

The radar marks the dim italic when any `gapReason !== null` applies.
`NO_TRANSCRIPTS` is the most common non-error case: if you run
`npm run assess` without `--include-transcripts`, these two dims
still show as unmeasured.

## Probe tracker

No new `probe-catalog.json` entries, `satisfiedWhen` predicates, or
`signalsSummary` keys were added. The five machine-enforced header counts in
the probe-tracker spec remain at 75/12/48/47/71. The new
`interactiveOrUnknownSessionsAnalyzed` field lives in the cooked-telemetry
insights block and received a new Part 1 row in the tracker. The Axis column
for affected Boris tip rows was updated from P to P+E for tips whose commands
now feed both Platform Setup and Execution scorers (tips 33, 62 on memory;
tips 27, 40, 60 on customization).
