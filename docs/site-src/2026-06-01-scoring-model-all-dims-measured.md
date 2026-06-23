---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Scoring model: all twelve Execution dimensions measured

**Ticket:** CCE-76 · **PR:** #116 · **Date:** 2026-06-01

As of PR #116, every dimension on the Execution radar has a real scorer. The
two that were previously marked italic-unmeasured — **Memory & Context
Management** and **Terminal & Customization** — now return scored values
instead of `noTelemetry()` placeholders. This page records the architectural
decisions behind the change: why the existing pattern couldn't be applied
unchanged, what was added, and the invariants that must hold going forward.

---

## Before: two dimensions returning `noTelemetry()`

`scripts/score.mjs` organizes Execution scorers in `EXECUTION_SCORERS`.
Before PR #116, two entries called `noTelemetry()`:

```js
memory: noTelemetry(),
customization: noTelemetry(),
```

`noTelemetry()` returns `{ score: null, gapReason: "no_telemetry" }`. The radar
renders those vertices with italic labels and a footnote — visually distinct but
not scored. The rationale at the time was correct: cooked telemetry
(`~/.claude/usage-data/{facets,session-meta}/*.json`) does not contain
per-command invocation breakdowns, so there was nothing to count.

What the rationale missed: the transcript scanner (`scanTranscriptInvocations`
in `scripts/_usage-data.mjs`) already counted all seven posture commands
involved — `/btw`, `/clear`, `/compact`, `/rewind` for Memory; `/color`,
`/voice`, `/focus` for Customization — and two other Execution scorers
(`learning` via `★ Insight` banner, `parallel` via worktree usage) already
consumed transcript signals through `withGates({ transcripts: true, … })`.
The mechanism was in place; the scorers just weren't wired.

---

## What changed

Three coordinated changes landed in the same PR.

### 1. Counter-class unification

Two posture-command counters — `focusCommandUses` and `rewindCommandUses` —
were counted per-message (every matching line in every session incremented the
counter). The other five posture counters (`btwCommandUses`, `clearCommandUses`,
`compactCommandUses`, `colorCommandUses`, `voiceCommandUses`) were already
session-coverage counters: a flag flips on first sighting per session, and
the counter increments once when the session is drained.

Per-message counting is the wrong unit for a ratio denominated in sessions.
PR #116 retrofitted the two outliers to match. In `_usage-data.mjs`, lines
334-335:

```js
// before
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

`sessionHasFocus` and `sessionHasRewind` were hoisted to the per-session reset
block (alongside the existing `sessionHasBtw`, `sessionHasClear`, etc.) and
matching emit lines were appended after the existing flush block at line 411.
After unification all seven posture counters have identical semantics: one
session-coverage hit per session, regardless of how many times the command
appeared in that session.

### 2. New denominator: `interactiveOrUnknownSessionsAnalyzed`

The posture-command counters are gated by `allowPosture`:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`"unknown"` is the conservative fallback for sessions where
`classifySessionKind` cannot determine the kind (truncated, legacy, or
new-format transcripts). Before PR #116, `interactiveSessionsAnalyzed` was the
only available denominator, and it equals `sessionsByKind.interactive_cli`
— strict `interactive_cli` only. Using it for the new scorers would violate
the CLAUDE.md hard rule from PR #97: the numerator (which includes `unknown`
sessions) would not be a subset of the denominator's universe, and the ratio
could exceed 100%.

PR #116 adds the matching denominator to `scripts/insights-signals.mjs`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

This is forwarded through the return value alongside the existing
`interactiveSessionsAnalyzed`. The new field is in the cooked-telemetry
insights block, not `signalsSummary`, so no machine-enforced header counts
changed.

### 3. New `"interactive_or_unknown"` universe in `withGates`

`withGates` wraps every Execution scorer with gate checks (missing insights,
transcripts not scanned, zero sessions in the universe). It selects the
denominator based on `opts.universe`. PR #116 adds a third option:

```js
// Before: two options
universe !== "interactive_only" && universe !== "all_sessions"
// After: three options
universe !== "interactive_only" &&
universe !== "interactive_or_unknown" &&
universe !== "all_sessions"
```

The denominator branch:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

The `__universe` property is stamped on the wrapped function so tests and the
methodology page can audit the contract without re-reading the scorer body.

---

## The two new scorers

Both scorers use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.
The gate returns `unavailable` when: `s.insights` is absent, transcripts were
not scanned, or `interactiveOrUnknownSessionsAnalyzed === 0`.

### Memory Execution scorer

Numerator: session-coverage hits of `/clear` + `/compact`, MAX-merged across
`transcriptInvocations` and `historyInvocations` per counter.

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
    // evidence includes "capped from N%" when rawRatio > 1
    // /btw (cumulative all-time) shown as evidence text, not in ratio (CCE-79)
    // /rewind kept as a binary next-action probe only (CCE-79)
    …
  },
),
```

