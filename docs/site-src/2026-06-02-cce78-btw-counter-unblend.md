---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `cliBtwUseCount` from the Memory Execution numerator

**PR #119 · 2026-06-02 · no score impact by design**

## What was wrong

`buildSignalsSummary` in `scripts/run-assessment.mjs` previously computed
`btwCommandUses` as:

```js
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed, session-coverage
  signals.settings.cliBtwUseCount ?? 0, // cumulative all-time invocation count
),
```

The `Math.max` blend looks ergonomic — "take whichever source sees more signal"
— but it silently merges two fields that belong to different semantic axes:

| Field | Time window | Counter class |
|---|---|---|
| `btwCommandUses` (transcript + history MAX-merge) | 30-day windowed | session-coverage (deduped per session) |
| `settings.cliBtwUseCount` (from `~/.claude.json`) | cumulative all-time | raw invocation count |

Any ratio scorer whose denominator is a 30-day windowed session count (the
Memory Execution scorer) must have a numerator on the same time window. A
cumulative all-time count in the numerator doesn't just overstate things on a
single run — it drifts upward with account age while the denominator resets
every window, producing a ratio that looks like it's improving even when
recent `/btw` usage has dropped to zero.

## Two-axis classification

Before adding a field to any ratio numerator, classify it independently on
both axes:

**Axis (a) — time window**  
`windowed` (30-day / lookback-scoped) or `cumulative` (lifetime, account-global).

**Axis (b) — counter class**  
`session-coverage` (deduplicated: once per session, max N = session count) or
`raw invocation count` (unbounded; a single session can add dozens).

If the new field's class on **either** axis differs from the existing numerator
inputs, it doesn't belong in the same `sum`. Route it elsewhere: cumulative
fields surface as evidence text, binary adoption flags stay as separate
predicates, mismatched-window counters get a fresh ratio with a matched
denominator.

The CLAUDE.md hard rule that codifies this lives under
**"Don't blend cumulative all-time counters into windowed ratio surfaces."**

## The fix

PR #119 splits the single blended field into two:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` continues to be the MAX-merge of the transcript and
`~/.claude/history.jsonl` sources, both scoped to the lookback window.
`cliBtwUseCountAllTime` exposes the lifetime counter separately so
predicates that want "have you ever adopted this habit" semantics (Boris
tip 33) can use it without corrupting any ratio numerator.

The probe catalog entry for `cliBtwUseCountAllTime` (source: `runtime`,
path: `~/.claude.json → btwUseCount`) explicitly flags its cumulative
semantics and explains why it belongs in evidence text, not a ratio.

## Routing the two fields

| Surface | Field to use | Why |
|---|---|---|
| Memory Execution ratio numerator | neither directly (see CCE-79) | ratio redesign pending |
| Tip 33 "have you used `/btw`?" predicate | `cliBtwUseCountAllTime >= 1` | binary adoption check; cumulative is fine |
| Evidence prose ("N all-time `/btw` invocations") | `cliBtwUseCountAllTime` | informational, not a ratio input |
| 30-day activity metrics | `btwCommandUses` | windowed session-coverage |

## Score impact

None. The Memory Execution scorer was not actively using the blended
`btwCommandUses` in a ratio at the time this PR landed — the field existed
but CCE-79 (the broader Memory Execution scorer redesign) is the ticket that
wires it into a ratio. The unblend is a correctness fix that locks in the
right field semantics before CCE-79 makes them load-bearing.

## Follow-up: CCE-79

CCE-79 redesigns the Memory Execution scorer's ratio numerator from scratch,
applying the per-field classification table before any field enters a sum.
The key finding there: `/btw` (cumulative), `/rewind` (near-zero binary), and
`/clear + /compact` (windowed session-coverage) should not share a single
ratio. CCE-79 restricts the numerator to `/clear + /compact`, surfaces `/btw`
as cumulative evidence text via `cliBtwUseCountAllTime`, retains `/rewind`
only as a binary next-action probe, and recalibrates the rubric target from
92 to 60 to match the narrowed realistic ceiling.
