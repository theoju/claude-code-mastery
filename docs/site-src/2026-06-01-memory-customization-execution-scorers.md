---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution Scorers (CCE-76 / CCE-79)

PR #116 (CCE-76) replaced the `noTelemetry()` stubs for the **Memory & Context
Management** and **Terminal & Customization** Execution scorers with real ratio
scorers derived from transcript posture-command counts. A follow-on fix (CCE-79)
narrowed the Memory numerator to semantically-consistent inputs. Both changes
are reflected in the code as it stands.

## Background

Before this PR every Execution scorer was either measured or explicitly marked
_unmeasured_ via `gapReason`. Two dimensions were unmeasured for an arguable
reason: cooked telemetry (`~/.claude/usage-data/`) never reports command
invocation breakdowns, so the scorers returned `noTelemetry()` rather than a
real ratio. But `learning` and `parallel` already scored from transcript signals
via `withGates({ transcripts: true, … })`. The same door was open for memory
hygiene and customization commands — it just hadn't been walked through.

The practical cost of the stubs was a misleadingly optimistic Execution
composite. Two low-scoring dimensions were quietly excluded from the average.
Surfacing them dropped the Execution composite from 77 → 66 in the author's
environment, which is the correct signal.

## The `interactive_or_unknown` universe

The posture-command counters (`/btw`, `/clear`, `/compact`, `/rewind`, `/color`,
`/voice`, `/focus`) are all gated by `allowPosture` in
`scripts/_usage-data.mjs`:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

The `"unknown"` branch is a conservative fallback for sessions where
`classifySessionKind` can't determine the kind (truncated, legacy, or
new-format transcripts). Using `interactiveSessionsAnalyzed` (strict
`interactive_cli` only) as the denominator would violate the CLAUDE.md hard
rule from PR #97: **a ratio's numerator must be a strict subset of its
denominator's universe** or the ratio can exceed 100% and the cap silently
masks the violation.

The fix introduces a new universe option in `scripts/insights-signals.mjs`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

And a matching branch in `withGates` in `scripts/score.mjs`:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

Both new scorers declare `universe: "interactive_or_unknown"`. The
`__universe` property is exposed on the wrapped function so tests (and
the methodology page) can audit the contract directly:

```js
expect(EXECUTION_SCORERS.memory.__universe).toBe("interactive_or_unknown");
expect(EXECUTION_SCORERS.customization.__universe).toBe("interactive_or_unknown");
```

## Counter-class unification

Before PR #116, `focusCommandUses` and `rewindCommandUses` incremented
per-message (once per matching line in the transcript). The five other posture
counters (`/btw`, `/voice`, `/clear`, `/compact`, `/color`) had already been
converted to per-session flags — incremented at most once per scanned session.
Using per-message counts in the same numerator as per-session counts silently
inflates the former.

The unification moves `focus` and `rewind` to the same session-flag pattern:

```js
// Before
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// After — flags set per-message, counter emitted once per session
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// … at end-of-session:
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

The predicates `rewindCommandUses>=1` and `focusCommandUses>=1` in
`app/data/rubric.json` are invariant under either counting class (≥ 1
session hit is the same as ≥ 1 message hit for a binary adoption check).
One test value changes: a fixture that exercised two `/rewind` messages in
a single session previously asserted `toBe(2)`; after unification it asserts
`toBe(1)`.

## Scorer formulas

### Memory & Context Management

**File:** `scripts/score.mjs`, `EXECUTION_SCORERS.memory`

```
rawScore = round(min((clearCommandUses + compactCommandUses) / denom, 1) × 100)
displayedScore = clamp(round(rawScore / 60 × 100))
```

Numerator inputs are the MAX-merge of transcript and history counts for
`clearCommandUses` and `compactCommandUses` — each contributes at most one
session-coverage hit per session.

CCE-79 narrowed this from the original four-command form (`/btw + /clear +
/compact + /rewind`). The narrowing was required because the four inputs don't
share a counter class:

| Command   | Source                       | Counter class              |
| --------- | ---------------------------- | -------------------------- |
| `/clear`  | `history.jsonl` (per-session)| session-coverage           |
| `/compact`| `history.jsonl` (per-session)| session-coverage           |
| `/btw`    | `~/.claude.json#btwUseCount` | cumulative all-time count  |
| `/rewind` | `history.jsonl` / transcripts| session-coverage, near-zero|

`/btw` survives in the evidence text as: `"Plus N all-time /btw invocations
(cumulative, not in ratio)"` when `signalsSummary.cliBtwUseCountAllTime > 0`.
`/rewind` remains a binary next-action probe (`rewindCommandUses>=1`) but not
a ratio input — it's almost always typed as Esc-Esc rather than `/rewind`.

The rubric target is **60** (lowered from 92 by CCE-79 to reflect the
realistic ceiling after the numerator narrowed to two commands).

When `rawRatio > 1` — possible when a session uses both `/clear` and
`/compact` — the score saturates at 100 and the evidence string surfaces
`"capped from N%"` so the over-coverage remains visible.

