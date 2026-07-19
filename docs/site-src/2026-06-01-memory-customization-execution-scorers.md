---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Twelve rubric dimensions, twelve measured Execution scores. Before PR #116
(CCE-76), `memory` and `customization` were the last two dimensions still
routed through `noTelemetry()` — the radar rendered them italic and
unmeasured even though the transcript signals needed to score them already
existed. This page describes the scorer that closed the gap, the session
universe it introduced to do so safely, and the follow-up narrowing
(CCE-79) that changed the Memory scorer's numerator after it shipped.

## Why they were unmeasured

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json` — the
same data `/insights` reads) never contains a per-command invocation
breakdown, so a scorer that only reads cooked telemetry has nothing to
count `/clear`, `/compact`, `/color`, `/focus`, etc. against. But
`scanTranscriptInvocations` in `scripts/_usage-data.mjs` already extracts
those counts from `~/.claude/projects/*/*.jsonl`, gated to the
`interactive_cli ∪ "unknown"` partition established by CCE-71
(`allowPosture`). `learning` (the `★ Insight` banner scan) and `parallel`
(worktree usage) already mixed transcript signals into Execution scoring
the same way — this closes the last two holdouts using the existing
pattern rather than inventing a new one.

## The `interactive_or_unknown` universe

Every Execution ratio scorer in `scripts/score.mjs` is wrapped in
`withGates({ transcripts, universe }, fn)`, which picks the denominator
before the scorer body runs and records the choice on the wrapped function
as `__universe` so tests can audit it. Two universes existed before this
PR:

- `interactive_only` → `s.insights.interactiveSessionsAnalyzed`
- `all_sessions` → `s.insights.sessionsAnalyzed`

Neither fit. The posture-command counters that feed Memory and
Customization are gated to `interactive_cli ∪ "unknown"` (`"unknown"` is
CCE-71's conservative fallback for transcripts `classifySessionKind` can't
confidently classify), but `interactiveSessionsAnalyzed` is strict
`interactive_cli`. Wiring the new scorers to `interactive_only` would have
let a session classified `"unknown"` contribute to the numerator without
counting in the denominator — exactly the numerator-exceeds-denominator
shape the PR #97 hard rule (a ratio's numerator must be a strict subset of
its denominator's universe) exists to catch, and the same bug class as the
36/34 = 105.88% planning-scorer regression that rule was written to
prevent.

The fix, added at `scripts/insights-signals.mjs:107-109`, is a third
universe that matches the partition instead of narrowing it:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` (`scripts/score.mjs:597-626`) routes `universe:
"interactive_or_unknown"` to this new field. Both the Memory and
Customization scorers declare `{ transcripts: true, universe:
"interactive_or_unknown" }`.

## Memory Execution scorer

`EXECUTION_SCORERS.memory` (`scripts/score.mjs:977`) reads two
session-coverage counters — `clearCommandUses` and `compactCommandUses` —
via `maxProbe(s, field)`, which takes `Math.max` of the transcript-scanned
count and the history-scanned count for that field (history has higher
fidelity for side-channel commands; transcripts have higher fidelity for
transcript-only ones):

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const ratio = Math.min(sum / denom, 1);
const score = Math.round(ratio * 100);
```

where `denom = s.insights.interactiveOrUnknownSessionsAnalyzed`. The
normalized dimension score is `clamp(round(rawScore / target × 100))`
against the rubric's `memory.target = 60` (`app/data/rubric.json`).

This is narrower than what CCE-76 originally shipped. The first version
summed four fields — `/btw + /clear + /compact + /rewind` — but that
violated the per-field numerator rule this repo's CLAUDE.md now documents
explicitly: `/btw`'s count is a **cumulative all-time** counter (not
30-day windowed like the other three), and `/rewind` is a near-zero
keyboard-shortcut signal, so the sum mixed three different counter
semantics into one ratio. CCE-79 restricted the numerator to the two
genuinely session-coverage, 30-day-windowed signals (`/clear`, `/compact`)
and recalibrated `memory.target` from 92 down to 60 to match the narrowed
ceiling. The other two signals didn't disappear — they moved to more
honest surfaces:

- `/btw` shows up as cumulative evidence text only: `` `Plus ${btwAllTime}
  all-time /btw invocations (cumulative, not in ratio).` ``, sourced from
  `s.signalsSummary?.cliBtwUseCountAllTime`.
- `/rewind` stays a binary next-action probe —
  `rewind-reflex.satisfiedWhen: "rewindCommandUses>=1"` in
  `app/data/rubric.json` — rather than a ratio numerator term.

## Customization Execution scorer

`EXECUTION_SCORERS.customization` (`scripts/score.mjs:1010`) follows the
same shape, unmodified by CCE-79 since all three of its inputs are
already same-class session-coverage counters:

```js
const color = maxProbe(s, "colorCommandUses");
const voice = maxProbe(s, "voiceCommandUses");
const focus = maxProbe(s, "focusCommandUses");
const sum = color + voice + focus;
const ratio = Math.min(sum / denom, 1);
const score = Math.round(ratio * 100);
```

normalized against `customization.target = 80`.

## Counter-class unification (`focusCommandUses`, `rewindCommandUses`)

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented
once per **message** in `scanTranscriptInvocations`
(`scripts/_usage-data.mjs`), while the other five posture counters
(`btw`, `clear`, `compact`, `color`, `voice`) incremented once per
**session** that used the command at least once. Feeding a per-message
counter into a session-coverage ratio would have double-counted any
session where a command fired more than once. The two counters were
retrofitted to session-coverage: a `sessionHasFocus` / `sessionHasRewind`
flag is set per message and only converted to a `counts.*CommandUses++`
increment once, at the per-session emit point — mirroring the existing
pattern the other five counters already used. All seven posture counters
now share one counting class.

## Cap behavior is visible, not silent

Because each session can use more than one memory or customization
command, `sum` can exceed `denom` — a session that runs both `/clear` and
`/compact` contributes 1 to each counter, so it's possible for
`rawRatio > 1`. Both scorers clamp the displayed score to 100 with
`Math.min(ratio, 1)`, but the evidence string surfaces the raw percentage
whenever the cap fires:

```
Memory hygiene commands: 160 session-coverage hits across 100
interactive_cli∪unknown sessions (100%) — capped from 160%
(multiple memory commands per session).
```

The score is still capped — a reader shouldn't see a ratio above 100 on
the radar — but the "capped from N%" suffix means over-use isn't hidden
behind a misleadingly clean 100. A cleaner fix (a single
`sessionsWithAnyMemoryCommand` union counter that can't exceed 1 per
session) is deferred to a future PR; the cap-with-visible-evidence
approach was the smaller, safer diff for this change.

## Effect on the radar

`GAP_REASONS !== null` is what drives the radar's italic-unmeasured
treatment (`app/components/RadarChart.tsx`). Both scorers now return
`gapReason: null` on every path except the three gate failures inherited
from `withGates` (no insights, transcripts not scanned, zero sessions in
the `interactive_or_unknown` universe) — so a normal run with
`--include-transcripts` renders solid vertices for both dimensions
instead of italic ones. With this PR, **Model & Effort Tuning is the only
dimension left with a `noTelemetry()`-style partial measurement** — its
Opus-usage half is scored from transcripts, but effort level (`xhigh` /
`max`) remains settings-only and has no execution-side signal to score
against.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations  (allowPosture: interactive_cli ∪ "unknown")
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │  MAX-merged against signals.historyInvocations.* via maxProbe()
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   │
   ▼
normalize(rawScore, dimension.target) → radar vertex
   (target = 60 for memory, target = 80 for customization)
```

## Related reading

- `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md` —
  the original CCE-76 design doc (numerator shape predates the CCE-79
  narrowing described above; read this page for what's actually running).
- CLAUDE.md's "Per-field semantic categorization before adding to any
  numerator" hard rule — the two-axis (time window × counter class) test
  that governs what belongs in a ratio numerator, with CCE-79 as the
  reference case.
- CLAUDE.md's "Verify denominator semantics for every ratio scorer" hard
  rule — the numerator-subset-of-denominator corollary that motivated the
  `interactive_or_unknown` universe.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` —
  scorer-level tests for both dimensions, including the gate-failure,
  cap-fires, and MAX-merge cases described above.
