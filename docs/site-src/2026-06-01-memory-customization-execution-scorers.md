---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# CCE-76: Memory & Customization Execution Scorers

**Ticket:** CCE-76 · **PR:** #116 · **Shipped:** 2026-06-01

All twelve scoring dimensions now carry real Execution scorers. This page
records the decision: what was broken, why the fix took the shape it did, and
what the numbers mean post-merge.

## What was broken

The Memory & Context Management and Terminal & Customization dimensions both
routed to `noTelemetry()` in `EXECUTION_SCORERS` inside `scripts/score.mjs`.
That placeholder returns `{ score: null, gapReason: "no telemetry" }`, which
the radar renders as italic labels with a footnote rather than a scored vertex.

The root cause was a conflation in the original design: the rule "Execution
data comes from cooked telemetry (`~/.claude/usage-data/`)" was stated as if
it were exhaustive. It isn't. The Learning and Parallel Execution scorers
already consume transcript signals via `withGates({ transcripts: true, … })`
— star-Insight banner counts (Learning) and worktree-state flags (Parallel).
Memory and Customization had transcript signals available through the exact
same mechanism; the placeholder was just never replaced.

## Three changes, one PR

### 1. Counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` in
`scripts/_usage-data.mjs` incremented once **per matching message** (lines
334-335). Every other posture command (`/btw`, `/clear`, `/compact`,
`/color`, `/voice`, `/simplify`, `/fewer-permission-prompts`) incremented once
**per session** — a flag flipped on first sighting, emitted to the counter
after the session drain.

The mismatch was an artifact of when each counter was added. This PR retrofits
the two outliers to the session-coverage pattern: lines 334-335 become
`sessionHasFocus = true` and `sessionHasRewind = true`, with matching emit
lines after line 411 alongside the existing `sessionHasBtw` et al. The
counters' semantics shifted from "total invocations" to "sessions where the
command appeared at least once."

All downstream consumers are invariant under the change: the rubric predicates
(`focusCommandUses>=1`, `rewindCommandUses>=1`) are adoption checks, so one or
many invocations produces the same boolean. The one test that wasn't invariant
— a fixture writing two `/rewind` messages and asserting `toBe(2)` — flipped
to `toBe(1)` with a matching test-name reword.

### 2. New `interactiveOrUnknownSessionsAnalyzed` denominator

The seven posture-command counters are gated in `scanTranscriptInvocations` to
`allowPosture = (sessionKind === "interactive_cli" || sessionKind ===
"unknown")`. The conservative `"unknown"` fallback exists for transcripts where
`classifySessionKind` can't determine the kind (truncated, legacy, or
new-format files).

A naive scorer using `universe: "interactive_only"` would violate the
CLAUDE.md hard rule from PR #97: **a ratio's numerator must be a subset of its
denominator's universe**. Any session classified as `"unknown"` contributes
session-coverage hits to the numerator but not to
`interactiveSessionsAnalyzed`, which would allow the ratio to exceed 1.0 and
let `Math.min(ratio, 1)` silently mask the violation rather than exposing it.

Fix: `scripts/insights-signals.mjs` computes

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and returns it alongside the existing `interactiveSessionsAnalyzed`. The `withGates`
function in `scripts/score.mjs` gains a third universe option,
`"interactive_or_unknown"`, that routes to this field. The validation error
message lists all three accepted universes so a future caller sees the full
menu immediately.

### 3. Memory and Customization Execution scorers

Both scorers follow the same pattern: `withGates({ transcripts: true, universe:
"interactive_or_unknown" }, ...)` with a ratio of session-coverage hits to
`interactiveOrUnknownSessionsAnalyzed`, capped to [0, 100].

**Memory** (`EXECUTION_SCORERS.memory`): numerator is `/clear` + `/compact`
session-coverage hits, MAX-merged from `transcriptInvocations` and
`historyInvocations`. `/btw` was initially included in the design but was
reclassified by CCE-79: it's a cumulative all-time counter rather than a
30-day windowed session-coverage signal, so mixing it into the ratio numerator
would blend incompatible time windows. It now surfaces as evidence text only
(`cliBtwUseCountAllTime` from `signalsSummary`). `/rewind` was also dropped —
it's a keyboard shortcut that virtually never appears in transcripts
(`_history-data.mjs` `HISTORY_COMMAND_LIST` excludes it), and keeping it in
the ratio held the denominator to a counter that's always near zero.

**Customization** (`EXECUTION_SCORERS.customization`): numerator is `/color` +
`/voice` + `/focus` session-coverage hits, MAX-merged from the same two
sources.

Both scorers surface "capped from N%" in the evidence string when `rawRatio >
1` — the cap is correct behavior (a session using both `/clear` and `/compact`
contributes once to each, so the sum can exceed the denominator), but the
over-counting should be visible to anyone reading the radar drilldown.

Both scorers expose `__universe === "interactive_or_unknown"` on the wrapped
function so tests and the methodology page can audit the contract.

## Why the Execution average dropped

Before this PR, Memory and Customization contributed `null` to
`executionOverall`; they were excluded from the weighted average entirely. After
the PR they join with low raw scores (the author's environment yielded Memory
~16 and Customization ~3 at the time). Two previously-excluded dimensions
averaging in at low values pulls the composite down — in the author's
environment the Execution overall moved from 77 to 66.

This is correct behavior, not a regression. The prior 77 was an optimistic
artifact of not measuring two dimensions. The new 66 is honest: you may have
memory hygiene tools installed (Platform Setup scores those) but the scorers
now check whether `/clear` and `/compact` actually appear in your sessions.

## Test suite

The full suite grew from 647 to 666 passing tests. The new
`scripts/__tests__/memory-customization-execution-scorers.test.mjs` file covers:

- `unavailable` paths for missing insights, transcripts not scanned, and zero
  denominator (Tests 1-3 for Memory; mirrored for Customization)
- Cap behavior with evidence suffix (Tests 5, 13)
- MAX-merge from history source (Test 6)
- `/rewind` transcript-only asymmetry and CCE-79 exclusion (Test 7, 12a)
- `/btw` cumulative evidence text present/absent (Tests 12b, 12c)
- Boundary case at exactly `denom` session-coverage hits (Test 10)
- `__universe` contract (Test 16)
- Realistic author-baseline inputs (Tests 9, 15)

A numerator-subset-of-denominator test in `insights-signals.test.mjs` asserts
`interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for any
fixture — the machine guard for the PR #97 hard rule.

## Radar UI change

The `RadarChart` component renders italic labels and a `¹` footnote for
dimensions whose `gapReason !== null`. Both scorers now return `gapReason:
null`. No UI code changed — the italic vertices became solid automatically.

## What this PR does not change

- **No new probe-catalog entries or `satisfiedWhen` predicates.** The five
  machine-enforced tracker header counts (75 tips / 12 dimensions / 48
  next-actions / 47 catalog entries / 71 `signalsSummary` keys) stayed at
  75/12/48/47/71. The new `interactiveOrUnknownSessionsAnalyzed` field lives
  in the cooked-telemetry `insights` block, which has probe-tracker rows but no
  machine-enforced count.
- **No rubric target changes.** Target tuning for the new scorers was deferred
  to a follow-up PR after live data could inform the calibration.
- **Model & Effort Tuning** remains the only partially-measured dimension (Opus
  usage scored from transcripts; effort level is settings-only with no Execution
  signal available).
