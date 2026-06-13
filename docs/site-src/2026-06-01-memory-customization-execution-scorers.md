---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers (CCE-76)

PR #116 activates real Execution scorers for two dimensions — **Memory & Context
Management** and **Terminal & Customization** — that previously fell through to
`noTelemetry()` and appeared as italic, unmeasured vertices on the radar. All
twelve scoring dimensions are now measured on the Execution axis. Model & Effort
Tuning is the only remaining partially-measured dim (Opus-usage half scored from
transcripts; effort level stays settings-only).

## Before and after

| Dimension | Before | After |
| --- | --- | --- |
| Memory & Context Management | italic-unmeasured, excluded from Execution overall | `/clear + /compact` session-coverage ratio |
| Terminal & Customization | italic-unmeasured, excluded from Execution overall | `/color + /voice + /focus` session-coverage ratio |

Both scorers share the same structural shape:

```js
withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => {
  const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
  // ... session-coverage sum / denom, capped at 1.0
})
```

## The `interactive_or_unknown` universe

The transcript scanner's `allowPosture` gate (from CCE-71) counts posture
commands only when `classifySessionKind` returns `"interactive_cli"` or
`"unknown"`. `"unknown"` is the conservative fallback for sessions whose
entrypoint can't be determined (truncated, legacy, or non-standard transcript
shapes).

The existing `interactive_only` universe (`sessionsByKind.interactive_cli`)
excludes unknown sessions from the denominator, which would allow the ratio to
exceed 100% — a violation of the CLAUDE.md hard rule established in PR #97.
CCE-76 adds a new `"interactive_or_unknown"` universe that matches the partition:

```js
// scripts/insights-signals.mjs
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` now accepts three universes — `"interactive_only"`,
`"interactive_or_unknown"`, and `"all_sessions"` — and throws at construction
time for any other value. The wrapped function exposes `__universe` so tests
can assert the contract without running the scorer body.

## Counter-class unification

`focusCommandUses` and `rewindCommandUses` were previously incremented per
message (total invocation count). The other five posture counters (`btwCommandUses`,
`voiceCommandUses`, `clearCommandUses`, `compactCommandUses`, `colorCommandUses`)
all increment per session (session-coverage count, at most 1 per session). This
PR retrofits `focus` and `rewind` to match:

```js
// before (scripts/_usage-data.mjs)
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// ... emitted after the session drain:
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

After the unification every numerator term has the same counter class: one
session-coverage hit per session that used the command at least once.

## Memory Execution scorer

Numerator: `maxProbe(s, "clearCommandUses") + maxProbe(s, "compactCommandUses")`.
`maxProbe` reads the higher of `transcriptInvocations` and `historyInvocations`
for each field, so whichever source saw more of the signal wins.

`/btw` is **not** in the ratio numerator. It is a cumulative all-time invocation
count (`cliBtwUseCountAllTime`) — mixing it into a windowed session-coverage ratio
would violate the windowed/cumulative class boundary (CCE-78/79). It surfaces
instead as evidence text: `"Plus N all-time /btw invocations (cumulative, not in
ratio)."` `/rewind` is also excluded from the ratio; it is kept only as a binary
next-action probe.

When the session-coverage sum exceeds the denominator (possible because two
sessions using both `/clear` and `/compact` each contribute 2 to the sum but only
1 to the denominator), `Math.min(rawRatio, 1)` caps the displayed score. When the
cap fires, the evidence string reports `"capped from N%"` so the over-use is
visible rather than silently clamped to a clean 100.

```js
// scripts/score.mjs — EXECUTION_SCORERS.memory (simplified)
memory: withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => {
  const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
  const clear   = maxProbe(s, "clearCommandUses");
  const compact = maxProbe(s, "compactCommandUses");
  const sum = clear + compact;
  const ratio = Math.min(sum / denom, 1);
  const score = Math.round(ratio * 100);
  // evidence: "Memory hygiene commands: N session-coverage hits across D sessions (R%)"
  // + "capped from N%" suffix when rawRatio > 1
  // + "/btw all-time count" when cliBtwUseCountAllTime > 0
})
```

## Customization Execution scorer

Numerator: `color + voice + focus` session-coverage hits, via `maxProbe`.

```js
// scripts/score.mjs — EXECUTION_SCORERS.customization (simplified)
customization: withGates({ transcripts: true, universe: "interactive_or_unknown" }, (s) => {
  const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
  const color = maxProbe(s, "colorCommandUses");
  const voice = maxProbe(s, "voiceCommandUses");
  const focus = maxProbe(s, "focusCommandUses");
  const sum = color + voice + focus;
  const ratio = Math.min(sum / denom, 1);
  // same capped-from evidence pattern
})
```

Both scorers normalize their raw score against the dimension's rubric target:
`normalize(rawScore, d.target)`. The rubric target for memory is 60; for
customization it is 80. A raw score of 60/100 on memory therefore displays as
100/100 after normalization.

## Score impact on first run

When these two dimensions join the Execution overall average, their initial
scores are typically low because the commands are used infrequently relative to
the full session window. The Execution overall at the author's environment dropped
11 points (77 → 66) on first run post-merge. That is expected correct behavior,
not a regression: two previously-excluded dimensions entered the weight-normalized
average at observed low scores. The `executionOverall` field in `assessment.json`
is recomputed from whichever dimensions produce a non-null `executionScore`, so
the denominator of the average changed, not just the numerators.

## Data flow

```
~/.claude/projects/*/*.jsonl
   │
   ▼  classifySessionKind → interactive_cli or unknown → allowPosture gate
scanTranscriptInvocations
   │  per-session flags: sessionHasClear, sessionHasCompact, etc.
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │
   │  maxProbe() MAX-merges transcriptInvocations and historyInvocations
   │
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   rawScore = round(ratio × 100)
   │
   ▼
normalize(rawScore, d.target) → Execution vertex on radar (solid, not italic)
```

## Test suite

PR #116 added 17 tests in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`:

- **Gate tests** (3): `NO_INSIGHTS`, `NO_TRANSCRIPTS`, `NO_SESSIONS` each return
  `score: null` with the matching `gapReason`.
- **Memory scorer** (11): perfect ratio, cap fires with `"capped from N%"` suffix,
  history-source MAX-merge, `/rewind` excluded from numerator, `/btw` excluded
  from ratio but surfaced as evidence text, zero-signal gap message, realistic
  author baseline (clear=15 compact=8 over 120 sessions → score 19), boundary
  condition at `rawRatio === 1.0`.
- **Customization scorer** (4): perfect ratio, cap fires, zero-signal gap, realistic
  baseline (color=3 focus=1 over 120 sessions → score 3).
- **Universe contract** (1): both `EXECUTION_SCORERS.memory.__universe` and
  `.customization.__universe` equal `"interactive_or_unknown"`.

One pre-existing test changed: `scan-transcript-invocations.test.mjs` line 247
previously asserted `rewindCommandUses` increments to 2 for a session containing
two `/rewind` messages; it now asserts 1 (session-coverage semantic).
