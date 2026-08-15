---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization get real Execution scorers (CCE-76)

Before PR #116, two of the twelve rubric dimensions — Memory & Context
Management and Terminal & Customization — always rendered italic on the
Execution radar. Their `EXECUTION_SCORERS` entries were `noTelemetry()`
placeholders: there was no way to tell whether you actually used `/clear`,
`/compact`, `/color`, `/voice`, or `/focus`, only whether the settings existed.
As of this PR, all twelve dimensions have an Execution scorer.

## Why cooked telemetry couldn't answer this

`~/.claude/usage-data/{facets,session-meta}/*.json` — the cooked telemetry
`/insights` itself reads — never contains a command-invocation breakdown. That
fact is real, but the CLAUDE.md rule it produced ("Memory + Customization →
unmeasured") conflated *cooked telemetry* with *Execution*. Two other
dimensions already broke that conflation: `learning` scores off a transcript
scan for the `★ Insight` banner, and `parallel` scores off a transcript scan
for worktree usage. Both mix transcript-derived signal into an otherwise
telemetry-based axis via `withGates({ transcripts: true, … })` in
`scripts/score.mjs`. CCE-76 extends the same pattern to the two remaining
gaps instead of inventing a new one.

The raw signal already existed. `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` was already counting `/btw`, `/clear`, `/compact`,
`/rewind`, `/color`, `/voice`, and `/focus` invocations, gated to sessions
classified `interactive_cli` or `"unknown"` — the `allowPosture` partition
from CCE-71 that keeps observer/SDK echo sessions from inflating posture
counters. What was missing was a scorer that consumed it.

## Closing the numerator/denominator universe gap

The seven posture-command counters are gated to `interactive_cli ∪ "unknown"`.
The existing `interactiveSessionsAnalyzed` denominator, used by other
`interactive_only`-universe scorers, is strict `interactive_cli`. Wiring the
new scorers to that denominator directly would have violated the standing
hard rule from the PR #97 planning-scorer fix: a ratio's numerator must be a
subset of its denominator's universe, or the ratio can silently exceed 100%.
Any session classified `"unknown"` would have contributed to the numerator
without contributing to the denominator.

The fix, rather than tightening `allowPosture` to drop `"unknown"`, was to
widen the denominator to match. `gatherInsightsSignals` in
`scripts/insights-signals.mjs` now computes and returns
`interactiveOrUnknownSessionsAnalyzed`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` in `scripts/score.mjs` gained a third `universe` option,
`"interactive_or_unknown"`, alongside the existing `interactive_only` and
`all_sessions`, routing to that new denominator. Tightening the partition
instead would have undone a deliberate CCE-71 decision: `"unknown"` exists as
a conservative fallback for sessions where `classifySessionKind` can't
determine the kind (truncated or legacy transcript shapes), and dropping it
would risk under-counting for users with non-standard transcripts. Widening
the denominator is the smaller, more principled diff.

## Unifying the counter class for `/focus` and `/rewind`

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented on
every matching message — a raw invocation count — while the other five
posture counters (`/btw`, `/clear`, `/compact`, `/color`, `/voice`) already
incremented once per session via a per-session flag, set and drained at the
end of each transcript scan. The mismatch was a leftover from when each
counter was added, not a deliberate distinction. `scripts/_usage-data.mjs`
now hoists `sessionHasFocus` and `sessionHasRewind` flags alongside the
existing `sessionHasBtw` et al., and increments the counters once per
session:

```js
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

All seven posture counters are now uniform session-coverage counts — a
session that used `/rewind` three times still contributes 1, matching the
semantics the new ratio scorers assume. The one test assertion this touched,
in `scripts/__tests__/scan-transcript-invocations.test.mjs`, moved from
asserting 2 (two `/rewind` messages in one session) to 1.

## The scorers themselves

Both new entries in `EXECUTION_SCORERS` (`scripts/score.mjs`) follow the same
shape: gate on `transcripts: true` and `universe: "interactive_or_unknown"`,
sum session-coverage hits across their command set, divide by
`interactiveOrUnknownSessionsAnalyzed`, and cap the ratio at 1 before scaling
to a 0–100 raw score.

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
    // ...evidence, gap, gapReason
  },
),
```

`maxProbe` MAX-merges the transcript-derived count against
`historyInvocations` from `history.jsonl` where that source exists, matching
the pattern already used for other command counters. When a session used
more than one command from the set, the sum can exceed the denominator —
the ratio is capped at 1, but the evidence string surfaces the overrun
explicitly (`"— capped from N% (multiple customization commands per
session)"`) rather than quietly rendering a clean 100. Hiding a capped ratio
behind a tidy number was flagged as a real risk during design review: a user
mixing `/color`, `/voice`, and `/focus` in the same session would otherwise
see "100/100" with no indication their actual coverage was 3x that.

`interactiveOrUnknownSessionsAnalyzed` is read from the cooked-telemetry
`insights` block computed earlier in `scripts/insights-signals.mjs`, not
`signalsSummary` — it required no new probe-catalog entry and no new
`signalsSummary` key, so this PR added zero new predicate-backed probes.

## Memory's numerator was narrowed after this PR (CCE-79)

The version of the memory scorer that shipped in PR #116 summed all four
posture counters — `/btw`, `/clear`, `/compact`, and `/rewind` — against the
same `interactive_or_unknown` denominator. That didn't survive contact with
the per-field semantic audit that CLAUDE.md now documents under CCE-79:
`/btw` is a cumulative all-time counter (not windowed the way `/clear` and
`/compact` are), and `/rewind` is a near-zero binary signal, so the original
sum mixed three different counter classes into one ratio. The current
`memory` scorer in `scripts/score.mjs` restricts the ratio numerator to the
two matched session-coverage signals, `clear` and `compact`; surfaces `/btw`
as cumulative evidence text (`cliBtwUseCountAllTime`) outside the ratio; and
drops `/rewind` from the scorer entirely, keeping it only as a binary
next-action probe via the rubric's `satisfiedWhen`. The design and
rationale for that follow-up narrowing live in the per-field table at
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
§Context — this page documents the CCE-76 scorer as it originally shipped
and the universe/counter-class groundwork that CCE-79 built on, not the
current numerator formula.

## What this changed on the radar

Two dimensions that were always italic-unmeasured on the Execution radar —
because their scorer returned `gapReason !== null` unconditionally — now
score a real number as long as `s.insights.transcriptsScanned` is true and
at least one interactive-or-unknown session was analyzed in the lookback
window. Model & Effort Tuning remains the only dimension that is only
*partially* measured (Opus-usage share comes from transcripts; effort-level
posture stays settings-only, since Claude Code doesn't emit an effort-level
telemetry field). Every other dimension, including the two this PR closed,
now has a fully-measured Execution scorer.

Coverage for both new scorers is exercised in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`,
including the `NO_INSIGHTS` / `NO_TRANSCRIPTS` / `NO_SESSIONS` gate paths,
the cap-and-surface behavior, and a `__universe` contract check confirming
both scorers are wired to `"interactive_or_unknown"`.
