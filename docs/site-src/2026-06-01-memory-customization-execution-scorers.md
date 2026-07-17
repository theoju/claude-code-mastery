---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Through v0.9.x, ten of the twelve rubric dimensions had a real Execution
scorer and two — **Memory & Context Management** and **Terminal &
Customization** — rendered as italic, unmeasured radar vertices via
`noTelemetry()`. The data to score them existed in transcripts the whole
time; it just wasn't cooked telemetry, and cooked telemetry was (wrongly)
being treated as a synonym for "Execution." PR #116 (CCE-76) closed the
gap. This page documents the resulting scorer shape as it exists in
`scripts/score.mjs` today, including the CCE-79 follow-up that narrowed
the memory numerator.

All twelve dimensions are now measured on the Execution axis. Model &
Effort Tuning remains the only *partially*-measured one — the Opus-usage
half is scored from transcripts, effort level stays settings-only.

## Why cooked telemetry alone wasn't enough

`~/.claude/usage-data/{facets,session-meta}/*.json` — the same files
`/insights` reads — never contains a command-invocation breakdown. There's
no field that says "this session ran `/clear`." That's a real constraint,
but CLAUDE.md's original phrasing conflated it with a stronger claim:
"Execution can only be cooked telemetry." Two other dimensions had already
disproved that — `learning` scores off a transcript scan for the `★
Insight` banner, and `parallel` scores off a transcript scan for worktree
usage. Memory and customization needed the same move: a transcript-derived
scorer gated by `withGates({ transcripts: true, ... })`, sitting alongside
the cooked-telemetry scorers rather than pretending to be one.

The seven candidate transcript counters — `/btw`, `/clear`, `/compact`,
`/rewind` for memory; `/color`, `/voice`, `/focus` for customization —
already existed as **posture-command** counters in
`scripts/_usage-data.mjs`, partition-gated to `interactive_cli ∪ "unknown"`
sessions since CCE-71. That gating is what makes them trustworthy: an
SDK-orchestrated or subagent session running with default posture can't
inflate the numerator just by echoing a command string.

## The new `interactive_or_unknown` universe

Every Execution scorer's numerator has to be a strict subset of its
denominator's session universe — that's the hard rule PR #97 established
after the planning scorer briefly reported "36/34 multi-task sessions
(105.88%)." The posture-command counters are gated to `interactive_cli ∪
"unknown"`, but the existing `interactive_only` universe
(`s.insights.interactiveSessionsAnalyzed`) is strict `interactive_cli`. A
naive reuse of `interactive_only` as the denominator would violate the
rule the moment a single `"unknown"`-classified session used `/clear`.

So `scripts/insights-signals.mjs` computes a matching denominator:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` in `scripts/score.mjs` gained a third universe option
alongside `interactive_only` and `all_sessions`:

```js
// - "interactive_only":       s.insights.interactiveSessionsAnalyzed
// - "interactive_or_unknown": s.insights.interactiveOrUnknownSessionsAnalyzed
// - "all_sessions":           s.insights.sessionsAnalyzed
```

`"unknown"` is a conservative fallback `classifySessionKind` returns when a
transcript is truncated, legacy-shaped, or otherwise unclassifiable —
CCE-71 chose to keep counting posture commands from those sessions rather
than silently drop the signal. Widening the denominator to match, instead
of tightening the counters to drop `"unknown"`, is the smaller and more
principled fix: it doesn't undo CCE-71's conservatism, and it keeps the
existing `interactive_only` scorers (permissions, learning, planning)
untouched.

Both `memory` and `customization` now declare
`__universe === "interactive_or_unknown"`, and that contract is asserted
directly in `scripts/__tests__/memory-customization-execution-scorers.test.mjs`.

## Counter-class unification: `/focus` and `/rewind`

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented
**per invocation** in `_usage-data.mjs` — a session that ran `/rewind`
twice contributed 2. The other five posture counters (`/btw`, `/clear`,
`/compact`, `/color`, `/voice`) already incremented **per session**
(session-coverage: at most 1 per session, regardless of repeat use) at the
canonical pattern near the end of `scanTranscriptInvocations`. The mismatch
was an artifact of when each counter was added, not an intentional
distinction.

This PR retrofit `/focus` and `/rewind` onto the same session-coverage
class — a per-session flag hoisted next to the existing `sessionHasBtw`
et al., incremented once at session-emit time rather than at every match.
That makes every one of the seven numerator terms across both new scorers
a uniform unit: one hit per session that used the command at least once.
Without the unification, summing raw invocation counts against a
per-session denominator would have overweighted commands that fire
multiple times per session (`/rewind` especially, since it's a rewind
checkpoint people sometimes hit repeatedly mid-task).