### Terminal & Customization

**File:** `scripts/score.mjs`, `EXECUTION_SCORERS.customization`

```
rawScore = round(min((colorCommandUses + voiceCommandUses + focusCommandUses) / denom, 1) × 100)
displayedScore = clamp(round(rawScore / 80 × 100))
```

Same shape as Memory: MAX-merge from transcript and history, capped at 1.0,
cap surfaced in evidence when fired. All three inputs are session-coverage
counters with reliable sources — no CCE-79 narrowing needed.

The rubric target is **80**.

## Data flow

```
~/.claude/projects/*/*.jsonl
   │
   ▼
scanTranscriptInvocations
   allowPosture: interactive_cli ∪ unknown
   ─ per-session flags ──────────────────────────────────────────────┐
     btw, clear, compact, rewind, color, voice, focus               │
                                                                     │
   ▼                                                                 │
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
signals.historyInvocations.{clear,compact,color,voice,focus}CommandUses
   │                                                                 │
   │ MAX-merge per field (transcript vs history) ───────────────────┘
   │ /rewind is transcript-only (excluded from history COMMAND_LIST)
   │
   ▼
EXECUTION_SCORERS.memory
  denom = interactiveOrUnknownSessionsAnalyzed
  sum   = MAX(transcript.clear, history.clear)
        + MAX(transcript.compact, history.compact)
  ratio = min(sum / denom, 1)
  rawScore = round(ratio × 100)

EXECUTION_SCORERS.customization
  sum = MAX(transcript.color, history.color)
      + MAX(transcript.voice, history.voice)
      + MAX(transcript.focus, history.focus)
  ratio = min(sum / denom, 1)
  rawScore = round(ratio × 100)
   │
   ▼
normalize(rawScore, d.target)  →  radar vertex
  memory:        clamp(round(rawScore / 60  × 100))
  customization: clamp(round(rawScore / 80  × 100))
```

`interactiveOrUnknownSessionsAnalyzed` is computed in
`scripts/insights-signals.mjs` as
`sessionsByKind.interactive_cli + sessionsByKind.unknown`.

## Error-handling gates

`withGates` enforces three early-exit conditions before the scorer body runs:

| Condition | `gapReason` returned |
|---|---|
| `s.insights` absent | `NO_INSIGHTS` |
| `transcripts: true` but `s.insights.transcriptsScanned` is falsy | `NO_TRANSCRIPTS` |
| `interactiveOrUnknownSessionsAnalyzed === 0` | `NO_SESSIONS` |

All three are tested. An absent or empty `transcriptInvocations` / `historyInvocations`
is handled by optional-chaining (`?? 0`) so missing sources produce score 0
with a gap message rather than NaN.

## Tests

19 new tests in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`.
The file covers:

- Three `unavailable` paths per scorer (NO_INSIGHTS, NO_TRANSCRIPTS, NO_SESSIONS)
- Perfect ratio and boundary (rawRatio exactly 1.0, no cap suffix)
- Cap fires at rawRatio > 1 with evidence string verification
- MAX-merge: history source wins over lower transcript count
- CCE-79 regression guards: `/btw` and `/rewind` excluded from Memory numerator;
  `/btw` cumulative count surfaces as evidence text; gap text reflects narrowed inputs
- Realistic mixed input matching the author's baseline environment
- Universe contract: both scorers expose `__universe === "interactive_or_unknown"`

One pre-existing test in
`scripts/__tests__/scan-transcript-invocations.test.mjs` changed: a fixture
with two `/rewind` messages in a single session now asserts `toBe(1)` instead
of `toBe(2)`, reflecting the counter-class unification.

## Impact

- Memory & Customization radar vertices change from italic-unmeasured (dashed,
  0.65 opacity) to solid scored vertices. No UI code change was needed — the
  `gapReason === null` branch in `app/components/RadarChart.tsx` handles this
  automatically.
- Execution composite drops from 77 → 66 in the author's environment because
  two previously-excluded low-scoring dimensions now contribute to the average.
  This is the correct signal: the stubs were hiding real usage deficits in
  `/clear`, `/compact`, `/color`, `/voice`, and `/focus`.
- The methodology page (`app/methodology/page.tsx`) documents the formula,
  universe, cap behavior, and targets for both dimensions in the Execution
  scorers section.
- Five machine-enforced probe-tracker header counts remain unchanged
  (75/12/48/47/71) — no new probe-catalog entries or `satisfiedWhen`
  predicates were added. `interactiveOrUnknownSessionsAnalyzed` lives in the
  cooked-telemetry insights block and received a new Part 1 row in the probe
  tracker spec.

## Related

- Design spec: `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`
- CCE-79 narrowing spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Probe-tracker: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
- Methodology page: `app/methodology/page.tsx` (Execution scorers section)
- Per-command partition that makes these counters trustworthy: CCE-71, PR #110
- Denominator-semantics hard rule that required the new universe: CCE / v0.9.17, PR #97
