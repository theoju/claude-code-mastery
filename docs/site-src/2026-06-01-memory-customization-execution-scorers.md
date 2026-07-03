---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers (CCE-76)

Memory & Context Management and Terminal & Customization were the last two
of the twelve scoring dimensions still sitting on the `noTelemetry()` stub —
Platform Setup was scored, but Execution rendered as honestly-unmeasured
(italic label, `gapReason` set) even when the user had transcript scanning
turned on. PR #116 gives both a real ratio scorer in `scripts/score.mjs`, so
**all twelve dimensions now have Execution scorers**.

## The new `interactive_or_unknown` universe

`withGates()` (`scripts/score.mjs`) takes a mandatory `universe` option that
picks which session-count denominator gates the scorer:

- `interactive_only` — `s.insights.interactiveSessionsAnalyzed`
- `all_sessions` — `s.insights.sessionsAnalyzed`
- `interactive_or_unknown` — `s.insights.interactiveOrUnknownSessionsAnalyzed` (new)

The third option is new in this change. It's backed by a new field in
`gatherInsightsSignals` (`scripts/insights-signals.mjs`):

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`unknown` is `classifySessionKind`'s conservative fallback in
`scripts/_usage-data.mjs` — a session whose transcript didn't yield a
recognizable `entrypoint` in its first five lines. The posture-command
scanner (`scanTranscriptInvocations`) already treats `interactive_cli` and
`unknown` as the same gate (`allowPosture`) when counting `/clear`, `/compact`,
`/btw`, `/focus`, `/rewind`, etc. — sessions it can't positively classify as
SDK/observer/subagent get counted, rather than silently dropped. Memory and
Customization needed a denominator that matches that same union, or the
ratio's numerator wouldn't be a strict subset of its denominator's universe
(the rule CLAUDE.md pins down after the PR #97 planning-scorer overcount,
where `planModeSessionCount / multiTaskSessionCount` produced 105.88%).
`interactive_or_unknown` closes that gap for these two scorers specifically.

## Counter unification: `focusCommandUses` and `rewindCommandUses`

Before this change, `focusCommandUses` and `rewindCommandUses` in
`scanTranscriptInvocations` (`scripts/_usage-data.mjs`) incremented on every
matched line — a raw invocation count, like `goCommandUses` or
`batchCommandUses`. Every other posture command (`/clear`, `/compact`,
`/btw`, `/simplify`, `/voice`, `/color`, `/fewer-permission-prompts`) already
counted session-coverage instead: a per-session boolean flag
(`sessionHasClear`, `sessionHasBtw`, …) that increments the counter once per
session regardless of how many times the command appears in that session.
The mismatch mattered because a ratio numerator built from a mix of
invocation-count and session-coverage fields conflates two different
counter classes (the same axis CLAUDE.md's per-field categorization rule
calls out for `/btw` vs `/rewind` in the CCE-79 Memory redesign).

PR #116 unifies both to the session-coverage shape:

```js
let sessionHasFocus = false;
let sessionHasRewind = false;
// ...
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// ... at end of session:
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

Both are still gated by `allowPosture` (`interactive_cli ∪ unknown`) — they
were already members of `POSTURE_COMMANDS`, so `assertCommandPartition`'s
fail-loud module-load guard was already enforcing that classification; only
the counting shape (invocation vs. session) changed.

## The two scorers

Both live in `EXECUTION_SCORERS` in `scripts/score.mjs`, wrapped the same
way:

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const ratio = Math.min(sum / denom, 1);
    // ...
  },
),
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const color = maxProbe(s, "colorCommandUses");
    const voice = maxProbe(s, "voiceCommandUses");
    const focus = maxProbe(s, "focusCommandUses");
    const sum = color + voice + focus;
    const ratio = Math.min(sum / denom, 1);
    // ...
  },
),
```

`maxProbe` (also in `score.mjs`) takes the max of the transcript scanner and
the `history.jsonl` scanner for a given field — the same MAX-merge pattern
`buildSignalsSummary` uses for `batchCommandUses`, `btwCommandUses`, and the
rest, so a side-channel command typed outside a session JSONL still counts.

Both scorers cap the ratio at 100% (`Math.min(rawRatio, 1)`) and note the
uncapped raw percentage in the evidence string when a session fires more
than one memory/customization command — sessions frequently do (e.g.
`/clear` then `/compact` in the same conversation), so the raw sum can
exceed the session count without it being an error.

The Memory scorer deliberately keeps its numerator to `/clear` + `/compact`
only. `/btw` is cumulative-all-time (not session-windowed — see the CCE-78
fix in CLAUDE.md) and surfaces only as evidence text via
`s.signalsSummary.cliBtwUseCountAllTime`, never in the ratio. `/rewind` is
dropped from the ratio entirely (its real-world signal was near-zero in
survey data) and stays available only as a binary next-action probe via the
rubric's `satisfiedWhen`. This is the CCE-79 per-field redesign the Memory
scorer already went through, and the new scorer inherits it rather than
reopening the mixed-numerator bug.

## What this changes on the radar

Previously, Memory and Customization Execution vertices always rendered
italic (unmeasured) regardless of `--include-transcripts`. Now they resolve
to a real score whenever `interactiveOrUnknownSessionsAnalyzed > 0` and
`insights.transcriptsScanned` is true; the italic/unmeasured treatment on
`app/components/RadarChart.tsx` only applies when a scorer's `gapReason` is
non-null — for these two, that's now only the zero-sessions-in-window case
(`GAP_REASONS.NO_SESSIONS`) or transcripts not being scanned at all
(`GAP_REASONS.NO_TRANSCRIPTS`).

Model & Effort Tuning remains the one dimension that's only partially
measured — Opus usage is scored from transcripts, effort level stays
settings-only — but with this change it's no longer sharing that
"partially unmeasured" company with Memory or Customization.
