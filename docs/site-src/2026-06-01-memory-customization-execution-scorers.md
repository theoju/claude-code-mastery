---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization now have real Execution scorers (CCE-76)

As of PR #116, all twelve dashboard dimensions report a measured Execution
score. The last two holdouts — **Memory & Context Management** and
**Terminal & Customization** — used to route straight to `unavailable()`
because cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`)
has no command-invocation breakdown. That reasoning was correct about cooked
telemetry, but it conflated "no cooked-telemetry signal" with "no Execution
signal at all." `learning` (the `★ Insight` banner scan) and `parallel`
(worktree-usage scan) already mixed transcript-derived signals into Execution
scoring via `withGates({ transcripts: true, ... })`. This change extends the
same pattern to the two remaining dims.

## What changed

`scripts/score.mjs`'s `EXECUTION_SCORERS.memory` and `.customization` are now
real ratio scorers instead of stubs. Both are wrapped in
`withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`:

- **Memory** sums session-coverage hits on `/clear` and `/compact` (via
  `maxProbe`, which reads the max of the transcript scan and the shell-history
  scan) and divides by `s.insights.interactiveOrUnknownSessionsAnalyzed`. The
  ratio is capped at 1 before being turned into a 0-100 raw score. `/btw`
  (cumulative, all-time) is surfaced as evidence text — "Plus N all-time /btw
  invocations (cumulative, not in ratio)" — rather than folded into the sum,
  and `/rewind` isn't in the ratio either; it's kept only as a binary
  next-action probe. (See the CCE-79 note in `CLAUDE.md` for why: the original
  cut of this scorer summed `/btw + /clear + /compact + /rewind` in one
  numerator even though the four have different time-window and counter-class
  semantics — a violation of the repo's per-field categorization rule. The
  numerator was narrowed to the two genuine session-coverage signals.)
- **Customization** sums session-coverage hits on `/color`, `/voice`, and
  `/focus` over the same denominator.

Both evidence strings report the raw hit count, the denominator, the
percentage, and — when the raw ratio exceeds 1 (a session fired more than one
of the counted commands) — a "capped from N%" suffix, so the multi-counting
case is visible on the radar instead of silently flattening to a clean 100.

## The new `interactive_or_unknown` universe

The seven posture-gated slash commands (`/color`, `/voice`, `/focus`, `/btw`,
`/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` —
see `POSTURE_COMMANDS` in `scripts/_usage-data.mjs`) are only counted from
transcripts when `classifySessionKind` returns `"interactive_cli"` or the
conservative `"unknown"` fallback (`allowPosture` in
`scanTranscriptInvocations`). That partition predates this change — it's the
CCE-71 fix that stops observer/SDK-orchestrated sessions from inflating
posture counters via echoed `<command-name>` markup.

The problem: `interactiveSessionsAnalyzed` (the existing denominator most
posture scorers use) is strict `interactive_cli` — it doesn't include
`"unknown"`. Gating the Memory/Customization scorers on that denominator
while their numerator counts `interactive_cli ∪ unknown` sessions would have
opened exactly the numerator-superset-of-denominator hole the repo's hard
rule (established by the PR #97 planning-ratio bug) exists to prevent: any
session classified `"unknown"` would count toward the numerator but not the
denominator, and the ratio could exceed 100% while looking clean under the
cap.

`insights-signals.mjs` now computes and returns a matching denominator:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` in `scripts/score.mjs` gained a third `universe` option,
`"interactive_or_unknown"`, alongside the existing `"interactive_only"` and
`"all_sessions"`. It's recorded on the wrapped scorer as `__universe` so tests
and the methodology page can audit which universe a given dimension uses —
`EXECUTION_SCORERS.memory.__universe` and `.customization.__universe` are
both `"interactive_or_unknown"`.

## `/focus` and `/rewind` moved to session-coverage counting

Before this change, `focusCommandUses` and `rewindCommandUses` incremented
per *message* in `scanTranscriptInvocations` — an artifact of when they were
added, ahead of the session-coverage pattern the other five posture counters
(`/simplify`, `/btw`, `/voice`, `/clear`, `/compact`, `/color`,
`/fewer-permission-prompts`) already used. `_usage-data.mjs` now tracks
`sessionHasFocus` / `sessionHasRewind` flags per session and increments the
counter once per session, matching the emit block used for every other
posture command. All seven posture counters are now uniform units — one
session-coverage hit each — which is what makes summing them into a single
ratio numerator valid in the first place.

## Effect on the dashboard

Both dims flip from an italic, footnoted "unmeasured" radar vertex to a solid
numeric one — no `RadarChart.tsx` changes were needed; the component already
renders italic-and-faded only when `gapReason !== null`, and both scorers now
return `gapReason: null` whenever transcripts were scanned and at least one
interactive-or-unknown session exists. In the author's environment the two
new vertices landed at **16 (Memory)** and **3 (Customization)** — both low,
because session-coverage of hygiene and customization commands is genuinely
rare relative to total interactive session volume. That's the honest number,
not a bug: the whole point of shipping these scorers was to stop hiding a
real (low) signal behind "unmeasured."

Bringing two previously-excluded, low-scoring dimensions into the
weight-normalized Execution average pulls the overall Execution composite
down too — in the same run, `executionOverall` dropped from 77 to 66. That's
expected: `executionOverall` in `scripts/score.mjs` is a weight-normalized
mean over every dimension that produced a non-null `executionScore`, so
adding two real-but-low scores where there used to be `null` (excluded from
the average entirely) necessarily pulls the mean toward those scores. Nothing
about this is a regression in usage — it's the composite becoming more
complete.

## Where to look

- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`
  computation, alongside `interactiveSessionsAnalyzed` and `sessionsByKind`.
- `scripts/_usage-data.mjs` — `scanTranscriptInvocations`, `allowPosture`,
  `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition, and the session-coverage
  flag/emit pattern all seven posture counters now share.
- `scripts/score.mjs` — `withGates` (universe option + validation), and the
  `EXECUTION_SCORERS.memory` / `.customization` bodies.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer-level test suite (gating, ratio math, cap behavior, universe
  contract).
- `CLAUDE.md` — the scoring-model paragraph and the CCE-79 hard-rule note on
  per-field numerator semantics, which explains why `/btw` and `/rewind`
  aren't in the Memory ratio despite originally being planned for it.

Ticket: [CCE-76](https://designitright.atlassian.net/browse/CCE-76).