## Memory Execution scorer

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const ratio = Math.min(sum / denom, 1);
    const score = Math.round(ratio * 100);
    // ...evidence, gaps
  },
),
```

`maxProbe` reads a field from both `transcriptInvocations` and
`historyInvocations` and returns whichever is higher — history has better
fidelity for side-channel commands, transcripts for others; the max
recovers whichever source actually saw the invocation.

**This is narrower than what PR #116 originally shipped.** The initial
CCE-76 numerator summed all four candidate fields: `/btw + /clear +
/compact + /rewind`. That didn't survive scrutiny — `/btw`'s
`cliBtwUseCountAllTime` counter is cumulative-all-time, not windowed, and
`/rewind` is a near-zero, keyboard-shortcut-triggered signal that behaves
more like a binary adoption flag than a rate. Summing three different
counter classes into one ratio numerator is exactly the failure mode
CLAUDE.md's per-field semantic table warns against. **CCE-79** (landed
after CCE-76) redesigned the numerator down to the two fields that are
actually windowed, session-coverage signals: `/clear` and `/compact`. The
other two didn't disappear from the page — they moved:

- **`/btw`** now surfaces as evidence text off `cliBtwUseCountAllTime`
  (cumulative, explicitly labeled "not in ratio") rather than contributing
  to the score.
- **`/rewind`** dropped out of the Execution ratio entirely and stays as a
  binary `rewindCommandUses>=1` next-action probe in the rubric — it still
  gates a recommendation, it just doesn't move this particular number.

The rubric's `memory.target` was recalibrated from 92 to **60** to match
the narrower, more honest ceiling — see
`scripts/__tests__/memory-customization-execution-scorers.test.mjs` Test
12f, which asserts the target directly against `app/data/rubric.json`
rather than trusting a comment to stay accurate.

The cap is visible, not silent. If a session used both `/clear` and
`/compact`, it contributes to both counters — summing them can push
`sum / denom` above 1.0. `Math.min(ratio, 1)` bounds the displayed score to
100, but the evidence string still reports the uncapped percentage:

```
Memory hygiene commands: 8 session-coverage hits across 10 interactive_cli∪unknown sessions (80%) — capped from 300% (multiple memory commands per session)
```

A reader sees the over-use rather than a misleadingly clean 100. A true
per-session union counter (`sessionsWithAnyMemoryCommand`) would eliminate
the double-count at the source; that's deferred to a later pass since it
needs a new scanner-layer signal.

## Customization Execution scorer

Same shape, three inputs, no CCE-79-style narrowing (all three fields were
already windowed session-coverage counters, so there was nothing to split
out):

```js
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const color = maxProbe(s, "colorCommandUses");
    const voice = maxProbe(s, "voiceCommandUses");
    const focus = maxProbe(s, "focusCommandUses");
    const sum = color + voice + focus;
    const ratio = Math.min(sum / denom, 1);
    const score = Math.round(ratio * 100);
    // ...evidence, gaps
  },
),
```

Same cap-visibility behavior applies: `rawRatio > 1` appends a
`capped from N%` suffix to the evidence string.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations   (allowPosture: interactive_cli ∪ unknown)
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │  history.jsonl MAX-merge via maxProbe()
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   │
   ▼
normalize(rawScore, d.target) → radar vertex
   (memory.target = 60, customization.target = 80)
```

## Failure modes

Both scorers route through the shared `withGates` gate chain before their
body ever runs:

| Condition | Result |
| --- | --- |
| `s.insights` missing | `unavailable(GAP_REASONS.NO_INSIGHTS)` |
| `s.insights.transcriptsScanned` falsy | `unavailable(GAP_REASONS.NO_TRANSCRIPTS)` |
| `interactiveOrUnknownSessionsAnalyzed === 0` | `unavailable(GAP_REASONS.NO_SESSIONS)` |
| Missing `transcriptInvocations` / `historyInvocations` | optional-chained to `0` via `maxProbe`, score computes to 0 with a gap string, not a crash |

An `unavailable()` result keeps `gapReason !== null`, which is what tells
`RadarChart.tsx` to render the vertex italic. Once real signal exists,
`gapReason` is `null` and the vertex renders solid — no radar-component
change was needed for these two dimensions to stop looking unmeasured.

## Tests

`scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers
both scorers directly against hand-built `signals` literals — gate
failures, perfect-ratio and cap-fires cases, the MAX-merge between
transcript and history sources, the CCE-79 numerator narrowing (`/rewind`
no longer contributes; `/btw` surfaces only as evidence text), and the
`__universe` contract. A companion assertion in the insights-signals test
suite checks `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed`
for arbitrary fixtures — the machine guard for the numerator-subset rule
this design exists to satisfy.

## Related

- Design spec: `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`
- Probe tracker: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  (Insights/cooked-telemetry layer gained the `interactiveOrUnknownSessionsAnalyzed`
  row; the seven affected counters carry a footnote back to this change)
- CCE-71 — the posture/volume command partition that makes these counters
  trustworthy in the first place
- CCE-79 — the memory-numerator redesign referenced above