Note: the initial CCE-76 design included `/btw` and `/rewind` in the ratio
numerator. CCE-79 (PR TBD) narrowed the numerator to the two cleanest
session-coverage signals (`/clear`, `/compact`), routed `/btw` to
`cliBtwUseCountAllTime` as evidence-only text, and dropped `/rewind` from the
ratio (near-zero binary signal, kept as a next-action predicate). The
`withGates` wrapper and the `interactive_or_unknown` universe are unchanged
from CCE-76.

### Customization Execution scorer

Numerator: session-coverage hits of `/color` + `/voice` + `/focus`, MAX-merged
across transcript and history sources.

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
    // evidence includes "capped from N%" when rawRatio > 1
    …
  },
),
```

Both scorers surface a "capped from N%" suffix in the evidence string when
`rawRatio > 1` — a session that used both `/color` and `/voice` contributes one
hit to each counter, and summing those hits can push the ratio above 1. The cap
bounds the displayed score to [0, 100]; the evidence text preserves the
over-use signal so it isn't hidden.

---

## Multi-counting risk and the cap

Because the seven posture counters are per-command-per-session (not
per-session-with-any-command), a session using two memory commands contributes
1 to `/clear` and 1 to `/compact`. The ratio numerator can exceed the
denominator; `Math.min(rawRatio, 1)` clamps the score.

This is intentional at PR #116 scope. A cleaner approach — counting
`sessionsWithAnyMemoryCommand` as a single union signal — would require a new
scanning pass. That's deferred to a follow-up PR. The evidence string makes the
inflation visible when it fires.

---

## Score effect

The Execution composite dropped from 77 → 66 at the author's environment after
PR #116 landed. That's honest measurement, not regression: two low-scoring
dimensions (Memory Execution ~16, Customization Execution ~3 — or lower,
post-CCE-79 refinement) joined the average rather than sitting outside it as
unmeasured.

The italic vertices on the radar (`app/components/RadarChart.tsx`) become solid
automatically: the radar's italic/footnote logic gates on `gapReason !== null`,
and both scorers now return `gapReason: null` when data is available.

---

## Invariants going forward

1. **Numerator universe ⊆ denominator universe.** Any future scorer whose
   numerator is gated by `allowPosture` (`interactive_cli ∪ unknown`) must use
   `universe: "interactive_or_unknown"`, not `"interactive_only"`. Using the
   narrower denominator produces ratios that exceed 100% for users with
   `unknown`-classified sessions.

2. **Counter-class homogeneity.** All posture-command counters in
   `_usage-data.mjs` are now session-coverage. If a new posture counter is
   added, it must follow the same flag/emit pattern (`let sessionHasX = false;`
   in the reset block; `if (sessionHasX) counts.xCommandUses++;` after the
   drain). Never increment inside the per-line loop.

3. **Transcripts gate is mandatory.** The `transcripts: true` gate on both
   scorers means `--no-transcripts` routes them to `unavailable(NO_TRANSCRIPTS)`
   rather than scoring 0. That's correct: a score of 0 for "no data" is
   indistinguishable from "used no memory commands," which is misleading.

4. **`__universe` is auditable.** Tests assert
   `EXECUTION_SCORERS.memory.__universe === "interactive_or_unknown"` and
   the same for `.customization`. Don't remove the `wrapped.__universe` stamp
   from `withGates`.

---

## Tests

PR #116 added 19 tests across a new file
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`,
bringing the full suite to 666. Tests cover: `unavailable` paths (no insights,
transcripts not scanned, zero sessions), perfect ratio, cap-fires-with-evidence,
MAX-merge from history source, zero-signal gap message, realistic mixed input,
boundary at exactly-one ratio, and the `__universe` contract for both scorers.
A numerator-subset-of-denominator assertion in `insights-signals.test.mjs`
machine-guards the PR #97 corollary: `interactiveOrUnknownSessionsAnalyzed >=
interactiveSessionsAnalyzed` for any fixture.

---

## Related

- **CCE-71** — per-command partition (`allowPosture`) that makes these counters
  trustworthy for posture measurement.
- **CCE-76** — this PR; the primary work tracked here.
- **CCE-79** — follow-on that refined the Memory scorer numerator
  (`/clear + /compact` only; `/btw` as evidence text; `/rewind` dropped from
  ratio). The `withGates` mechanism and universe from CCE-76 are unchanged.
- **PR #97 / v0.9.17** — established the numerator-subset-of-denominator hard
  rule; the `interactive_or_unknown` universe is a direct consequence.
- `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`
  — full design spec with validation history.
