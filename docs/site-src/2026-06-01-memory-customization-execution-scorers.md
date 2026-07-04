---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization get real Execution scorers (CCE-76)

Through PR #116, the **Memory** and **Terminal & Customization** dimensions
were the last two of twelve still returning `noTelemetry()` on the Execution
axis — italicized, unmeasured vertices on the radar regardless of how much
you actually used `/clear`, `/compact`, `/color`, `/voice`, or `/focus`.
CCE-76 closes that gap. All twelve scored dimensions now have an Execution
scorer, though Model & Effort Tuning stays partially measured (Opus usage is
transcript-derived; effort level is still settings-only).

## What changed

`scripts/score.mjs`'s `EXECUTION_SCORERS.memory` and `.customization` are now
ratio scorers built on `withGates({ transcripts: true, universe:
"interactive_or_unknown" })`, joining `learning` (the `★ Insight` banner scan)
and `parallel` (worktree usage) as dimensions that mix transcript signals into
Execution scoring — the pattern CLAUDE.md now documents as established
rather than novel.

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const ratio = Math.min(sum / denom, 1);
    const score = Math.round(ratio * 100);
    // ...evidence + gaps
  },
),
```

Read that carefully: the shipped numerator is **`/clear` + `/compact` only**.
`/btw` is surfaced as cumulative evidence text (`cliBtwUseCountAllTime`), not
folded into the ratio, and `/rewind` is dropped from the ratio entirely and
kept only as a binary next-action probe. If you've read the CCE-76 design
spec, that's a deliberate departure from it — the original v2 spec proposed
summing `btw + clear + compact + rewind`. A follow-up redesign (CCE-79)
caught that this mixed three incompatible counter classes into one sum
(cumulative-all-time `/btw`, near-zero-signal `/rewind`, and genuine
session-coverage `/clear` + `/compact`) and narrowed the numerator before
this landed on `main`. The rubric's `memory.target` moved from 92 to 60 to
match the narrowed ceiling. See CLAUDE.md's per-field semantic categorization
rule if you're adding a new field to any ratio numerator — this is the
reference case.

The customization scorer kept the full three-command sum from the original
design, since `/color`, `/voice`, and `/focus` are all session-coverage
counters of the same class:

```js
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

Both scorers cap the ratio at 1.0 and say so in the evidence string —
`" — capped from N% (multiple memory commands per session)"` — when a
session fires more than one of the counted commands, rather than silently
flattening an over-100% raw ratio into a clean 100.

## The new `interactive_or_unknown` universe

CLAUDE.md's ratio-scorer rule says a numerator must be a strict subset of its
denominator's universe. The seven posture-command counters in
`scanTranscriptInvocations` (`_usage-data.mjs`) were already gated by
`allowPosture` to `sessionKind === "interactive_cli" || sessionKind ===
"unknown"` — the `"unknown"` branch is the conservative fallback for
transcripts `classifySessionKind` can't confidently classify. But
`interactiveSessionsAnalyzed` (used by every other posture scorer) counts
`interactive_cli` only. Wiring Memory/Customization to that narrower universe
would have let `"unknown"`-classified sessions inflate the numerator without
counting toward the denominator — exactly the class of bug PR #97 fixed for
the planning scorer.

`insights-signals.mjs` now computes and returns a matching denominator:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` in `score.mjs` grew a third `universe` option to consume it,
alongside the existing `"interactive_only"` and `"all_sessions"`.

## Counter-class unification: `/focus` and `/rewind`

Before this PR, `focusCommandUses` and `rewindCommandUses` in
`scanTranscriptInvocations` were raw per-message invocation counts — an
artifact of when they were added (an earlier detection pass), out of step
with the session-coverage counting the other five posture commands
(`/btw`, `/clear`, `/compact`, `/color`, `/voice`) already used. PR #116
retrofits them onto the same per-session flag pattern:

```js
// before: incremented once per matching message
if (found.has("focus") && allowPosture) counts.focusCommandUses++;

// after: flips a per-session flag, incremented once after session drain
if (found.has("focus") && allowPosture) sessionHasFocus = true;
// ...
if (sessionHasFocus) counts.focusCommandUses++;
```

The only behavioral consequence for existing rubric predicates
(`focusCommandUses>=1`, `rewindCommandUses>=1`) is that they're invariant
under either counting class — a `>=1` threshold doesn't care whether the
underlying number is a message count or a session count. The one test that
did change is `scan-transcript-invocations.test.mjs`, where a fixture with
two `/rewind` messages in a single session flips its assertion from `toBe(2)`
to `toBe(1)`.

## Why this matters for the two-axis model

Before CCE-76, the radar rendered Memory and Terminal & Customization as
italic, footnoted vertices — `gapReason: "NO_TRANSCRIPTS"` or similar,
depending on whether `--include-transcripts` was set. Now, with
`--include-transcripts` enabled, both dimensions produce a real
`gapReason: null` score, and `app/components/RadarChart.tsx`'s existing
"is `gapReason !== null`" check picks that up automatically — no rendering
change was needed. If you haven't opted into transcript scanning
(`scoring.includeTranscripts: true` or `--include-transcripts`), both dims
still fall back to `unavailable(GAP_REASONS.NO_TRANSCRIPTS)`, same as any
other transcript-gated scorer.

## Where to look

- `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `.customization`, and the
  `withGates` universe branch.
- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`.
- `scripts/_usage-data.mjs` — the `allowPosture` partition and the
  `/focus`/`/rewind` session-coverage retrofit.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer test suite (unavailable states, cap behavior, MAX-merge with
  history, realistic mixed inputs).
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — the
  living probe tracker, updated in the same PR per CLAUDE.md's probe-tracker
  rule.
