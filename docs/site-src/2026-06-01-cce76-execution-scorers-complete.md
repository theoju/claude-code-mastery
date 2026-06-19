---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# CCE-76: 12-of-12 Execution scorer coverage complete

**PR #116 · 2026-06-01**

Two dimensions — Memory & Context Management and Terminal & Customization — were
the last holdouts on the Execution axis. Before this PR they returned
`unavailable(NO_INSIGHTS)` regardless of how frequently you used `/clear`,
`/compact`, `/color`, or `/focus`. The radar rendered those two vertices in
italic with a footnote. This PR closes that gap: all twelve dimensions now
produce a real Execution score when transcripts are enabled.

## Why these two dimensions were unmeasured

Cooked telemetry (`~/.claude/usage-data/`) never breaks down which slash
commands ran in a session — it records token counts, model choices, and
friction labels, not command invocations. Memory and Customization scorers need
command-level signal, so the prior scorer for both was simply `noTelemetry()`.

The unlock came in CCE-71 (PR #110), which introduced the
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition in
`scripts/_usage-data.mjs`. That partition gates posture-command scanning to
`interactive_cli ∪ unknown` sessions only, filtering out observer- and
sdk_orchestrated-session echo inflation. Once those counters were trustworthy,
the only remaining gap was an architectural one: the `withGates` denominator.

## The denominator problem — and how it was fixed

The seven posture-command counters (`/btw`, `/clear`, `/compact`, `/rewind`,
`/color`, `/voice`, `/focus`) are gated via `allowPosture` to sessions
classified as either `interactive_cli` or `"unknown"`. The only available
denominator, `interactiveSessionsAnalyzed`, was `sessionsByKind.interactive_cli`
only. Dividing an `interactive_cli ∪ unknown` numerator by a strict
`interactive_cli` denominator violates the CLAUDE.md rule that **a ratio's
numerator must be a subset of its denominator's universe** — the ratio could
silently exceed 100%.

PR #116 adds `interactiveOrUnknownSessionsAnalyzed` in
`scripts/insights-signals.mjs`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

It also extends `withGates` to accept `universe: "interactive_or_unknown"` and
routes that option to the new denominator. Three universe options now exist:

| Universe | Denominator | Used by |
|---|---|---|
| `"interactive_only"` | `interactiveSessionsAnalyzed` | permissions, planning, model-effort, learning, parallel, automation |
| `"interactive_or_unknown"` | `interactiveOrUnknownSessionsAnalyzed` | **memory, customization** |
| `"all_sessions"` | `sessionsAnalyzed` | verification, integrations, scheduled, remote |

The choice of `"interactive_or_unknown"` for these two scorers mirrors the
`allowPosture` gate in `scanTranscriptInvocations`. CCE-71 deliberately
included `"unknown"` as a conservative fallback for sessions where
`classifySessionKind` can't determine the kind (truncated/legacy/new-format
transcripts). Widening the denominator to match is the principled fix; tightening
`allowPosture` to `interactive_cli` only would silently under-count for users
with non-standard transcript shapes.

## Counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented
per-message — one increment each time a message containing `/focus` or `/rewind`
was scanned. The other five posture counters (`/btw`, `/clear`, `/compact`,
`/color`, `/voice`) incremented per-session via flag variables
(`sessionHasBtw`, etc.) at the per-session emit block.

PR #116 brings `focus` and `rewind` in line: lines 334-335 of
`scripts/_usage-data.mjs` now set `sessionHasFocus = true` / `sessionHasRewind = true`
rather than incrementing directly, and the emit block appends matching
`if (sessionHasFocus) counts.focusCommandUses++` lines. After the unification
every posture counter is a session-coverage counter — max value equals the
number of scanned interactive-or-unknown sessions. The scorer math has uniform
units.

One test changed value: `scan-transcript-invocations.test.mjs` had an assertion
that a session with two `/rewind` messages would produce `toBe(2)`; under
session-coverage the correct value is `toBe(1)`.

## Memory Execution scorer

The final scorer in `EXECUTION_SCORERS.memory` (`scripts/score.mjs`) uses the
`withGates({ transcripts: true, universe: "interactive_or_unknown" })` wrapper
and the following numerator:

