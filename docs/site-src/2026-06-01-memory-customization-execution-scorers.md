---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers (CCE-76)

Through v0.9.x, ten of the twelve scored dimensions had an Execution
scorer and two — Memory & Context Management and Terminal &
Customization — routed straight to `noTelemetry()`. That wasn't a data
gap so much as a scope gap: cooked telemetry
(`~/.claude/usage-data/{facets,session-meta}/*.json`) genuinely has no
command-invocation breakdown, but transcripts (`~/.claude/projects/*/*.jsonl`)
do, and two other dimensions (`learning` via the `★ Insight` banner scan,
`parallel` via worktree-usage scanning) were already mixing transcript
signals into Execution scoring. CCE-76 (PR #116) applies the same pattern
to the last two dimensions. All twelve dimensions now have a real
Execution measurement; the radar's italic-unmeasured label is reserved
for cases where a scorer's `gapReason` is genuinely non-null (e.g. zero
sessions in the lookback window), not for scorers that were simply never
written.

## Where the signal comes from

Both scorers read from the same posture-command counters that
`scanTranscriptInvocations` (`scripts/_usage-data.mjs`) already builds for
Platform Setup next-actions and the probe catalog — `/btw`, `/clear`,
`/compact`, `/rewind`, `/color`, `/voice`, `/focus`. Each counter is
**session-coverage**, not raw invocation count: a per-session flag
(`sessionHasClear`, `sessionHasFocus`, …) flips on first sighting inside a
session and the corresponding `counts.*CommandUses` increments once after
that session drains, so a session that runs `/clear` five times still
contributes 1.

That uniformity is itself new. Before this PR, `focusCommandUses` and
`rewindCommandUses` incremented per-message while the other five posture
counters already incremented per-session — an artifact of when each
counter was added. CCE-76 retrofit the two stragglers to match: hoisted
`sessionHasFocus` / `sessionHasRewind` flags into the per-session reset
block alongside `sessionHasBtw` et al., and moved the increment to the
same emit block. `scripts/__tests__/scan-transcript-invocations.test.mjs`
now asserts a session with two `/rewind` invocations counts as `1`, not
`2`.

All seven counters are gated by `allowPosture` — true only when
`classifySessionKind` returns `interactive_cli` or the conservative
`"unknown"` fallback (`scripts/_usage-data.mjs`). Observer and
SDK-orchestrated sessions echo the primary session's `<command-name>`
markup and would otherwise inflate the counters; `"unknown"` stays in
rather than being excluded, because tightening it to `interactive_cli`
alone would under-count legacy or truncated transcripts that can't be
classified.

## The `interactive_or_unknown` universe

The existing posture-ratio scorers (permissions, planning, learning) all
divide by `interactiveSessionsAnalyzed` — strict `interactive_cli` — per
the numerator-subset-of-denominator rule from PR #97: a ratio's numerator
must never draw from outside its denominator's universe, or the ratio can
exceed 100% and the `Math.min(ratio, 1)` cap silently hides the
violation. Because the memory/customization numerators are gated to
`interactive_cli ∪ "unknown"`, dividing by strict `interactive_cli` would
violate that rule the moment any `"unknown"` session contributed a hit.

`scripts/insights-signals.mjs` adds a matching denominator:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` (`scripts/score.mjs`) gained a third `universe` option
alongside `"interactive_only"` and `"all_sessions"`:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

Both new scorers declare `{ transcripts: true, universe:
"interactive_or_unknown" }`, so `withGates` returns `unavailable` with
`GAP_REASONS.NO_TRANSCRIPTS` when transcript scanning is off, and
`GAP_REASONS.NO_SESSIONS` when the window has zero interactive-or-unknown
sessions — the two scorers never silently score against the wrong
denominator.

## Memory Execution scorer

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
    ...
  },
),
```

The shipped numerator is narrower than the original CCE-76 design draft.
The design spec's first pass summed all four counters — `/btw`, `/clear`,
`/compact`, `/rewind` — but a follow-up per-field semantics pass (CCE-79,
the same review that split the Memory Platform Setup scorer's `/btw`
handling) caught that the four don't share a counter class:

