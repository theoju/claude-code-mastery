---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization get real Execution scorers

Every dimension on the dashboard scores two independent axes: Platform
Setup ("is the tool configured?") and Execution ("do you actually use
it?"). Until PR #116, two of the twelve dimensions — Memory & Context
Management and Terminal & Customization — never had an Execution half.
`EXECUTION_SCORERS.memory` and `.customization` in `scripts/score.mjs`
were both wired to `noTelemetry()`, so the radar rendered them italic
and unmeasured no matter how much you actually used `/clear`, `/compact`,
`/color`, or `/focus`. As of PR #116, **all twelve dimensions have
Execution scorers.**

## Why they were stuck on `noTelemetry()`

The cooked telemetry the other Execution scorers read —
`~/.claude/usage-data/{facets,session-meta}/*.json` — never contained a
command-invocation breakdown, so there was nothing there to score memory
or customization posture against. But that's a property of cooked
telemetry, not of Execution scoring in general: `learning` already
scores from a transcript scan for the `★ Insight` banner, and `parallel`
already scores from a transcript scan for worktree usage. Memory and
Customization needed the same move — pull the signal from
`scanTranscriptInvocations` in `scripts/_usage-data.mjs`, which already
counts `/clear`, `/compact`, `/color`, `/voice`, `/focus`, `/btw`, and
`/rewind` per session, gated by `allowPosture` to sessions classified
`interactive_cli` or `"unknown"` (the CCE-71 partition that keeps
observer/SDK-echoed commands out of posture counters).

## The universe problem

Wiring a ratio scorer straight to those counters would have violated a
standing rule: a ratio's numerator must be a strict subset of its
denominator's universe, or the ratio can silently exceed 100%. The
existing `interactive_only` universe in `withGates` resolves to
`s.insights.interactiveSessionsAnalyzed` — strictly `interactive_cli`
sessions. But the posture-command counters are gated to
`interactive_cli ∪ "unknown"`, so any session classified `"unknown"`
would land in the numerator without a matching slot in the denominator.

PR #116 closes the gap with a new universe rather than tightening the
counter gate: `insights-signals.mjs` now computes and returns

```
interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown
```

and `withGates` accepts a matching `universe: "interactive_or_unknown"`
option, routing the session-count gate to that new denominator. Keeping
`"unknown"` in the fold (rather than narrowing `allowPosture` to
`interactive_cli` only) preserves the conservative fallback CCE-71 built
in for transcripts `classifySessionKind` can't confidently place —
narrowing it back out would have silently under-counted for anyone with
non-standard transcript shapes.

## The scorers

Both scorers now live in `scripts/score.mjs` as
`withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`
bodies. Both read their inputs through `maxProbe`, which takes the max
of the transcript-scanner count and the `~/.claude/history.jsonl`-derived
count for the same field — recovering whichever source actually saw the
command, since `/btw` in particular reaches history more reliably than
the transcript scan.

`customization` sums session-coverage hits for `/color`, `/voice`, and
`/focus` over `interactiveOrUnknownSessionsAnalyzed`, caps the ratio at
1, and reports the score as a percentage of session coverage. `memory`
does the same for a narrower pair — `/clear` and `/compact` — not the
full four-command set the original design sketched. That narrowing is a
follow-on fix (CCE-79, tracked in this repo's CLAUDE.md hard rules):
`/btw`'s counter is cumulative all-time, not a 30-day session-coverage
figure, and `/rewind` is a near-zero keyboard-shortcut signal — mixing
either into the same ratio numerator as `/clear`/`/compact` would have
blended three different counter semantics into one sum. `/btw` now
surfaces as cumulative evidence text on the memory card
(`cliBtwUseCountAllTime`) instead of feeding the ratio, and `/rewind`
stays a binary next-action probe (`rewindCommandUses>=1`) rather than a
ratio input.

Both scorers surface the raw percentage in their evidence string, and
when the summed session-coverage hits exceed the denominator — a session
that fired both `/clear` and `/compact` contributes to both counters —
the evidence explicitly says so rather than quietly capping to a clean
100:

```
Memory hygiene commands: 23 session-coverage hits across 120 interactive_cli∪unknown sessions (19.17%)
```

or, when capped:

```
Customization commands: 34 session-coverage hits across 120 interactive_cli∪unknown sessions (100%) — capped from 141.67% (multiple customization commands per session)
```

## Rubric targets

`app/data/rubric.json` keeps `customization.target = 80` unchanged.
`memory.target` is `60`, down from the original design's assumed `92` —
the CCE-79 follow-up recalibrated it to match the narrowed two-command
numerator so realistic usage can actually reach the top of the scale,
rather than leaving `/clear` + `/compact` alone permanently capped well
under 100 against a target calibrated for a four-command sum.

## Side effect: session-coverage counting for `/focus` and `/rewind`

The same PR unified `focusCommandUses` and `rewindCommandUses` from raw
total-invocation counts to session-coverage counts (one increment per
session that used the command at least once), matching how
`/btw`, `/clear`, `/compact`, `/color`, and `/voice` were already
counted in `scanTranscriptInvocations`. Before this change, a session
that hit `/rewind` twice contributed 2 to the counter; after, it
contributes 1 — consistent with every other posture command and with
what the new ratio scorers expect from their inputs.

## What this doesn't change

The Model & Effort Tuning dimension is still the only partially-measured
one on the radar — its Opus-usage half is scored from transcripts, but
effort level stays settings-only, so it keeps its `gapReason` treatment
for the unmeasured half. Every other dimension's italic-unmeasured
labeling now depends solely on whether `gapReason` comes back non-null
for that specific run (for example, a fresh install with zero interactive
sessions in the lookback window), not on whether a scorer exists at all.
