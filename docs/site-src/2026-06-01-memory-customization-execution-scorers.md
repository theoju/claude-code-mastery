---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Before PR #116 (CCE-76), the **Memory & Context Management** and **Terminal &
Customization** dimensions were the last two of the twelve rubric dimensions
still stubbed out with `noTelemetry()` on the Execution axis — the radar drew
them italic and unmeasured no matter how much you actually used `/clear`,
`/compact`, `/color`, `/voice`, or `/focus`. PR #116 replaced both with real
ratio scorers driven by transcript-derived, session-coverage signals, closing
Execution-scorer coverage across all twelve dimensions.

## What changed

Three pieces landed together in `scripts/score.mjs`, `scripts/insights-signals.mjs`,
and `scripts/_usage-data.mjs`:

1. **Real ratio scorers.** `EXECUTION_SCORERS.memory` and
   `EXECUTION_SCORERS.customization` switched from `noTelemetry()` to
   `withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`
   — the same wrapper `learning` and `parallel` already used to mix
   transcript signals into Execution scoring.
2. **A new session universe.** The seven posture-command counters
   (`/btw`, `/clear`, `/compact`, `/rewind`, `/color`, `/voice`, `/focus`)
   are gated to `interactive_cli ∪ "unknown"` sessions (the conservative
   fallback for transcripts `classifySessionKind` can't confidently
   classify). The pre-existing `interactive_only` universe used
   `interactiveSessionsAnalyzed` — strict `interactive_cli` — as its
   denominator, which would have let a numerator built from
   `interactive_cli ∪ unknown` sessions exceed its own denominator's
   universe. `insights-signals.mjs` now computes and returns
   `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli +
sessionsByKind.unknown`, and `withGates` accepts a third `universe` value,
   `"interactive_or_unknown"`, that routes to it. This keeps the CLAUDE.md
   invariant from the PR #97 / v0.9.17 planning-scorer fix intact: a ratio's
   numerator must stay a subset of its denominator's universe.
3. **Counter-class unification.** `focusCommandUses` and `rewindCommandUses`
   in `scanTranscriptInvocations` (`scripts/_usage-data.mjs`) previously
   incremented per-message — a raw invocation count. The other five posture
   counters already incremented per-session via a `sessionHas*` flag set once
   per session and drained after each file. PR #116 hoisted
   `sessionHasFocus` / `sessionHasRewind` alongside the existing
   `sessionHasBtw` et al. so all seven posture counters are now
   session-coverage counts — one increment per session that used the
   command at least once, capped at the number of sessions scanned. This
   matters because the new scorers sum counters into a single ratio; mixing
   a raw-invocation-count field into a sum of session-coverage fields would
   have violated the same per-field counter-class rule that governed the
   `/btw` cumulative-vs-windowed fix (CLAUDE.md, "Per-field semantic
   categorization before adding to any numerator").

## How the scorers work

Both scorers follow the same shape. From `EXECUTION_SCORERS.customization`
in `scripts/score.mjs`:

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
    // ...
  },
),
```

`maxProbe` (`score.mjs`) MAX-merges the transcript-derived count against the
equivalent `~/.claude/history.jsonl`-derived count for the same field, so a
command typed via either surface counts once. The gates in `withGates` return
`unavailable()` with a `gapReason` — `NO_INSIGHTS`, `NO_TRANSCRIPTS`, or
`NO_SESSIONS` — before the scorer body runs at all, so a user who hasn't
opted into `--include-transcripts`, or who has zero sessions in the scoring
window, still sees an honest unmeasured state rather than a manufactured
zero.

Because every input to the sum is a session-coverage count, a session that
fires two different memory or customization commands contributes to more
than one counter — the raw sum can exceed the session denominator. Both
scorers cap the displayed score at 100 via `Math.min(rawRatio, 1)`, and
critically, they don't hide the overshoot: when `rawRatio > 1` the evidence
string appends a `capped from N%` suffix, e.g. `100/100 — capped from 250%
(multiple customization commands per session)`. A cleaner fix — a single
`sessionsWithAnyMemoryCommand` / `sessionsWithAnyCustomizationCommand`
aggregate at the scanner layer that eliminates the double-count outright —
was deliberately deferred to a follow-up; the cap-plus-visible-overshoot is
the interim honesty mechanism.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations()          (allowPosture: interactive_cli ∪ unknown)
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus,btw,rewind}CommandUses
   │  MAX-merged against signals.historyInvocations (history.jsonl)
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)  →  score = round(ratio * 100)
   │
   ▼
normalize(score, dimension.target)  →  Execution radar vertex
```

The italic-unmeasured styling on `RadarChart` is driven purely by
`gapReason !== null`; once a scorer returns `gapReason: null`, the vertex
renders solid automatically — no chart code changed to light these two up.

## The memory numerator narrowed after this PR (CCE-79)

PR #116 originally summed all four memory-adjacent counters —
`btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses`
— into one ratio. That mixed three different field classes into a single
sum: `/btw` is tracked elsewhere in the codebase as a **cumulative,
all-time** counter (`cliBtwUseCountAllTime`) rather than a 30-day windowed
one, and `/rewind` is a near-zero, keyboard-shortcut-triggered signal that
almost never appears in transcript text. A follow-up redesign, CCE-79,
narrowed the live numerator to just the two windowed, session-coverage
signals that share the same semantic class — `/clear` and `/compact` — as
you can confirm in the current `EXECUTION_SCORERS.memory` body in
`scripts/score.mjs`. `/btw`'s cumulative count now only surfaces as evidence
text (`Plus N all-time /btw invocations (cumulative, not in ratio).`), and
`/rewind` is no longer counted in the ratio at all — it remains available
only as a binary `rewindCommandUses>=1` next-action predicate in the rubric.
The rubric's `memory.target` was recalibrated from 92 to 60 to match the
narrowed, more realistic ceiling. If you're reading `score.mjs` directly,
the numerator you'll see today is `/clear + /compact`, not the four-field
sum this PR originally shipped — the `withGates` plumbing, the
`interactive_or_unknown` universe, and the `/focus`+`/rewind` counter-class
unification described above are the parts of PR #116 that are still exactly
as shipped.

## Tests

`scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers
both scorers directly against `EXECUTION_SCORERS`, including the three
`unavailable()` gap paths, the cap-and-surface-the-overshoot behavior, the
history-source MAX-merge, and — reflecting the CCE-79 follow-up — that
`/btw` and `/rewind` no longer contribute to the memory ratio. A
`__universe` contract test asserts both scorers expose
`__universe === "interactive_or_unknown"`, and a numerator-subset-of-
denominator test in the insights-signals suite guards the invariant that
`interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for
any fixture — the machine-enforced form of the PR #97 hard rule this PR had
to satisfy.
