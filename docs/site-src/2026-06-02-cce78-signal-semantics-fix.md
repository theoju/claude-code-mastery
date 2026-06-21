---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Signal Semantics Fix — `/btw` Counter Separation

**PR #119 · 2026-06-02 · non-breaking**

## Problem

`signalsSummary.btwCommandUses` was computed via a `Math.max` blend of two
counters with incompatible semantics:

| Counter | Source | Time window | Counter class |
| --- | --- | --- | --- |
| `maxProbe(signals, "btwCommandUses")` | `~/.claude/history.jsonl` + transcripts | **30-day windowed** | session-coverage (deduped per session) |
| `signals.settings.cliBtwUseCount` | `~/.claude.json` | **cumulative all-time** | raw invocation count |

`Math.max` of these two always returned the larger one. For any account where
lifetime `/btw` invocations exceeded recent session-coverage, the cumulative
counter won — silently inflating `btwCommandUses` in `signalsSummary`. The
blend grew monotonically with account age regardless of recent behavior.

The original intent was predicate ergonomics: the tip-33 predicate
(`btw-side-channel`) needs an "ever adopted" semantic, and the side-channel
command rarely lands in session JSONL. But folding a cumulative counter into
a field named `btwCommandUses` — whose denominator in the Memory Execution
scorer was a 30-day windowed session count — produced a ratio that drifted
up over time rather than reflecting the current 30-day window.

## Two independent semantic axes

CCE-78 formalizes the classification requirement that was implicit but
unenforced. Any field added to a ratio numerator must be classified on both
axes before it's added:

| Axis | Classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

A field that differs from existing numerator inputs on **either** axis doesn't
belong in the same sum. Route it to a separate surface: a binary predicate, a
separate ratio with a matched denominator, or cumulative evidence text. The
`Math.max` blend looked ergonomic but conflated both axes simultaneously.

## Fix

The blend at `scripts/run-assessment.mjs` was removed. `signalsSummary` now
exposes two distinct fields:

```js
// 30-day windowed session-coverage only — safe to use in ratio numerators
btwCommandUses: maxProbe(signals, "btwCommandUses"),

// Cumulative all-time count from ~/.claude.json — for "ever adopted" predicates only
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The tip-33 predicate (`btw-side-channel`) was rerouted from
`btwCommandUses>=1` to `cliBtwUseCountAllTime>=1`. This correctly matches the
"have you ever adopted this habit" semantic — `/btw` is a side-channel command
that rarely surfaces in session JSONL, so the lifetime count from
`~/.claude.json` (`btwUseCount`) is the right signal for an adoption gate.

The Memory Execution scorer body was already reading `maxProbe(...)` directly
rather than the blended summary field, so its score is **intentionally
unchanged** by this PR.

## Probe catalog and key counts

`probe-catalog.json` gained the new `cliBtwUseCountAllTime` entry (source:
`runtime`, path: `~/.claude.json → btwUseCount`). The existing `btwCommandUses`
entry was updated to document the separation explicitly:

> NOT blended with cliBtwUseCountAllTime — that's a separate cumulative
> all-time counter exposed for 'have you ever adopted' predicates only. CCE-78.

Counts after this PR:

| Metric | Before | After |
| --- | --- | --- |
| `probe-catalog.json` entries | 47 | 48 |
| `signalsSummary` keys | 71 | 72 |

## Tests

`scripts/__tests__/signals-summary.test.mjs` adds three assertions locked to
this contract:

- `btwCommandUses` takes MAX of transcript and history only — **not**
  `cliBtwUseCount` — even when `settings.cliBtwUseCount` is 36 and the
  windowed counter is 5; the field returns 5.
- `cliBtwUseCountAllTime` is exposed separately and carries the cumulative
  value (36 in that fixture).
- `cliBtwUseCountAllTime` defaults to 0 when `settings.cliBtwUseCount` is
  missing.

The snapshot test in `build-signals-summary.test.mjs` locks the full key set
so any future inadvertent merge into `btwCommandUses` fails CI.

## Rule codified in CLAUDE.md

The CLAUDE.md hard-rules section documents the two-axis classification
requirement under "Per-field semantic categorization before adding to any
numerator" and provides a reference table plus the CCE-78/CCE-79 incident as a
worked example. The rule also calls out the `Math.max` pattern specifically:

> A summary blend via `Math.max(maxProbe(s, field), cumulativeCounter)` looks
> ergonomic but conflates both axes — keep the cumulative source on a separate
> signalsSummary field and route habit-only predicates at the cumulative field.

## Follow-up: CCE-79

This PR separates the counters at the `signalsSummary` surface and fixes the
blending bug. It does **not** redesign the Memory Execution scorer's numerator.
The scorer currently sums several fields whose per-field semantics were never
formally classified. CCE-79 (Memory Execution scorer redesign) applies the same
two-axis audit to every numerator input, narrows the numerator to the two
session-coverage signals (`/clear` + `/compact`), surfaces `/btw` as
cumulative evidence text, and recalibrates the rubric target to match the
narrowed realistic ceiling.
