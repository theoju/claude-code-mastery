---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Decision: Memory & Customization Execution scorers (CCE-76)

**PR #116 · CCE-76 · 2026-06-01**

Before this PR, two of the twelve scoring dimensions — Memory & Context
Management and Terminal & Customization — returned a `noTelemetry()` stub for
their Execution score. Neither vertex was measured; both were excluded from the
Execution overall and hidden from the next-action ranker. This made the
dashboard blind to two categories of real under-use: not running `/clear` or
`/compact` to control context growth, and not using `/color`, `/voice`, or
`/focus` to shape how Claude responds.

CCE-76 replaces both stubs with ratio-based Execution scorers backed by
transcript-derived posture-command session-coverage signals.

---

## Why cooked telemetry isn't enough

The `~/.claude/usage-data/{facets,session-meta}/*.json` files that the
dashboard reads for most Execution signals don't contain per-command
breakdowns. There's no `clearCommandCount` or `colorCommandCount` field in
session-meta. That's why the previous implementation fell back to
`noTelemetry()`.

The signals do exist — just in a different source. `scanTranscriptInvocations`
in `scripts/_usage-data.mjs` already walked `~/.claude/projects/*/*.jsonl`
and produced per-session-coverage counters for the posture commands (including
`/btw`, `/clear`, `/compact`, `/color`, `/voice`). The `learning` Execution
scorer (★ Insight banner) and the `parallel` scorer (worktree usage) already
used the same transcript-scan path through `withGates({ transcripts: true,
... })`. CCE-76 extends that pattern to two more dimensions.

---

## Counter-class unification

Before CCE-76, two posture counters had inconsistent semantics:
`focusCommandUses` and `rewindCommandUses` incremented per-message, while all
other posture counters incremented per-session (one increment per session that
used the command at least once). The mismatch was an artifact of when each
counter was added.

CCE-76 unified them. Instead of:

```js
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;
```

the scanner now sets a per-session flag:

```js
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

and increments after the session drains:

```js
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

This matches the existing pattern for `/btw`, `/clear`, `/compact`, `/color`,
and `/voice`. After the unification every counter in both scorers' numerators
has the same unit: _sessions that used this command at least once_.

---

## The denominator problem: `interactive_or_unknown`

The CLAUDE.md hard rule from PR #97 requires that a ratio's numerator universe
be a strict subset of the denominator universe. The posture-command counters are
gated behind `allowPosture` in `scanTranscriptInvocations` (line 301 of
`_usage-data.mjs`):

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Using `interactiveSessionsAnalyzed` (which equals
`sessionsByKind.interactive_cli` only) as the denominator would violate the
rule: any session where `classifySessionKind` returns `"unknown"` contributes
to the numerator but not the denominator, opening a path for ratios above 100%.

CCE-76 adds a new denominator signal:

```js
// insights-signals.mjs, line 108-109
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and a matching universe option in `withGates`:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

Both new scorers declare `universe: "interactive_or_unknown"`. The
`__universe` property is set on the wrapped function and verified by test 16 in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`.

The `"unknown"` sessions are sessions where `classifySessionKind` can't
determine the kind (truncated, legacy, or new-format transcripts). CCE-71
deliberately included them in the `allowPosture` gate as a conservative
fallback so users with non-standard transcript shapes don't get undercounted.
Widening the denominator to match is the principled fix and the smallest diff.

---

## Signal sets

### Memory Execution scorer

Defined in `scripts/score.mjs`, `EXECUTION_SCORERS.memory`. Inputs (via
`maxProbe`, which takes the max of transcript and history scanner sources):

| Command    | Source          | Notes                                             |
| ---------- | --------------- | ------------------------------------------------- |
| `/clear`   | transcript + history | Session-coverage count                       |
| `/compact` | transcript + history | Session-coverage count                       |

`/btw` and `/rewind` are not in the ratio numerator (CCE-79 refinement). `/btw`
is a cumulative all-time counter (`cliBtwUseCountAllTime`) — mixing it with the
windowed 30-day denominator would conflate two different time windows. It's
surfaced as evidence text only. `/rewind` is a keyboard shortcut that is near-
zero in transcript data; it's kept as a binary next-action probe via the rubric
`satisfiedWhen` predicate but contributes nothing to the Execution ratio.

Score formula:

```
rawRatio = (clearSessions + compactSessions) / interactiveOrUnknownSessionsAnalyzed
ratio    = min(rawRatio, 1)
rawScore = round(ratio * 100)
```

When `rawRatio > 1` (multiple memory commands used in the same session), the
evidence string includes a "capped from N%" suffix so the over-use is visible
on the radar instead of showing a clean 100.

The rubric target for memory is 60 (as of CCE-79; this test is machine-enforced
in `memory-customization-execution-scorers.test.mjs` line 216).

### Customization Execution scorer

Defined in `EXECUTION_SCORERS.customization`. Inputs:

| Command  | Source               | Notes                  |
| -------- | -------------------- | ---------------------- |
| `/color` | transcript + history | Session-coverage count |
| `/voice` | transcript + history | Session-coverage count |
| `/focus` | transcript + history | Session-coverage count |

Same formula shape. The realistic author baseline (test 15) is
`color=3, voice=0, focus=1, denom=120` → `rawScore=3`. The low value is
honest: the rubric's Platform Setup scorer had been crediting
`explanatory-output-style` installation and custom statusline without any
signal that `/color`, `/voice`, or `/focus` were being used session-to-session.

---

## Effect on Execution overall

Adding two low-scoring dims to the weighted average pulled the Execution
overall from 77 to 66. That drop is intentional. Both dimensions were
previously excluded from the denominator; their entry at low scores reflects
real under-use, not regression in behavior that was already working.

The radar's italic-unmeasured labels (shown at 0.65 opacity with a ¹ footnote)
for these two vertices disappear automatically when `gapReason === null` is
returned — no UI code change is needed. The `RadarChart.tsx` italic gate is
already conditional on `gapReason`.

---

## What doesn't change

- No new probe-catalog entries. The five CI-enforced header counts in the
  tracker stay at 75/12/48/47/71.
- `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry
  `insights` block. It's not a `buildSignalsSummary` key, so the `signalsSummary`
  key count (71) is unchanged.
- No change to the `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition. Both new
  scorers consume signals that already flow through the `allowPosture` gate
  added by CCE-71.
- No change to the `satisfiedWhen` predicates for any of the seven commands.
  The predicates gate on `>= 1`, which is invariant under session-coverage vs
  per-message counting.

---

## Tests

`scripts/__tests__/memory-customization-execution-scorers.test.mjs` (CCE-76)
covers:

- `NO_INSIGHTS`, `NO_TRANSCRIPTS`, `NO_SESSIONS` gates for both scorers
- Perfect ratio (score 100), cap fires with "capped from N%" evidence suffix
- Dual-source MAX-merge (`historyInvocations` outranks `transcriptInvocations`)
- `/rewind` excluded from numerator (score 0 when only `/rewind` fires)
- `/btw` excluded from numerator, surfaces as evidence text when
  `cliBtwUseCountAllTime > 0`
- Realistic author baseline (memory: `clear=15, compact=8, denom=120` → score 19;
  customization: `color=3, focus=1, denom=120` → score 3)
- `__universe === "interactive_or_unknown"` contract for both scorers
