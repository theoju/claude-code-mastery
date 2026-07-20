---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory and Customization get real Execution scorers (CCE-76)

Two of the twelve radar dimensions — **Memory & Context Management** and
**Terminal & Customization** — used to route straight to `noTelemetry()` on
the Execution axis. No matter how much you actually used `/clear`, `/compact`,
`/color`, `/voice`, or `/focus`, the radar rendered those two vertices
italic and unmeasured, and the ranked next-actions list couldn't credit the
behavior either. PR #116 (CCE-76) replaces both placeholders with real ratio
scorers driven by transcript-derived command counters, and in doing so closes
a latent numerator/denominator universe mismatch along the way.

## Why this was worth doing

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never
carries command-invocation breakdowns — that part of the old
`noTelemetry()` reasoning was correct. But "cooked telemetry" and
"Execution" aren't the same thing: `learning` already scores off the `★
Insight` banner scanned from transcripts, and `parallel` already scores off
worktree-usage transcript scans. CCE-76 extends that existing precedent to
Memory and Customization instead of inventing a new one.

The signals were already there. `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` has scanned `/clear`, `/compact`, `/color`,
`/voice`, `/focus`, `/btw`, and `/rewind` as **posture-command** counters
since CCE-71's per-command partition — gated so only `interactive_cli` and
`"unknown"`-kind sessions (the conservative fallback for transcripts
`classifySessionKind` can't confidently classify) contribute, so
observer/SDK echo traffic can't inflate them. The gap was purely on the
scoring side.

## What shipped

**A new `interactive_or_unknown` session universe.** The CLAUDE.md hard rule
established after PR #97's plan-mode ratio bug requires a ratio's numerator
to be a strict subset of its denominator's session universe. The posture
counters are gated to `interactive_cli ∪ "unknown"`, but the existing
`interactive_only` universe in `withGates()` (`scripts/score.mjs`) resolves
to `sessionsByKind.interactive_cli` alone — any `"unknown"`-kind session
would land in the numerator without a matching slot in the denominator.
Rather than tighten the counter partition (which would throw away CCE-71's
deliberate conservative fallback for transcripts of unrecognized shape),
CCE-76 widens the denominator to match: `insights-signals.mjs` now computes
and returns

```js
interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates()` accepts `universe: "interactive_or_unknown"` as a third
option alongside `interactive_only` and `all_sessions`.

**Counter-class unification.** `focusCommandUses` and `rewindCommandUses`
used to increment per-message; the other five posture counters
(`btwCommandUses`, `clearCommandUses`, `compactCommandUses`,
`colorCommandUses`, `voiceCommandUses`) already incremented once per session
via a `sessionHas*` flag. CCE-76 flipped `/focus` and `/rewind` onto the same
per-session pattern in `scanTranscriptInvocations`, so every posture counter
that feeds a ratio scorer is now a session-coverage hit, not a raw
invocation count — the same per-field-semantics discipline CLAUDE.md
already requires for numerator inputs generally.

**Two real ratio scorers.** `EXECUTION_SCORERS.customization` (in
`scripts/score.mjs`) now sums `maxProbe(s, "colorCommandUses")`,
`voiceCommandUses`, and `focusCommandUses` — the max of the transcript- and
history-derived counts, per command — divides by
`interactiveOrUnknownSessionsAnalyzed`, and caps the ratio at 1.0. If a
session fires more than one customization command, the raw ratio can exceed
100%; when it does, the evidence string says so explicitly (`"— capped from
N% (multiple customization commands per session)"`) instead of silently
showing a clean 100. `memory` follows the same shape, currently summing
`clearCommandUses` and `compactCommandUses` against the same denominator.

Both scorers gate on `transcripts: true`, so a user who hasn't opted into
`--include-transcripts` sees `gapReason: NO_TRANSCRIPTS` (still honestly
unmeasured) rather than a score computed from absent data.

## Results

Verified live, before/after, on a single environment
(`npm run assess --include-transcripts --insights-lookback 30 --print`):
Memory Execution went from italic-unmeasured to **16/100**, Customization
Execution from italic-unmeasured to **3/100**, and the weight-normalized
Execution overall dropped from **77 to 66**. That's expected, not a
regression — the two dimensions were never actually zero, they were hidden.
Making them visible pulls the average toward the truth: real posture-command
usage (`/clear`, `/compact`, `/color`, `/voice`, `/focus`) is a lot rarer
than the ten already-measured dimensions made the overall picture look.
CLAUDE.md's scoring-model description, the probe tracker, and the
methodology page's Memory/Customization sections were all updated in the
same PR to describe the new measurement basis — all twelve dashboard
dimensions now surface a measured Execution score, and Model & Effort Tuning
is the only one left partially measured (Opus-usage is scored from
transcripts; effort level stays settings-only, since Claude Code never
writes it to session-meta).

## What changed after

The `memory` scorer's shape above is the state as of today, not exactly what
CCE-76 shipped. CCE-76's original numerator summed four fields —
`btwCommandUses`, `clearCommandUses`, `compactCommandUses`, and
`rewindCommandUses` — against a `target: 92` rubric target. A follow-up,
CCE-79, found that mixing those four violated the same per-field-semantics
rule CLAUDE.md now documents in detail: `/btw` is a cumulative all-time
counter riding alongside three windowed session-coverage counters, and
`/rewind` was a near-zero adoption signal drowning in the sum. CCE-79
narrowed the `memory` numerator to the two session-coverage signals
(`/clear` + `/compact`), moved `/btw` to cumulative evidence text outside
the ratio, kept `/rewind` only as a binary next-action probe, and
recalibrated `memory.target` from 92 down to 60 to match the narrower,
more realistic ceiling. `customization`'s formula (`/color` + `/voice` +
`/focus` over the same denominator) was unaffected and remains as CCE-76
shipped it.

## The pattern, if you're adding the thirteenth ratio scorer

1. Check whether your counter's session-gating (posture-partition,
   `allowPosture`, etc.) matches an existing `withGates()` universe. If not,
   don't force it — add a new universe option the way CCE-76 added
   `interactive_or_unknown`, so the numerator stays a documented subset of
   the denominator.
2. Classify every field going into the numerator on both axes from
   CLAUDE.md's per-field table — time window (windowed vs. cumulative) and
   counter class (session-coverage vs. raw invocation count) — *before*
   writing the `sum`. CCE-76 got this right for `customization` and wrong
   for `memory`; CCE-79 was the cleanup.
3. Surface the cap. If a ratio can exceed 100% because a user fires multiple
   commands in one session, say so in the evidence string rather than
   letting the clamp hide it behind a clean 100.
