---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution Scorers

Two Execution scorers — one for the **Memory & Context Management** dimension and one for **Terminal & Customization** — that derive scores from transcript-scanned posture-command session-coverage counters. Shipped in v0.9.19 / CCE-76 (PR #116). Before this change both dimensions returned `noTelemetry()` and appeared as italic-unmeasured vertices on the radar.

## Why transcript-based, not cooked-telemetry

The cooked telemetry in `~/.claude/usage-data/{facets,session-meta}/*.json` never records individual command invocations. The workaround already used by the `learning` scorer (`★ Insight` banner scan) and the `parallel` scorer (worktree-usage scan) is to gate on `transcripts: true` inside `withGates` and read `signals.transcriptInvocations` / `signals.historyInvocations` instead. Both new scorers follow this exact pattern.

## Session universe: `interactive_or_unknown`

All seven input counters (`/clear`, `/compact`, `/color`, `/voice`, `/focus`, `/btw`, `/rewind`) are posture commands. In `scripts/_usage-data.mjs`, posture commands are counted only when `classifySessionKind` returns `"interactive_cli"` or `"unknown"` — the `allowPosture` guard at line 301. A naive `interactive_only` denominator (`sessionsByKind.interactive_cli`) would violate the CLAUDE.md hard rule that a ratio's numerator must be a subset of its denominator's universe: any session classified as `"unknown"` contributes to the numerator counts but not the denominator, making the ratio potentially exceed 100%.

The fix is a new universe option in `withGates`:

```js
// scripts/insights-signals.mjs
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

Both scorers declare `universe: "interactive_or_unknown"`, which routes the denominator to this new field. The `withGates` function validates the declared universe at construction time and records it as `wrapped.__universe` — the contract tests in `memory-customization-execution-scorers.test.mjs` assert both scorers' `__universe === "interactive_or_unknown"`.

## Counter-class: session-coverage

Each input counter is a **session-coverage** counter: it is incremented at most once per session, regardless of how many times the command appeared in that session. The scanner in `scanTranscriptInvocations` implements this via a per-session boolean flag that is set to `true` on first detection and emitted once after the session finishes draining:

```js
// In the per-message loop:
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;

// After the session drains:
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

This matches the pattern used by `/btw`, `/clear`, `/compact`, `/color`, and `/voice`. Before CCE-76, `focusCommandUses` and `rewindCommandUses` incremented per-message; unifying them to session-coverage removes a counting-class mismatch in the numerator.

## Memory Execution scorer

**Source:** `scripts/score.mjs`, `EXECUTION_SCORERS.memory`

**Numerator:** `/clear` + `/compact` session-coverage hits (CCE-79 refinement — see below).

**Denominator:** `interactiveOrUnknownSessionsAnalyzed`.

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    // …
  },
),
```

`maxProbe(s, field)` reads `Math.max(transcriptInvocations?.[field] ?? 0, historyInvocations?.[field] ?? 0)`. The history source (`~/.claude/history.jsonl`) has higher fidelity for side-channel commands; transcripts have higher fidelity for transcript-only signals. Taking the max avoids under-counting when one source is missing.

### CCE-79 numerator refinement

The original CCE-76 design included `/btw`, `/clear`, `/compact`, and `/rewind` in the ratio numerator. CCE-79 removed `/btw` and `/rewind`:

- `/btw` is a cumulative all-time counter (`cliBtwUseCountAllTime` from `~/.claude.json`), not a 30-day windowed session-coverage counter. Mixing it into a windowed ratio violates the numerator-class rule. It is now surfaced in the evidence string only: `Plus N all-time /btw invocations (cumulative, not in ratio)`.
- `/rewind` is a keyboard shortcut that virtually never appears in transcript text. It remains as a binary next-action probe via the rubric's `satisfiedWhen` predicate but contributes nothing to the ratio.

The rubric target for memory is `92`. The displayed score is `normalize(rawScore, 92) = clamp(round(rawScore / 92 × 100))`.

## Customization Execution scorer

**Source:** `scripts/score.mjs`, `EXECUTION_SCORERS.customization`

**Numerator:** `/color` + `/voice` + `/focus` session-coverage hits.

**Denominator:** `interactiveOrUnknownSessionsAnalyzed`.

```js
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const color = maxProbe(s, "colorCommandUses");
    const voice = maxProbe(s, "voiceCommandUses");
    const focus = maxProbe(s, "focusCommandUses");
    const sum = color + voice + focus;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    // …
  },
),
```

The rubric target for customization is `80`.

## Cap visibility

Both scorers cap the displayed score at 100 via `Math.min(rawRatio, 1)`, but when `rawRatio > 1` the evidence string surfaces the actual value:

> Customization commands: 30 session-coverage hits across 10 interactive_cli∪unknown sessions (100%) — capped from 300% (multiple customization commands per session)

This happens because summing `/color + /voice + /focus` can double-count a session that used more than one of them. The cap prevents the displayed score from exceeding 100; the suffix prevents the over-use from being invisible. A true union count (`sessionsWithAnyCustomizationCommand`) would eliminate the double-counting at the scanner layer — deferred to a later PR.

## Error handling and gap states

`withGates` checks three conditions before passing control to the scorer body:

| Condition | Gap reason returned |
|---|---|
| `s.insights` is absent | `GAP_REASONS.NO_INSIGHTS` |
| `s.insights.transcriptsScanned` is falsy | `GAP_REASONS.NO_TRANSCRIPTS` |
| `interactiveOrUnknownSessionsAnalyzed === 0` | `GAP_REASONS.NO_SESSIONS` |

When any gap reason is returned, `gapReason !== null`, and the radar renders the vertex as italic-unmeasured. When the scorer body runs and returns `gapReason: null`, the vertex becomes a solid data point regardless of whether the score is 0 (zero usage in window) or 100.

Missing `transcriptInvocations` or `historyInvocations` objects are handled by optional-chaining + `?? 0` inside `maxProbe`, which collapses to a score of 0 and a gap message rather than a NaN or thrown error.

## Data flow

```
~/.claude/projects/*/*.jsonl  (transcript files)
        │
        ▼
scanTranscriptInvocations
  allowPosture: sessionKind === "interactive_cli" || "unknown"
  per-session flags → increment once per session after drain
        │
        ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
signals.historyInvocations.{…}CommandUses
        │
        │  maxProbe(s, field) = Math.max(transcript, history)
        │
        ▼
EXECUTION_SCORERS.memory / .customization
  denom = s.insights.interactiveOrUnknownSessionsAnalyzed
  sum   = maxProbe(clear) + maxProbe(compact)          [memory]
        = maxProbe(color) + maxProbe(voice) + maxProbe(focus)  [customization]
  rawScore = Math.round(Math.min(sum / denom, 1) * 100)
        │
        ▼
normalize(rawScore, d.target)  →  Execution vertex on the radar
  (target=92 for memory, target=80 for customization)
```

## Testing

The test file `scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers:

- `unavailable` when insights are absent, transcripts not scanned, or zero sessions
- Perfect ratio, cap-fires case, zero-signal gap message
- History-source contribution via MAX-merge
- `__universe` contract: both scorers' `__universe === "interactive_or_unknown"`
- Numerator-subset-of-denominator: `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for any fixture

PR #116 grew the test suite from 647 to 666 passing tests (19 net-new: 11 memory, 4 customization, 1 universe contract, plus the counter-class unification test-value flip and gather-insights numerator-subset test).

## What to check when scores look wrong

- **Both dimensions showing italic/unmeasured on the radar:** `scoring.includeTranscripts` is not set to `true` in `assessment.config.json`, or `--include-transcripts` was not passed to `npm run assess`.
- **Score stuck at 0:** Check that the session window contains interactive sessions (`sessionsByKind.interactive_cli` or `sessionsByKind.unknown` non-zero in the insights block). Zero interactive sessions returns `NO_SESSIONS`.
- **Score lower than expected for heavy `/btw` users:** `/btw` is no longer in the memory ratio. It appears as evidence text but does not raise the score. Use `/clear` and `/compact` to raise Memory Execution.
- **Cap suffix appearing in evidence:** You are using multiple memory or customization commands per session. The capped score of 100 is correct; the suffix is informational.
