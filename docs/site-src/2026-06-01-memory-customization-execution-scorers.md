---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Decision: Memory & Customization Execution Scorers (CCE-76)

**PR #116 · 2026-06-01**

Two scoring dimensions — **Memory & Context Management** and **Terminal &
Customization** — had returned only a stub `noTelemetry()` result for their
Execution score since the two-axis model shipped. CCE-76 replaces both stubs
with real ratio scorers, completing the full twelve-dimension Execution coverage
for the first time.

## Context

The Execution axis reads cooked telemetry from `~/.claude/usage-data/` for most
dimensions: session counts, tool invocations, multi-task ratios, and so on.
Memory and Customization are different — the cooked telemetry doesn't record
per-command breakdowns for contextual posture commands like `/btw`, `/clear`,
`/compact`, `/color`, `/voice`, or `/focus`. Without a measurable signal,
both dims routed to `noTelemetry()`, which tells the scoring engine to emit a
`gapReason` rather than a number. On the radar those two vertices rendered in
italic at reduced opacity with a ¹ footnote.

The `learning` and `parallel` scorers had already established a precedent for
mixing transcript signals into Execution scoring via
`withGates({ transcripts: true })`. Transcripts (`~/.claude/projects/*/*.jsonl`)
do record command invocations. The CCE-71 partition gate had already classified
which commands count as posture signals and restricted their counting to
`interactive_cli` and `unknown` sessions. The missing piece was a denominator
that matched that same session universe.

## Decision

CCE-76 introduces `interactive_or_unknown` as a named universe option in
`withGates()`, counting `interactive_cli ∪ unknown` sessions. The
`interactiveOrUnknownSessionsAnalyzed` signal in `insights-signals.mjs` serves
as the shared denominator for both new scorers.

The two scorers are:

| Dimension | Commands counted (numerator) | Denominator universe |
|---|---|---|
| Memory & Context Management | `/btw`, `/clear`, `/compact` per-session coverage | `interactive_or_unknown` |
| Terminal & Customization | `/color`, `/voice`, `/focus` per-session coverage | `interactive_or_unknown` |

Both use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.

As part of the same change, `focusCommandUses` and `rewindCommandUses` were
unified from per-message invocation counting to per-session coverage counting,
matching the canonical pattern already used for `/btw`, `/clear`, and
`/compact`. Per-session coverage is the right unit for posture signals: a
session where you ran `/compact` three times counts the same as one where you
ran it once.

## Why `interactive_or_unknown` and not `interactive_only`

The hard denominator-semantics rule from PR #97 requires that a ratio's
numerator be a strict subset of its denominator's session universe. Posture
commands are only counted when `classifySessionKind` returns `interactive_cli`
or `"unknown"` (the conservative fallback for sessions the classifier can't
definitively categorize). Using the narrower `interactive_cli`-only universe as
the denominator would let the numerator spill outside it — sessions classified
as `unknown` contribute command counts but would be excluded from the
denominator, producing ratios above 100%.

`interactive_or_unknown` closes this: the denominator's universe exactly matches
the set of sessions from which the numerator can draw.

## Consequences

- **All twelve dimensions now return numeric Execution scores.** The italic
  radar vertices and ¹ footnote for Memory and Customization are gone in the
  steady state; they only reappear when `gapReason !== null` (e.g. zero
  interactive sessions in the lookback window, or `--no-transcripts` passed).
- **The Execution overall score dropped from 77 to 66 after the merge.** This
  is correct behavior: two previously-excluded dimensions now contribute at low
  raw scores, pulling the average down. It's not a regression — it's the
  dashboard surfacing real deficits that were previously hidden.
- **Low `/btw`, `/clear`, `/compact`, `/color`, `/voice`, `/focus` adoption now
  shows up as actionable next-actions** rather than being silently ignored
  because the scorer didn't exist.
- The test suite grew from 647 to 666 passing tests, with 16 new tests
  dedicated to the two new scorers and the `interactive_or_unknown` gate.

## Related

- CCE-71: posture-command partition gate (`POSTURE_COMMANDS` / `VOLUME_COMMANDS`
  in `scripts/_usage-data.mjs`) — the upstream gate CCE-76 builds on.
- PR #97: the denominator-semantics hard rule that motivated the new universe.
- CCE-79: follow-up Memory Execution scorer redesign (per-field semantic
  categorization, narrowed numerator to `/clear + /compact` only, separate
  cumulative evidence surface for `/btw`).
