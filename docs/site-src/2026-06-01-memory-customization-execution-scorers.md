---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers (CCE-76)

PR #116 / CCE-76 replaced the last two `noTelemetry()` stubs in
`EXECUTION_SCORERS` with real ratio scorers backed by transcript-derived
posture-command signals. Before this change, the Memory and Terminal &
Customization dimensions appeared as italic, unmeasured vertices on the
radar — honest about the gap, but leaving two of twelve dimensions unscored
on the Execution axis. After it, all twelve dimensions carry real Execution
scores when transcripts are enabled.

## Why these two were unmeasured

The original `noTelemetry()` stubs existed because cooked telemetry
(`~/.claude/usage-data/{facets,session-meta}/*.json`) never contains
command-invocation breakdowns — you can see that a session ran, but not
which slash commands the user typed. The stubs were correct about cooked
telemetry, but they conflated "cooked telemetry" with "Execution." Two
other dimensions — `learning` (via the `★ Insight` banner) and `parallel`
(via worktree-state entries) — already mixed transcript signals into
Execution scoring via `withGates({ transcripts: true, … })`. CCE-76
extends that pattern to Memory and Customization.

The transcript signals were already collected. CCE-71 (the per-command
partition) had introduced partition-gated posture-command counters in
`scanTranscriptInvocations` with `allowPosture` gating to
`interactive_cli ∪ "unknown"`, eliminating echo-inflation from
observer/SDK-orchestrated sessions. What was missing was the scorer
bodies that consumed those counters.

## The `interactive_or_unknown` universe

The CLAUDE.md hard rule from PR #97 / v0.9.17 says a scorer's numerator
must be a strict subset of its denominator's universe or the ratio can
exceed 100% — a violation the cap then silently masks. The posture-command
counters are gated by `allowPosture` to `interactive_cli ∪ "unknown"`, but
the existing `withGates({ universe: "interactive_only" })` denominator
(`interactiveSessionsAnalyzed`) covers only strict `interactive_cli`
sessions. Any session classified as `"unknown"` (truncated transcript,
legacy format, new entrypoint) contributes to the numerator but not the
denominator — a superset-numerator bug.

The fix adds a third universe option rather than tightening `allowPosture`.
CCE-71 deliberately included `"unknown"` as a conservative fallback to
avoid under-counting for users with non-standard transcript shapes;
removing that inclusion would silently regress those users. Widening the
denominator to match is the principled fix.

In `scripts/insights-signals.mjs`, a new field is computed immediately
after `interactiveSessionsAnalyzed`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` in `scripts/score.mjs` is extended to accept
`universe: "interactive_or_unknown"` and routes to this new field:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

The wrapped function exposes `__universe` so tests and the methodology
page can audit which universe each scorer uses.

## Counter-class unification (focus, rewind)

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented
once **per matching message**, while the other five posture counters
(`btwCommandUses`, `voiceCommandUses`, `clearCommandUses`,
`compactCommandUses`, `colorCommandUses`) already incremented once
**per session** — flag-set at first sighting, emitted after the session
drain. The mismatch was an artifact of when each counter was added.

CCE-76 unifies them. In `scanTranscriptInvocations`, the lines that
previously did `counts.focusCommandUses++` and `counts.rewindCommandUses++`
per message become:

```js
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

with `let sessionHasFocus = false; let sessionHasRewind = false;` hoisted
to the per-session reset block, and matching emit lines after the session
drain. After the unification, every term in both scorers' numerators has
the same unit: one session-coverage hit.

## The scorers

Both scorers share the same shape:
`withGates({ transcripts: true, universe: "interactive_or_unknown" }, fn)`.
The `transcripts: true` gate means they return `unavailable(NO_TRANSCRIPTS)`
unless `--include-transcripts` was passed to `npm run assess`.

### Memory Execution scorer

