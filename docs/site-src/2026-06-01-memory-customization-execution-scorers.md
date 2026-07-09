---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization become measured Execution dimensions

Before PR #116 (CCE-76), two of the dashboard's twelve dimensions — **Memory &
Context Management** and **Terminal & Customization** — routed their
Execution scorer straight to `noTelemetry()`. The radar rendered both as
italic, unmeasured vertices no matter how much you actually used `/clear`,
`/compact`, `/color`, `/voice`, or `/focus`. This PR closes that gap. All
twelve dimensions now have a real Execution scorer, matching the transcript-
derived precedent already set by `learning` (the `★ Insight` banner scan) and
`parallel` (worktree-usage scan).

## What was missing, and why it was hard

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json` — the
same data `/insights` reads) never breaks down individual slash-command
invocations, so a scorer that only reads cooked telemetry has nothing to
count for these two dimensions. The fix isn't a new data source — it's
reusing the transcript-derived command counters that `scanTranscriptInvocations`
(`scripts/_usage-data.mjs`) already collects for Platform Setup next-actions,
and turning them into a session-coverage ratio the same way `permissions` and
`learning` already do.

Two things had to be fixed first before that reuse was safe:

1. **A counter-class mismatch.** `focusCommandUses` and `rewindCommandUses`
   incremented once per *message* that contained the command, while the other
   five posture counters (`btwCommandUses`, `clearCommandUses`,
   `compactCommandUses`, `colorCommandUses`, `voiceCommandUses`) incremented
   once per *session* that used the command at least once. Summing a
   per-message counter into a session-coverage ratio would silently inflate
   the numerator relative to a `sessionsAnalyzed` denominator. `_usage-data.mjs`
   now hoists `sessionHasFocus` / `sessionHasRewind` flags into the same
   per-session reset block as the other five (`scripts/_usage-data.mjs:315-316`)
   and increments the counter once per session (`scripts/_usage-data.mjs:416-417`),
   so all seven posture counters are uniformly session-coverage.
2. **A numerator/denominator universe gap.** The seven posture counters are
   gated by `allowPosture` to sessions classified `interactive_cli` **or**
   `"unknown"` (`scripts/_usage-data.mjs:300-301` — `"unknown"` is the
   conservative fallback for transcripts `classifySessionKind` can't
   confidently place). The existing `interactive_only` universe in
   `withGates` only counts strict `interactive_cli` sessions in its
   denominator. Scoring these counters against that denominator would let a
   session classified `"unknown"` contribute to the numerator without ever
   counting in the denominator — exactly the numerator-exceeds-denominator
   defect the `planning` scorer hit in PR #97 (see the CLAUDE.md hard rule on
   denominator semantics). PR #116 adds a new `interactive_or_unknown`
   universe instead of tightening `allowPosture`, so the `"unknown"`
   fallback keeps its conservative-inclusion behavior.

## The new `interactive_or_unknown` universe

`scripts/insights-signals.mjs` now computes a second session count alongside
the existing strict one:

```js
const interactiveSessionsAnalyzed = sessionsByKind.interactive_cli;
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` (`scripts/score.mjs`) accepts a third `universe` value that
selects this denominator:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

Both the `memory` and `customization` Execution scorers are wrapped with
`withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`.
The gate still fails closed the same way every other Execution scorer does:
missing `s.insights` → `GAP_REASONS.NO_INSIGHTS`; transcripts not scanned →
`GAP_REASONS.NO_TRANSCRIPTS`; zero sessions in the denominator →
`GAP_REASONS.NO_SESSIONS`. Only a real `gapReason === null` result renders as
a solid (non-italic) radar vertex.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations()      — allowPosture: interactive_cli ∪ unknown
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus,btw,rewind}CommandUses
   │  MAX-merged against signals.historyInvocations via maxProbe()
   │  (history has higher fidelity for /btw; transcripts for the rest)
   ▼
EXECUTION_SCORERS.memory / .customization   (scripts/score.mjs)
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1)
   score = round(ratio * 100)
   ▼
normalize(score, dimension.target)   — memory target=60, customization target=80
```