```
sum = clearCommandUses + compactCommandUses   (MAX-merged from transcripts and history)
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
score = round(ratio × 100)
```

**What's not in the numerator:**

- `/btw` — `btwCommandUses` in transcripts is a windowed 30-day session-coverage
  counter, but `cliBtwUseCountAllTime` from `~/.claude.json` is a cumulative
  all-time invocation count (different time window and counter class). Blending
  them into one ratio numerator would produce a ratio that drifts up with account
  age. The CCE-79 redesign removed `/btw` from the ratio and surfaces it as
  evidence text (`Plus N all-time /btw invocations (cumulative, not in ratio)`)
  so the transparency is preserved without corrupting the rate.
- `/rewind` — a keyboard shortcut that doesn't appear in transcripts by default
  (`HISTORY_COMMAND_LIST` in `_history-data.mjs` excludes it). Near-zero signal;
  kept as a binary next-action probe via `rubric.json` `satisfiedWhen`, not a
  ratio numerator.

The `memory` dimension's rubric `target` was recalibrated from 92 to 60
(CCE-79) to reflect the narrowed realistic ceiling. Half-session coverage of
`/clear + /compact` now saturates to 100/100 after normalization.

When the cap fires (`rawRatio > 1` — possible because `/clear` and `/compact`
are separate session-coverage counters and a session using both contributes 1
to each), the evidence string appends `— capped from N% (multiple memory
commands per session)`. The cap still bounds the displayed score to [0, 100],
but the multi-counting is visible in the evidence rather than silently masked.

## Customization Execution scorer

`EXECUTION_SCORERS.customization` follows the same shape:

```
sum = colorCommandUses + voiceCommandUses + focusCommandUses
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
score = round(ratio × 100)
```

All three inputs are now session-coverage counts (after the counter-class
unification above). The `customization` dimension target is 80. The same
cap-surfacing logic applies: if sum exceeds the denominator (e.g., a session
uses all three commands), the evidence reports "capped from N%".

## Radar changes

`app/components/RadarChart.tsx` already conditionally applies italic + 0.65
opacity based on `gapReason !== null`. Before this PR, both memory and
customization Execution scorers returned a non-null `gapReason` via
`unavailable(...)`. Both new scorers return `gapReason: null` on every code
path that produces a real score. No UI code changes were needed — the two
vertices become solid automatically once `gapReason` is null.

## Tests

11 new tests were added in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`, bringing
the suite to 564 tests. Coverage includes:

- `NO_INSIGHTS`, `NO_TRANSCRIPTS`, `NO_SESSIONS` gating for both scorers
- Cap-fires-and-surfaces-evidence for both scorers
- MAX-merge from history source (memory scorer, Test 6)
- `/rewind` and `/btw` excluded from numerator (Tests 7, 12a, 12b, 12c)
- `__universe === "interactive_or_unknown"` contract for both scorers (Test 16)
- Realistic author-environment baseline: `clearCommandUses=15`,
  `compactCommandUses=8`, `denom=120` → `score=19` (Test 9)

## What this doesn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or `signalsSummary`
  keys. The five machine-enforced tracker-counts header values (`75/12/48/47/71`)
  are unchanged. `interactiveOrUnknownSessionsAnalyzed` lives in the
  cooked-telemetry insights block, which has its own probe-tracker rows but no
  machine count.
- The `model-effort` dimension remains the only partially-measured Execution dim:
  Opus usage is scored from transcripts; effort level has no session-level signal
  to score against.
- Platform Setup scores for memory and customization are unaffected. The new
  signals feed the Execution axis only.

## Deferred work

- **Per-session aggregate signals.** True union counting (`sessionsWithAnyMemoryCommand`)
  would eliminate the multi-counting in the numerator without relying on the cap.
  Deferred to a follow-up PR.
- **Customization target calibration.** The author's empirical baseline shows
  ~4/100 Execution for customization (3 color-session hits + 1 focus hit across
  120 sessions). Whether target=80 is the right calibration or should be lowered
  is deferred until live data from more users accumulates.
