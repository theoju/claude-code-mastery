---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution Scorers (CCE-76)

**PR #116 · CCE-76 · shipped 2026-06-01**

Two of the twelve scored dimensions — **Memory & Context Management** and
**Terminal & Customization** — previously returned `noTelemetry()` from their
Execution scorers, appeared italic and greyed on the radar, and were excluded
from the Execution composite. PR #116 replaces both stubs with real ratio
scorers derived from transcript-scanned posture-command counts, closing the
gap so all twelve dimensions carry Execution vertices.

The immediate consequence: the Execution overall drops (77 → 66 on the
author's setup) because two previously-excluded, low-scoring dimensions now
enter the average. That drop is the honest result, not a regression.

---

## Background: why these two dimensions were unmeasured

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never
records per-command invocation breakdowns. The `noTelemetry()` stub was
correct about cooked telemetry but conflated it with "Execution" altogether.

Two other dimensions already mix transcript signals into Execution scoring:

- **Learning** scores the `★ Insight` banner via `withGates({ transcripts: true, … })`.
- **Parallel** scores worktree usage via the same gate.

CCE-76 extends the same pattern to Memory and Customization. The transcript
signals already existed as partition-gated posture-command counters (from
CCE-71). They just weren't wired to Execution scorers yet.

---

## The `interactive_or_unknown` universe (new denominator)

The CLAUDE.md hard rule from PR #97 requires that a ratio's **numerator must
be a strict subset of its denominator's universe** — otherwise the ratio can
exceed 100% and the cap silently masks the violation.

The seven posture commands (`/btw`, `/clear`, `/compact`, `/rewind`, `/color`,
`/voice`, `/focus`) are gated by `allowPosture` in `_usage-data.mjs` to
`interactive_cli ∪ "unknown"`. The existing `interactiveSessionsAnalyzed`
denominator covers only strict `interactive_cli`, so a naive scorer using
that denominator would violate the rule (any `"unknown"` session contributes
to the numerator but not the denominator).

The fix: a new denominator signal and a new universe option in `withGates`.

**`scripts/insights-signals.mjs`** computes:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

**`scripts/score.mjs` — `withGates`** now accepts `universe: "interactive_or_unknown"`
and routes it to the new denominator:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

The universe is stamped as `wrapped.__universe` on the scorer function so
tests and the methodology page can audit the contract without inspecting the
scorer body.

Why widen the denominator rather than tighten `allowPosture` to
`interactive_cli` only? CCE-71 deliberately included `"unknown"` as a
conservative fallback for sessions where `classifySessionKind` can't determine
kind (truncated, legacy, or new-format transcripts). Removing `"unknown"` from
the partition would under-count for users with non-standard transcript shapes.
Widening the denominator to match is the principled, smaller-diff fix.

---

## Counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented
**per-message** (total invocation count). The other five posture counters
(`/btw`, `/clear`, `/compact`, `/color`, `/voice`) incremented
**per-session-coverage** (at most once per session, after the session drains).
The mismatch was an artifact of when each counter was added.

PR #116 retrofits `focus` and `rewind` to the session-coverage pattern,
matching lines 407-411 in `_usage-data.mjs`. The change in `_usage-data.mjs`:

```js
// before (per-message)
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after (per-session-coverage)
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// ... (flags reset per session; emitted after session drains)
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

After the unification, every numerator term across both scorers shares the
same unit: **sessions that used the command at least once**.

Impact on existing consumers: predicates `rewindCommandUses>=1` and
`focusCommandUses>=1` are invariant under either counting class. The only
assertion that changed value was `scan-transcript-invocations.test.mjs:247`,
which asserted `toBe(2)` for a session with two `/rewind` messages and was
updated to `toBe(1)` with a rewording to reflect session-coverage semantics.

---

## Memory Execution scorer

**Signals consumed:** `/clear` and `/compact` session-coverage hits (MAX-merged
from `transcriptInvocations` and `historyInvocations`).

**Note on numerator composition (CCE-79):** The scorer originally included
`/btw` and `/rewind` in the numerator. CCE-79 (PR following #116) narrowed
the numerator to `/clear + /compact` only — the two session-coverage signals
with matched semantics. `/btw` is a cumulative all-time invocation count
(not 30-day windowed) and appears as evidence text only; `/rewind` is
effectively a keyboard shortcut rarely typed as a slash command and kept
only as a binary next-action probe. The rubric target was recalibrated
92 → 60 to match the narrowed ceiling.

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
    // evidence surfaces "capped from N%" when rawRatio > 1
    // /btw surfaces as evidence text (cumulative, not in ratio)
    …
  },
),
```

**Rubric target:** 60 (recalibrated by CCE-79; originally 92 from design spec).
`normalize(rawScore, 60)` = `clamp(round(rawScore / 60 × 100))`.

**Gap condition:** both counters read 0 → gap string "No /clear or /compact in
any interactive session".

**Multi-counting note:** a session using both `/clear` and `/compact`
contributes 1 to each counter, so `sum` can exceed `denom`. `Math.min(ratio, 1)`
caps the display. When the cap fires, the evidence string reports
"capped from N%" so the over-count is visible rather than hidden behind a
clean 100/100.

---

## Customization Execution scorer

**Signals consumed:** `/color`, `/voice`, `/focus` session-coverage hits (MAX-merged).

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

**Rubric target:** 80.

**Gap condition:** all three counters read 0 → gap string "No /color, /voice,
or /focus in any interactive session".

Same multi-counting cap-and-report pattern as the memory scorer.

---

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations
  allowPosture = (sessionKind === "interactive_cli" || sessionKind === "unknown")
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │  (per-session-coverage: flag-set per session, emitted once after drain)
   │
   │  history.jsonl MAX-merge for {clear,compact,color,voice,focus}
   │  /rewind is transcript-only — HISTORY_COMMAND_LIST excludes it
   │
   ▼
EXECUTION_SCORERS.memory / .customization
  denom = s.insights.interactiveOrUnknownSessionsAnalyzed
  ratio = min(sum / denom, 1)
  rawScore = round(ratio * 100)
   │
   ▼
normalize(rawScore, d.target)
  → Execution vertex on the radar (solid, not italic)
```

`scoreAll()` runs **before** `buildSignalsSummary()` in `run-assessment.mjs`,
so scorers read raw `signals.transcriptInvocations` and `signals.historyInvocations`
directly. The `maxProbe` MAX-merge is inlined per counter; promoting it out
would create a layering inversion.

---

## Availability gates

Both scorers share the same three-layer gate via `withGates`:

| Gate | Condition | `gapReason` returned |
|------|-----------|----------------------|
| No insights | `!s.insights` | `NO_INSIGHTS` |
| Transcripts not scanned | `!s.insights.transcriptsScanned` | `NO_TRANSCRIPTS` |
| Zero sessions | `interactiveOrUnknownSessionsAnalyzed === 0` | `NO_SESSIONS` |

When any gate fails, the scorer returns `{ score: null, gapReason: … }`, the
radar vertex stays italic, and the dimension is excluded from the Execution
composite. Pass `--include-transcripts` to `npm run assess` (or
`/self-assessment`) to satisfy the transcripts gate.

---

## What didn't change

- **No new probe-catalog entries.** The five machine-enforced header counts
  in the probe-tracker spec stay at 75/12/48/47/71. `interactiveOrUnknownSessionsAnalyzed`
  lives in the cooked-telemetry insights block (tracked in the Part 1 Insights
  layer row), not in `signalsSummary`.
- **No UI changes.** `RadarChart.tsx` already renders italic vertices when
  `gapReason !== null` and solid vertices otherwise. The two dimensions become
  solid automatically once the scorer returns `gapReason: null`.
- **No new `satisfiedWhen` predicates.** Existing predicates
  (`rewindCommandUses>=1`, `focusCommandUses>=1`) are invariant under the
  session-coverage counting change.

---

## Tests

Seventeen tests in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs` cover:

- Unavailability on missing insights, unscanned transcripts, and zero sessions
- Perfect ratio (score = 100), cap behavior with evidence string
- MAX-merge from history source
- Zero-signal gap message
- Realistic author-baseline inputs
- Boundary at `sum === denom` (no cap suffix)
- Partial coverage
- CCE-79 regression checks: `/btw` and `/rewind` excluded from ratio; `/btw`
  cumulative surfaces as evidence text; rubric `memory.target === 60`
- Universe contract: both `EXECUTION_SCORERS.memory.__universe` and
  `.customization.__universe` equal `"interactive_or_unknown"`

A cross-cutting test in the insights-signals suite asserts
`interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for
any fixture — the machine guard for the numerator-subset-of-denominator hard
rule from PR #97.

---

## Related work

| CCE | What |
|-----|------|
| **CCE-71** | Per-command partition gating — established `POSTURE_COMMANDS` / `VOLUME_COMMANDS` split and the `allowPosture` filter that makes these signals trustworthy |
| **CCE-76** | This PR — activates Memory + Customization Execution scorers |
| **CCE-79** | Follow-up — narrowed Memory numerator to `/clear + /compact`; surfaced `/btw` as cumulative evidence text; recalibrated rubric target 92 → 60 |
| **PR #97** | Denominator-universe hard rule (planning scorer fix) that CCE-76 must satisfy |

Model & Effort Tuning remains the only **partially-measured** dimension after
this PR: Opus-usage is scored from transcripts, but effort level is
settings-only and has no Execution signal.
