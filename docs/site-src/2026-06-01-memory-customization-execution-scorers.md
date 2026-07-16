---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Twelve dimensions are scored on the Execution axis now, not ten. Before
PR #116 (CCE-76), `EXECUTION_SCORERS.memory` and
`EXECUTION_SCORERS.customization` returned `noTelemetry()` and rendered
as italic, unmeasured vertices on the radar — not because the dimensions
weren't real, but because the cooked telemetry `~/.claude/usage-data/`
reads never contained a command-invocation breakdown. That's true, but
it conflated "cooked telemetry has nothing" with "Execution can't be
measured." `parallel` (worktree-usage transcript scan) and `learning`
(`★ Insight` banner scan) already mixed transcript signals into
Execution scoring through `withGates({ transcripts: true, ... })`. This
PR extends the same pattern to the two remaining unmeasured dims.

## What each scorer measures

Both scorers are ratio scorers: session-coverage hits on a small set of
posture slash commands, divided by a session-count denominator, capped
at 1.0.

- **Memory** (`scripts/score.mjs`, `EXECUTION_SCORERS.memory`) sums
  session-coverage counts of `/clear` and `/compact`.
- **Customization** (`EXECUTION_SCORERS.customization`) sums
  session-coverage counts of `/color`, `/voice`, and `/focus`.

Each counter comes from `maxProbe(signals, field)` — a `Math.max` over
`transcriptInvocations[field]` and `historyInvocations[field]`, because
transcripts and `history.jsonl` have different fidelity for different
commands (history sees side-channel commands that never reach the
session JSONL; transcripts see commands fired inside a chained skill
like `/ship`). Both scorers are wrapped in `withGates({ transcripts:
true, universe: "interactive_or_unknown" }, ...)`, so they return
`unavailable(gapReason)` rather than a false zero when `s.insights` is
missing, when transcripts weren't scanned, or when the denominator is 0.

Evidence strings report the raw hit count, the denominator, and the
percentage, and call out explicitly when the cap fired:

```
Memory hygiene commands: 23 session-coverage hits across 120 interactive_cli∪unknown sessions (19.17%)
Customization commands: 4 session-coverage hits across 120 interactive_cli∪unknown sessions (3.33%) — capped from 250% (multiple customization commands per session)
```

## Why `/btw` isn't in the memory numerator

The original CCE-76 design summed `/btw + /clear + /compact + /rewind`
into one memory ratio. That shipped, then got redesigned under CCE-79
per the CLAUDE.md per-field semantic rule: before summing fields into a
ratio numerator, classify each on two axes — **time window** (30-day
windowed vs. cumulative all-time) and **counter class**
(session-coverage vs. raw invocation count). `/btw`'s side-channel
counter (`cliBtwUseCount`) is cumulative all-time, not 30-day windowed;
mixing it into a windowed session-coverage sum silently corrupted the
ratio. `/rewind` is a near-zero, keyboard-shortcut-driven signal that
added noise without adding real coverage.

The shipped scorer restricts the numerator to the two genuinely
session-coverage, 30-day-windowed signals — `/clear` and `/compact` —
and surfaces `/btw`'s cumulative count as evidence text instead
(`s.signalsSummary?.cliBtwUseCountAllTime`), not as a ratio input.
`/rewind` stays available only as a binary next-action probe via the
rubric's `satisfiedWhen`. The rubric's `memory.target` was recalibrated
from 92 to 60 to match the narrower, more honest ceiling. See
CLAUDE.md's "Per-field semantic categorization" rule for the general
principle and `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
for the full redesign.

## The `interactive_or_unknown` universe

Both scorers needed a denominator that's a superset of their numerator's
universe — the repo's standing hard rule since PR #97 (a numerator must
be a subset of its denominator's universe, or the ratio can silently
exceed 100%). The seven posture-command counters in
`scanTranscriptInvocations` (`scripts/_usage-data.mjs`) are gated by
`allowPosture`, which is true for `interactive_cli` **or** `"unknown"`
sessions — `"unknown"` is CCE-71's conservative fallback for transcripts
`classifySessionKind` can't confidently classify. The pre-existing
`interactiveSessionsAnalyzed` denominator counted `interactive_cli`
only, so a naive reuse of it as the denominator would have let
`"unknown"`-session hits inflate the numerator past the denominator.

The fix, landed in `scripts/insights-signals.mjs`, is a new derived
field:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and a matching third option on `withGates`'s `universe` parameter
(alongside the existing `"interactive_only"` and `"all_sessions"`),
enforced at construction time and recorded on the wrapped scorer as
`__universe` so tests and the methodology page can audit the contract.

## Counter-class unification: `/focus` and `/rewind`

`focusCommandUses` and `rewindCommandUses` used to increment once per
*message* that mentioned the command; the other five posture counters
(`/btw`, `/voice`, `/clear`, `/compact`, `/color`) already incremented
once per *session*. Mixing the two counter classes into the same ratio
numerator would have double-weighted a session where a user typed
`/focus` three times. `scanTranscriptInvocations` now tracks
`sessionHasFocus` / `sessionHasRewind` boolean flags per session and
increments the counter once after each session drains, matching the
established pattern for the other five commands. `/rewind` is a
keyboard shortcut and rarely appears as typed text, so
`rewindCommandUses` stays near zero by design — it's not a scorer bug.

## What didn't change

- **No new probes, catalog entries, or `signalsSummary` keys.** The new
  `interactiveOrUnknownSessionsAnalyzed` field lives in the cooked-telemetry
  `insights` block, not `signalsSummary` — it's a derived denominator, not
  a standalone probe.
- **Platform Setup scoring for `memory` and `customization`
  (`SCORERS.memory`, `SCORERS.customization` in `scripts/score.mjs`) is
  untouched.** This PR is Execution-axis only; the config-side scorers
  still read `MEMORY.md` presence, CLAUDE.md presence, statusline/keybindings
  config, and so on.
- **`model-effort` remains the only partially-measured dimension** — the
  Opus-usage half is scored from transcripts (`opusDominantSessionCount`),
  but effort level (`/effort max`) stays settings-only; there's no
  transcript signal for effort level itself.

## Where to look

| Concern | File |
| --- | --- |
| Scorer bodies | `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `EXECUTION_SCORERS.customization`, `withGates`, `maxProbe` |
| Denominator | `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed` |
| Session classification | `scripts/_usage-data.mjs` — `classifySessionKind`, `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition |
| Tests | `scripts/__tests__/memory-customization-execution-scorers.test.mjs` |
| Radar rendering | `app/components/RadarChart.tsx` — italic + footnote only applies when `gapReason !== null`; both dims now render solid |

Because the radar's unmeasured-marking logic keys off `gapReason`, not a
hardcoded dimension list, no UI change was needed once the scorers
stopped returning `unavailable()` — the vertices flip from italic to
solid automatically the first time a run has `includeTranscripts: true`
and at least one `interactive_cli` or `unknown` session in the window.