- `/btw` is exposed elsewhere as `cliBtwUseCountAllTime`, a **cumulative,
  all-time** invocation count from `~/.claude.json`, not a 30-day
  session-coverage counter. Blending it into a windowed ratio's numerator
  would overstate coverage and drift upward with account age rather than
  recent posture — the same class of bug the CLAUDE.md hard rule on
  cumulative-vs-windowed fields exists to prevent.
- `/rewind` is a near-zero-frequency keyboard-shortcut reflex, not a
  typed command most sessions will ever fire — folding it into a ratio
  numerator mostly just adds noise.

So the ratio numerator is `clear + compact` only. `/btw`'s cumulative
count still shows up, but as **evidence text**, not as ratio input:

```
Memory hygiene commands: 23 session-coverage hits across 120
interactive_cli∪unknown sessions (19.17%). Plus 39 all-time /btw
invocations (cumulative, not in ratio).
```

`/rewind` is dropped from the ratio entirely and lives on only as a
binary next-action probe (`rewindCommandUses>=1`, Boris tip 62) in
`app/data/rubric.json`. The rubric's `memory.target` was recalibrated
from 92 to 60 to match the narrower two-counter ceiling — `normalize(raw,
target) = clamp(round(raw / target × 100))`, so a narrower numerator
needs a lower target to keep 100/100 reachable by realistic usage.

## Customization Execution scorer

Same shape, three counters, no counter-class conflicts (all three are
session-coverage, all-window):

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
    ...
  },
),
```

`customization.target` stays at 80 in `app/data/rubric.json` — the
existing three-counter composition didn't need recalibration.

## Reading the cap

Both scorers cap the displayed ratio at 100 via `Math.min(rawRatio, 1)`
because a single session can trip more than one counter (`/clear` and
`/compact` in the same session both count toward the numerator, for
example). Rather than silently flattening an over-100% raw ratio to a
clean 100, the evidence string surfaces it:

```
Customization commands: 30 session-coverage hits across 10
interactive_cli∪unknown sessions (300.00%) — capped from 300.00%
(multiple customization commands per session)
```

so a reader isn't misled into thinking every session used exactly one
command. `maxProbe` (`scripts/score.mjs`) supplies each counter by taking
the max of the transcript-scanned value and the `history.jsonl`-scanned
value — the same MAX-merge pattern used across the other posture-command
scorers, since history has better fidelity for side-channel commands
(`/btw`) and transcripts have better fidelity for transcript-only ones
(`/rewind`, which `HISTORY_COMMAND_LIST` excludes as a keyboard shortcut
that's never typed).

## Net effect

- **Twelve of twelve dimensions** now have an Execution scorer. Model &
  Effort Tuning remains the only *partially*-measured dimension — Opus
  usage is scored from transcripts, effort level stays settings-only.
- The radar's italic-unmeasured label now only fires on a genuine
  `gapReason !== null` (no transcripts scanned, or zero sessions in the
  lookback window) — not because a dimension was never wired up.
- No new probe-catalog entries, `signalsSummary` keys, or
  `satisfiedWhen` predicates were added; `interactiveOrUnknownSessionsAnalyzed`
  lives in the cooked-telemetry `insights` block, not `signalsSummary`.
  The probe-tracker spec
  (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
  records the axis change for the affected Boris tips (Platform-only →
  Platform+Execution) without moving their tracking status.

## Where to look

| Concern | File |
| --- | --- |
| Session-coverage counter scan, `allowPosture` partition | `scripts/_usage-data.mjs` |
| `interactiveOrUnknownSessionsAnalyzed` | `scripts/insights-signals.mjs` |
| `withGates` universe option, `EXECUTION_SCORERS.memory` / `.customization`, `maxProbe` | `scripts/score.mjs` |
| Rubric targets and next-actions (`memory.target = 60`, `customization.target = 80`) | `app/data/rubric.json` |
| Scorer unit tests (gate branches, cap behavior, MAX-merge, mixed-input cases) | `scripts/__tests__/memory-customization-execution-scorers.test.mjs` |
| Session-coverage counting-class regression | `scripts/__tests__/scan-transcript-invocations.test.mjs` |