## The two scorers, as shipped today

**Customization** is the simpler of the two — sum three session-coverage
counters over the shared denominator:

```js
const color = maxProbe(s, "colorCommandUses");
const voice = maxProbe(s, "voiceCommandUses");
const focus = maxProbe(s, "focusCommandUses");
const sum = color + voice + focus;
const ratio = Math.min(sum / denom, 1);
```

When `sum` exceeds `denom` (a session can trip more than one of `/color`,
`/voice`, `/focus`), the score still caps at 100 but the evidence string
says so explicitly — `"... — capped from 250% (multiple customization
commands per session)"` — rather than silently presenting a clean 100/100
that hides how much over-counting happened.

**Memory** shipped in this PR as the four-counter sum
(`btw + clear + compact + rewind`) described in the original CCE-76 design.
It didn't stay that shape for long. A follow-up audit (CCE-79) applied the
CLAUDE.md per-field semantic-categorization rule — classify every numerator
field on **time window** (windowed vs. cumulative) and **counter class**
(session-coverage vs. raw invocation count) before summing it — and found
the memory numerator mixed three classes in one `sum`:

- `/btw` is counted cumulative-all-time elsewhere in the codebase
  (`cliBtwUseCountAllTime`), not windowed session-coverage.
- `/rewind` is a near-zero binary signal (bound to a keyboard shortcut, not
  typed), not a meaningful ratio contributor.
- `/clear` and `/compact` are the only two fields that are genuinely
  windowed, session-coverage counters.

The scorer as it stands in `scripts/score.mjs` today restricts the numerator
to `/clear` and `/compact` only, surfaces `/btw`'s cumulative count as
evidence text instead of folding it into the ratio, and drops `/rewind` from
the ratio entirely (it remains a Platform Setup next-action via the
`rewindCommandUses>=1` predicate on `app/data/rubric.json`'s `memory`
dimension):

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const ratio = Math.min(sum / denom, 1);
// ...
const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
const btwEvidence =
  btwAllTime > 0
    ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
    : "";
```

The narrower numerator also meant the rubric target needed recalibrating:
`memory.target` moved from the original 92 down to **60**, matching the
realistic ceiling of a two-signal ratio instead of a four-signal one.
`customization.target` is unchanged at **80**.

## Reading the evidence strings

Both scorers write a single evidence line in the same shape:

```
Memory hygiene commands: 23 session-coverage hits across 120 interactive_cli∪unknown sessions (19.17%). Plus 39 all-time /btw invocations (cumulative, not in ratio).
Customization commands: 4 session-coverage hits across 120 interactive_cli∪unknown sessions (3.33%)
```

If neither `/clear` nor `/compact` fired in any interactive-or-unknown
session, the gap list carries `"No /clear or /compact in any interactive
session"`; the equivalent for customization is `"No /color, /voice, or
/focus in any interactive session"`.

## What this doesn't change

- **No new probe-catalog entries, `signalsSummary` keys, or `satisfiedWhen`
  predicates.** `interactiveOrUnknownSessionsAnalyzed` lives on the cooked
  `insights` block, not `signalsSummary` — it's a denominator for Execution
  ratio math, not a Platform Setup probe.
- **Platform Setup scoring for these two dimensions is untouched.** The
  `customization` Platform Setup scorer still reads `focusCommandUses`
  the same way it always did; only the *counting class* of that field
  changed (per-message → session-coverage), which is invariant for every
  existing `>=1` predicate.
- **Model & Effort Tuning remains the only partially-measured dimension** —
  its Opus-usage half is scored from transcripts, but effort level itself
  stays settings-only. Every other dimension, including the two this PR
  adds, is now measured on both axes where data exists.

## Reference

- `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `EXECUTION_SCORERS.customization`, `withGates`, `maxProbe`
- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`
- `scripts/_usage-data.mjs` — `scanTranscriptInvocations`, the `allowPosture` partition
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — scorer contract tests, including the CCE-79 numerator-narrowing tests
- `app/data/rubric.json` — `memory` (target 60) and `customization` (target 80) dimensions
