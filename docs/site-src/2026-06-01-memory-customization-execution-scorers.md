---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory and Customization get real Execution scorers (CCE-76 / PR #116)

Before this PR, two of the twelve rubric dimensions — **Memory & Context
Management** and **Terminal & Customization** — always rendered as
italic-unmeasured vertices on the Execution radar, no matter how much
posture-command signal a user actually had in their transcripts. `scripts/score.mjs`
routed both to a placeholder that returned `gapReason` unconditionally. PR #116
replaces both placeholders with real ratio scorers in `EXECUTION_SCORERS`, and
in doing so closes out the last gap: **all twelve dimensions now have an
Execution scorer** (`scripts/score.mjs`, `EXECUTION_SCORERS.memory` /
`EXECUTION_SCORERS.customization`).

## What actually changed

Three pieces landed together:

1. **A new session universe.** `withGates()` in `scripts/score.mjs` gained a
   third `universe` option, `"interactive_or_unknown"`, alongside the existing
   `"interactive_only"` and `"all_sessions"`. It's backed by a new
   `interactiveOrUnknownSessionsAnalyzed` field computed in
   `scripts/insights-signals.mjs` as `sessionsByKind.interactive_cli +
sessionsByKind.unknown`.
2. **Counter-class unification.** `focusCommandUses` and `rewindCommandUses` in
   `scripts/_usage-data.mjs::scanTranscriptInvocations` moved from raw
   per-message invocation counts to session-coverage counts (`sessionHasFocus`
   / `sessionHasRewind` flags, incremented once per session), matching the
   pattern already used for `/btw`, `/clear`, `/compact`, `/simplify`,
   `/color`, `/voice`, and `/fewer-permission-prompts`.
3. **Two new ratio scorers**, both gated `{ transcripts: true, universe:
"interactive_or_unknown" }`.

### Why a new universe, not the existing ones

The seven posture-command counters (`POSTURE_COMMANDS` in `_usage-data.mjs`)
are only incremented when `allowPosture` is true — i.e. when
`classifySessionKind` returns `"interactive_cli"` **or** `"unknown"` (the
conservative fallback for transcripts the classifier can't confidently place).
The existing `"interactive_only"` universe's denominator
(`interactiveSessionsAnalyzed`) is strictly `sessionsByKind.interactive_cli` —
narrower than the numerator's source set. Gating a posture-command ratio
scorer on that universe would let `"unknown"`-classified sessions inflate the
numerator without ever entering the denominator, which is exactly the
numerator-superset-of-denominator failure mode the project's CLAUDE.md
calls out from the PR #97 planning-ratio bug (105.88% plan-mode coverage).
Rather than tighten `allowPosture` and risk under-counting legitimately
unclassifiable sessions, `interactive_or_unknown` widens the denominator to
match — the smaller, more principled diff.

## What each scorer measures now

**Memory & Context Management** (`EXECUTION_SCORERS.memory` in
`scripts/score.mjs`):

```
sum   = maxProbe(s, "clearCommandUses") + maxProbe(s, "compactCommandUses")
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
score = round(ratio * 100)
```

`maxProbe()` reads a field from both `signals.transcriptInvocations` and
`signals.historyInvocations` and takes the max — history has better fidelity
for commands that don't always leave a `<command-name>` marker in the
transcript, so either source recovering the signal should count.

Note this is **not** the shape shipped in the original design spec
(`docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`),
which summed `/btw + /clear + /compact + /rewind`. A follow-up redesign
(CCE-79, per the project's CLAUDE.md) narrowed the numerator to just `/clear`
and `/compact` — the two genuinely session-coverage, windowed signals — after
recognizing that `/btw` is a cumulative all-time counter and `/rewind` is a
near-zero keyboard-shortcut signal, neither of which belongs in the same sum
as the other two. `/btw`'s all-time count (`s.signalsSummary.cliBtwUseCountAllTime`)
now surfaces as evidence text instead:

> "Memory hygiene commands: 23 session-coverage hits across 120
> interactive_cli∪unknown sessions (19.17%). Plus 39 all-time /btw
> invocations (cumulative, not in ratio)."

`/rewind` still gates a rubric `satisfiedWhen` next-action, just not the ratio
itself. The rubric target for `memory` was recalibrated from 92 to 60 as part
of the same redesign to match the narrower, more realistic ceiling of a
two-command ratio.

**Terminal & Customization** (`EXECUTION_SCORERS.customization`):

```
sum   = maxProbe(s, "colorCommandUses") + maxProbe(s, "voiceCommandUses") + maxProbe(s, "focusCommandUses")
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
score = round(ratio * 100)
```

This one shipped as designed — `/color`, `/voice`, `/focus` are all genuine
session-coverage signals at the same time-window class, so no CCE-79-style
split was needed.

Both scorers cap the displayed score at 100 via `Math.min(rawRatio, 1)` when a
session fires more than one covered command (double-counting one session
across two numerator terms), but neither hides that fact: the evidence string
appends `" — capped from N% (multiple … commands per session)"` whenever
`rawRatio > 1`, per `scripts/__tests__/memory-customization-execution-scorers.test.mjs`.
Zero-signal sessions still return a real `score: 0` (not `unmeasured`) with a
gap string naming the missing commands — the difference between "you don't do
this" and "we didn't look" is exactly what `gapReason` exists to preserve.

## Effect on the radar

Both dimensions flip from italic-unmeasured to solid vertices the moment
`transcriptsScanned` is true and at least one interactive-or-unknown session
exists — no UI change was needed in `app/components/RadarChart.tsx`, since the
italic treatment is already keyed off `gapReason !== null`. `app/methodology/page.tsx`'s
Execution-scorer section documents both formulas alongside the other ten.

## Where the gates route to `unmeasured` instead

Same three-gate contract every other `withGates` scorer uses:

- `s.insights` missing → `GAP_REASONS.NO_INSIGHTS`
- `transcriptsScanned` false (user didn't pass `--include-transcripts`) →
  `GAP_REASONS.NO_TRANSCRIPTS`
- `interactiveOrUnknownSessionsAnalyzed === 0` → `GAP_REASONS.NO_SESSIONS`

Both dimensions still require the opt-in transcript scan (`scoring.includeTranscripts:
true` or `--include-transcripts`) — cooked telemetry alone
(`~/.claude/usage-data/{facets,session-meta}`) has no per-command breakdown,
which is exactly why these two dimensions sat unmeasured for as long as they
did.