The numerator is the session-coverage count for `/clear` and `/compact`,
MAX-merged across transcript and history scanners (history has higher
fidelity for side-channel commands). `/btw` is cumulative all-time rather
than windowed — routing it into a windowed ratio numerator would violate
the time-window / counter-class semantic rules (CLAUDE.md §"Per-field
semantic categorization"). It appears as evidence text instead. `/rewind`
is a keyboard shortcut that almost never appears in transcripts; it is
excluded from the ratio and kept only as a binary next-action probe.

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear  = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    // /btw surfaces as cumulative evidence text, not in ratio.
    // /rewind dropped from ratio; kept as a binary next-action probe.
    …
  },
),
```

The cap (`Math.min(rawRatio, 1)`) bounds the displayed score to [0, 100]
without silently hiding over-use: when `rawRatio > 1` (a session used both
`/clear` and `/compact`, counting once toward each), the evidence string
says "capped from N%" so you see both the capped score and the actual
coverage density.

### Customization Execution scorer

The numerator is the session-coverage count for `/color`, `/voice`, and
`/focus`, MAX-merged across transcript and history scanners.

```js
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const color = maxProbe(s, "colorCommandUses");
    const voice = maxProbe(s, "voiceCommandUses");
    const focus = maxProbe(s, "focusCommandUses");
    const sum = color + voice + focus;
    …
  },
),
```

The same cap-and-surface pattern applies. The gap message fires when all
three counters are zero across the lookback window.

## Data flow

```
~/.claude/projects/*/*.jsonl  (transcripts)
   │
   ▼
scanTranscriptInvocations
   allowPosture = (sessionKind === "interactive_cli" || sessionKind === "unknown")
   per-session flags → {clear,compact,color,voice,focus,rewind}CommandUses
   │
   │  MAX-merge with historyInvocations per field
   │  (/rewind: history-side always reads 0 — HISTORY_COMMAND_LIST excludes it)
   │
   ▼
signals.transcriptInvocations / signals.historyInvocations
   │
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   rawScore = round(ratio * 100)
   │
   ▼
normalize(rawScore, d.target) → displayed Execution vertex on the radar
```

`maxProbe` (defined in `scripts/score.mjs`) reads both sources and returns
the larger value, recovering whichever scanner caught the command. This
handles a real asymmetry: `~/.claude/history.jsonl` has higher fidelity
for commands that never reach the session JSONL (like `/btw`), while
transcripts have higher fidelity for commands fired inside subagent-spawning
workflows.

## Effect on the radar

Before CCE-76, Memory and Customization appeared as italic labels with a
`¹` footnote marker and 0.65 opacity — the `gapReason !== null` branch in
`RadarChart.tsx`. No UI code needed to change: the radical fix is in the
scorer returning `gapReason: null` instead of the `noTelemetry()` sentinel.
Both vertices become solid once `--include-transcripts` is active.

If you run without transcripts, both scorers return
`unavailable(NO_TRANSCRIPTS)` and the italic treatment reappears — the
same honest signal that was there before, for the same reason (we didn't
look at transcripts). Italic on the radar always means "unmeasured, not
zero," never "scored zero for non-use."

## Rubric targets and score calibration

The rubric targets for these dimensions (`app/data/rubric.json`) were
recalibrated alongside this PR. The memory target was set to 60 (from
the prior 92, which was a Platform-Setup–derived weight chosen before
the Execution scorer existed). At target 60, hitting 60% session coverage
with memory hygiene commands saturates the Execution vertex — a realistic
ceiling given that `/clear` and `/compact` are heavy-use workflow tools
but not every session needs explicit context management.

Customization commands (`/color`, `/voice`, `/focus`) are lower-frequency
by nature — they tune the interface once and are rarely re-invoked per
session. The target reflects that baseline.

## Five machine-enforced header counts

No new probe-catalog entries, `satisfiedWhen` predicates, or
`signalsSummary` keys were added by this PR. The five
`tracker-counts.test.mjs`-enforced header counts stay at
**75 / 12 / 48 / 47 / 71**. The new `interactiveOrUnknownSessionsAnalyzed`
field lives in the cooked-telemetry `insights` block — it has its own
probe-tracker rows but is not a `signalsSummary` key and does not increment
any of the five counts.

## Follow-up: CCE-79 (Memory scorer per-field semantics)

The initial CCE-76 design included `/btw` and `/rewind` in the Memory
numerator. The follow-up CCE-79 refined this per the CLAUDE.md hard rule
on per-field semantic categorization:

- `/btw` is a cumulative all-time counter from `~/.claude.json`
  (`cliBtwUseCountAllTime`), not a windowed session-coverage counter.
  Mixing it into a windowed ratio numerator conflates two time-window
  classes. It now surfaces as evidence text only.
- `/rewind` is a keyboard shortcut that almost never appears in transcripts
  and adds near-zero signal. It was removed from the ratio and kept only
  as a binary next-action probe in the rubric's `satisfiedWhen` predicate.

The shipped scorer in `score.mjs` reflects the CCE-79 refinements. Tests
12a–12f in `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
cover the narrowed numerator, the cumulative `/btw` evidence text, and the
recalibrated rubric target.
