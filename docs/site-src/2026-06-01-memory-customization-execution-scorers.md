---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Context and Terminal & Customization get real Execution scorers

PR #116 (CCE-76) replaces the last two `noTelemetry()` placeholders in
`scripts/score.mjs`. Before this change, the **Memory & Context Management**
and **Terminal & Customization** dimensions had a Platform Setup score but no
Execution score at all — the radar rendered them italic and unmeasured
regardless of how much you actually used `/clear`, `/compact`, `/color`,
`/voice`, or `/focus`. As of this PR, **all twelve scored dimensions have a
real Execution scorer.** Model & Effort Tuning remains the only *partially*
measured dimension (Opus-usage is scored from transcripts; effort level stays
settings-only) — that's a separate, pre-existing gap, not something this PR
touches.

## What changed, concretely

Both new scorers live in `EXECUTION_SCORERS` in `scripts/score.mjs`, wrapped
in `withGates({ transcripts: true, universe: "interactive_or_unknown" })`:

- **Memory** sums two session-coverage counters — `clearCommandUses` and
  `compactCommandUses`, each read via `maxProbe()` (the MAX-merge of the
  transcript scan and the shell-history scan) — and divides by
  `interactiveOrUnknownSessionsAnalyzed`. `/btw` is **not** in the ratio: it's
  a cumulative all-time counter (`cliBtwUseCountAllTime`), and mixing a
  lifetime count into a 30-day windowed ratio's numerator is exactly the
  drift the CCE-78/CCE-79 fixes closed off. It still surfaces as evidence
  text — "Plus N all-time /btw invocations (cumulative, not in ratio)" — so
  the signal isn't lost, just kept out of the math. `/rewind` isn't in the
  ratio either (near-zero real-world signal); it stays a binary next-action
  probe via the rubric's `satisfiedWhen`.
- **Customization** sums three session-coverage counters —
  `colorCommandUses`, `voiceCommandUses`, `focusCommandUses` — over the same
  denominator.
- Both scorers cap the ratio at 1.0 but say so: if the raw ratio exceeds
  100% (a session firing more than one command in the set), the evidence
  string reads e.g. `capped from 160% (multiple memory commands per
  session)` rather than silently showing a clean 100.
- Both return `gapReason: null` on success, so `RadarChart.tsx`'s italic +
  reduced-opacity treatment (previously permanent for these two dims)
  disappears the first time a user has any interactive-or-unknown sessions
  in the lookback window.

## The new `interactive_or_unknown` universe

The seven posture-command counters (`/btw`, `/clear`, `/compact`, `/rewind`,
`/color`, `/voice`, `/focus`) are gated by `allowPosture` in
`_usage-data.mjs` to sessions classified as `interactive_cli` **or**
`"unknown"` — `"unknown"` is CCE-71's conservative fallback for transcripts
`classifySessionKind` can't confidently place. The existing
`interactiveSessionsAnalyzed` denominator, by contrast, is strict
`interactive_cli` only. Gating a ratio scorer on `interactive_only` while its
numerator counters include `"unknown"` sessions would violate the CLAUDE.md
hard rule that a ratio's numerator must be a subset of its denominator's
universe — exactly the class of bug the v0.9.17 planning-scorer fix (PR #97)
was written to prevent.

The fix is a new denominator, not a tightened counter partition (tightening
would throw away CCE-71's deliberate `"unknown"` fallback):

```js
// scripts/insights-signals.mjs
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates()` in `scripts/score.mjs` now accepts three universes instead of
two — `"interactive_only"`, `"interactive_or_unknown"` (new), and
`"all_sessions"` — and the chosen universe is still recorded on the wrapped
function as `__universe` for test/methodology auditing.

## Why this counted as fixing a bug, not just adding a feature

Along the way, the PR also unifies the counting class for
`focusCommandUses` and `rewindCommandUses`. Both used to increment once
per matched message (total-invocation counting); every other posture
counter (`/btw`, `/clear`, `/compact`, `/color`, `/voice`) already counted
once per session that used the command at all (session-coverage counting).
The mismatch was an artifact of when each counter was added, not an
intentional distinction — the fix brings `/focus` and `/rewind` in line so
every input to both new ratio scorers shares the same unit. A session
firing `/rewind` three times now contributes 1 to the counter, not 3 — the
same semantic the memory and customization ratios assume.

## What this means if you're reading your own dashboard

- If your Memory & Context Management or Terminal & Customization vertex on
  the Execution radar was previously italic, it will render solid the next
  time you run `npm run assess --include-transcripts` with at least one
  `interactive_cli`-or-`unknown` session in the lookback window.
- A score of 0 on either dimension is a real zero now, not "we didn't look"
  — check the evidence line for the session-coverage count and denominator
  before assuming a bug.
- If you see a "capped from N%" suffix, that's not an error: it means you
  used more than one of the tracked commands in the same session on
  average, and the scorer is being upfront that the displayed 100 doesn't
  distinguish "used it once" from "used it constantly."

## Where to look in the source

- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`
  computation.
- `scripts/score.mjs` — `withGates()` universe option; `EXECUTION_SCORERS.memory`
  and `EXECUTION_SCORERS.customization`.
- `scripts/_usage-data.mjs` — the `allowPosture` partition and the
  session-coverage counting pattern the `/focus`/`/rewind` fix now matches.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer test suite (gating, cap behavior, MAX-merge, zero-signal gaps).
- `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`
  — the design doc for this change (note: its worked numeric example sums
  `/btw + /clear + /compact + /rewind` for the memory ratio; the numerator
  actually shipped is narrower — see the CCE-79 note in this repo's
  CLAUDE.md for why `/btw` and `/rewind` were routed out of the ratio).
