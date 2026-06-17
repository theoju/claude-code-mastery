---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Separating windowed and cumulative counter semantics in `signalsSummary`

**PR #119 · 2026-06-02 · decision**

## Problem

`buildSignalsSummary` (in `scripts/run-assessment.mjs`) previously blended two
semantically incompatible counters into a single `btwCommandUses` field using
`Math.max`:

```js
// BEFORE (broken)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed session-coverage
  signals.settings?.cliBtwUseCount ?? 0, // cumulative all-time invocation count
),
```

`maxProbe(signals, "btwCommandUses")` produces a **30-day windowed
session-coverage** count — the number of sessions in the lookback window where
`/btw` was detected. `settings.cliBtwUseCount` (from `~/.claude.json`) is a
**cumulative all-time invocation count** maintained by Claude Code since the
user first ran the CLI.

The blend was originally added for predicate ergonomics: the tip 33 `satisfiedWhen`
predicate wanted to know "have you ever used `/btw`?", and `cliBtwUseCount` was
the most reliable signal. But the same field `btwCommandUses` was also the
numerator in the Memory Execution ratio scorer, which expects a windowed
count matched against a 30-day denominator.

Two axes were conflated on a single field:

| Axis | `btwCommandUses` source | `cliBtwUseCount` source |
| ---- | ----------------------- | ----------------------- |
| **(a) Time window** | 30-day windowed | Cumulative all-time |
| **(b) Counter class** | Per-session-coverage (deduped) | Raw invocation count |

An account with 36 all-time `/btw` invocations over two years but zero in the
current window would report `btwCommandUses = 36` — a number far above any
realistic 30-day session coverage ceiling — silently injecting stale signal into
the windowed ratio's numerator.

The Memory Execution score itself was unaffected in practice because the scorer
body called `maxProbe()` directly rather than reading from `signalsSummary`, but
the `signalsSummary` surface was semantically corrupt and would mislead any
consumer that trusted the field at face value.

## Fix

PR #119 splits the two sources onto independent fields:

```js
// AFTER (CCE-78)
btwCommandUses: maxProbe(signals, "btwCommandUses"),         // windowed only
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0, // cumulative only
```

The tip 33/54 predicate (`btw-side-channel`) is rerouted from
`btwCommandUses>=1` to `cliBtwUseCountAllTime>=1`, which matches its actual
intent: "have you adopted the `/btw` habit at all?" The Memory Execution ratio
numerator now touches only the windowed field, and its semantics are honest.

## Where these fields live

| Field | Source | Time window | Counter class | Predicate use |
| ----- | ------ | ----------- | ------------- | ------------- |
| `btwCommandUses` | `history` (MAX-merge of `history.jsonl` + transcripts) | 30-day windowed | Per-session-coverage | Memory Execution ratio numerator; next-action proof-of-habit threshold |
| `cliBtwUseCountAllTime` | `runtime` (`~/.claude.json → btwUseCount`) | Cumulative all-time | Raw invocation count | Boris tip 33 habit-adoption predicate (`>=1`) only |

Both fields appear in `probe-catalog.json` under their respective `source`
categories (`history` and `runtime`). The catalog entry for `btwCommandUses`
explicitly documents the separation:

> "NOT blended with `cliBtwUseCountAllTime` — that's a separate cumulative
> all-time counter exposed for 'have you ever adopted' predicates only. CCE-78."

The entry for `cliBtwUseCountAllTime` mirrors this from the other side:

> "Distinct from `btwCommandUses` which is 30-day windowed session-coverage;
> mixing the two in a ratio would corrupt window semantics (CCE-78)."

## Tests

`scripts/__tests__/signals-summary.test.mjs` adds three assertions under the
CCE-78 label:

1. `btwCommandUses` takes MAX of transcript and history only — the
   `cliBtwUseCount` all-time counter (36 in the fixture) does **not** influence
   it.
2. `cliBtwUseCountAllTime` is exposed separately and carries the
   `settings.cliBtwUseCount` value.
3. `cliBtwUseCountAllTime` defaults to `0` when `settings.cliBtwUseCount` is
   missing.

The snapshot test at the bottom of that file now includes `cliBtwUseCountAllTime`
in the locked key list, so adding or removing the field fails CI immediately.

## Probe catalog and tracker impact

| Metric | Before | After |
| ------ | ------ | ----- |
| Probe-catalog entries | 47 | 48 |
| `signalsSummary` keys | 71 | 72 |

The tracker at `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
was updated in the same PR. Header counts are CI-enforced by
`scripts/__tests__/tracker-counts.test.mjs`.

## Hard rule added to CLAUDE.md

The PR added the following to the hard-rules section to prevent future recurrence:

> **Per-field semantic categorization before adding to any numerator.** When
> adding a new field to a ratio numerator (or summing multiple fields into one),
> classify each field on two independent axes — (a) time window
> (windowed vs. cumulative) and (b) counter class
> (session-coverage vs. raw invocation count) — BEFORE writing the `sum`. If
> the new field differs from existing numerator inputs on either axis, route it
> to a separate surface instead.

## What was not changed

- **Memory Execution score**: unchanged (16). The scorer body already called
  `maxProbe()` directly and was never affected by the summary surface.
- **Dashboard behaviour**: no visible change. The fix is internal to
  `signalsSummary`'s semantics.
- **CCE-79 (follow-on)**: the deeper Memory Execution redesign — restricting the
  ratio numerator to `clearCommandUses + compactCommandUses`, surfacing `/btw`
  only as cumulative evidence text, and recalibrating the target 92 → 60 — is a
  separate PR. CCE-78 only cleaned up the summary surface.
