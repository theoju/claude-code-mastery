---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization get real Execution scorers (CCE-76)

Before PR #116, `EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization`
in `scripts/score.mjs` didn't exist — both dimensions routed to a
`noTelemetry()`-style placeholder and rendered as italic, unmeasured vertices
on the radar. CCE-76 closed that gap. As of this PR, **all twelve rubric
dimensions have an Execution scorer** — Model & Effort Tuning is the only one
that stays partially measured (the Opus-usage half is transcript-derived; the
effort-level half is settings-only and has no execution analogue).

## Why cooked telemetry couldn't do this alone

`~/.claude/usage-data/{facets,session-meta}/*.json` — the same cooked
telemetry `/insights` reads — never contains a command-invocation breakdown.
There's no field that says "this session ran `/clear`." That's the reason
these two dimensions sat unmeasured for as long as they did: the obvious data
source doesn't have the signal.

The signal exists in **transcripts**, though. `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` already scans `~/.claude/projects/*/*.jsonl` for
seven "posture" slash commands — `/color`, `/voice`, `/focus`, `/btw`,
`/clear`, `/compact`, `/rewind` — gated so that only `interactive_cli` and
`unknown`-classified sessions count (the `allowPosture` check from CCE-71).
That gating matters: without it, observer and SDK-orchestrated sessions that
echo a primary session's `<command-name>` markup would inflate the counters
with commands the user never actually typed.

CCE-76's move is the same one `learning` (the `★ Insight` banner scan) and
`parallel` (worktree-usage scan) already made: mix a transcript-derived
signal into `withGates({ transcripts: true, … })` Execution scoring. Cooked
telemetry and Execution aren't the same axis — they'd been conflated.

## A new session universe: `interactive_or_unknown`

Every ratio scorer's numerator has to be a strict subset of its denominator's
universe (the hard rule from PR #97 — see CLAUDE.md), or the ratio can exceed
100% and silently mask a bug. The posture-command counters are gated to
`interactive_cli ∪ "unknown"`, but the existing `interactive_only` universe in
`withGates` only counts `interactive_cli`. A memory/customization scorer built
on the existing universe would have violated the rule the moment a single
`"unknown"`-classified session used `/clear`.

The fix, in `scripts/insights-signals.mjs`:

```js
const interactiveSessionsAnalyzed = sessionsByKind.interactive_cli;
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

Both are computed once per `gatherInsightsSignals` run and returned on the
`insights` object. `withGates` in `scripts/score.mjs` grew a third universe
option to match:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

`memory` and `customization` are the only two scorers that pass
`universe: "interactive_or_unknown"` today; every other Execution scorer kept
its existing universe unchanged.

## Counter-class unification: `/focus` and `/rewind` join the session-coverage pattern

Five of the seven posture counters (`/btw`, `/clear`, `/compact`, `/color`,
`/voice`) were already **session-coverage** counts — a per-session flag that
flips once and increments the total after the session drains, so the count
never exceeds the number of sessions scanned. `/focus` and `/rewind` were
still **raw invocation counts**, incrementing on every matched message. That
mismatch would have let a single chatty session inflate a ratio numerator
past its session-bounded denominator.

`scanTranscriptInvocations` now tracks `sessionHasFocus` / `sessionHasRewind`
flags alongside the other five (`sessionHasBtw`, `sessionHasClear`, etc.) and
increments `counts.focusCommandUses` / `counts.rewindCommandUses` once per
session, at the same point the other five do:

```js
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

All seven posture counters are session-coverage counts now — every numerator
term the memory and customization scorers use is directly comparable to the
`interactiveOrUnknownSessionsAnalyzed` denominator.

## The two scorers, as implemented

Both scorers read `maxProbe(signals, field)` — the existing `Math.max` merge
between the transcript scanner and the `history.jsonl` side-channel scanner —
for each command, sum them, divide by the session denominator, and cap at
100%:

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
    // ... evidence + "capped from N%" suffix when rawRatio > 1
  },
)
```

Customization's numerator is `/color + /voice + /focus` — unchanged from the
original design. A session that fires more than one of the three (or more
than once) can push `rawRatio` above 1; the evidence string surfaces that as
`— capped from N% (multiple customization commands per session)` instead of
silently showing a clean 100.

**Memory's numerator is narrower than the original CCE-76 design.** The
initial spec summed `/btw + /clear + /compact + /rewind`, but that mixes three
different signal classes in one sum — `/btw`'s companion counter
(`cliBtwUseCountAllTime`) is a cumulative all-time value, not a 30-day
session-coverage count, and `/rewind` is a near-zero, keyboard-shortcut-driven
signal. Per the per-field semantic categorization rule in CLAUDE.md, mixing
those into a windowed session-coverage ratio corrupts it the same way the
`/btw` cumulative counter once corrupted the automation numerator (CCE-78).
The shipped scorer restricts the ratio to the two genuinely comparable
session-coverage inputs:

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
    // btwAllTime surfaced as evidence text only — not part of the ratio
  },
)
```

`/btw`'s cumulative count still shows up — as evidence text appended to the
memory scorer's output (`Plus N all-time /btw invocations (cumulative, not in
ratio)`), sourced from `signalsSummary.cliBtwUseCountAllTime`. `/rewind`
carries no ratio contribution at all; it remains a rubric next-action
(`rewindCommandUses>=1`, Boris tip 62) gated on the same transcript-only
counter, just not summed into the Execution score.

Both scorers' `rubric.json` targets predate a realistic-ceiling recalibration:
`memory.target` is `60` and `customization.target` is `80` (normalized via
the same `round(rawScore / target × 100)` formula every other dimension
uses), tuned down from the memory dimension's original `92` once its
numerator narrowed to two inputs instead of four.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations   (allowPosture: interactive_cli ∪ unknown;
                              /focus, /rewind now session-coverage)
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │  MAX-merged against signals.historyInvocations.* (maxProbe)
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   │
   ▼
normalize(rawScore, d.target) → radar vertex (memory target=60, customization target=80)
```

## What didn't change

- No new `probe-catalog.json` entries, `satisfiedWhen` predicates, or
  `signalsSummary` keys came out of this PR — `interactiveOrUnknownSessionsAnalyzed`
  lives on the cooked-telemetry `insights` object, not `signalsSummary`.
- The Platform Setup `customization` scorer (the one keyed off
  `focusCommandUses` directly in `SCORERS.customization`, not
  `EXECUTION_SCORERS.customization`) was untouched — it already read the
  session-coverage-shaped counter via `s.focusCommandUses ??
  s.transcriptInvocations?.focusCommandUses`.
- Every other Execution scorer's `universe` is unchanged; `interactive_or_unknown`
  is currently exclusive to `memory` and `customization`.

## Tests

`scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers
both scorers: `unavailable` on missing insights / unscanned transcripts /
zero-session denominator, perfect-ratio and capped-ratio cases, the
`maxProbe` history-merge path, and the `__universe === "interactive_or_unknown"`
contract. `scripts/__tests__/insights-signals.test.mjs` asserts
`interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` — the
numerator-subset-of-denominator guard for the new universe.
`scripts/__tests__/scan-transcript-invocations.test.mjs` covers the
session-coverage behavior of `/focus` and `/rewind` post-unification.
