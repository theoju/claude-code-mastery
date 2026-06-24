---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Scoring counter semantics — separating windowed and cumulative counters

**PR #119 · v0.9.18 · 2026-06-02**

## The problem

`buildSignalsSummary` (in `scripts/run-assessment.mjs`) previously blended
two semantically incompatible counters into the `btwCommandUses` field using
`Math.max`:

```js
// v0.9.15 (before the fix):
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // 30-day windowed session-coverage
  signals.settings.cliBtwUseCount ?? 0, // cumulative all-time invocation count
),
```

The blend looks ergonomic — take the highest available signal. But it
conflates two independent semantic axes that must not be mixed when the
result feeds a ratio numerator:

| Axis             | `btwCommandUses` (transcript/history) | `settings.cliBtwUseCount` (`~/.claude.json`) |
| ---------------- | ------------------------------------- | -------------------------------------------- |
| (a) Time window  | 30-day windowed                       | Cumulative all-time                          |
| (b) Counter class | Per-session-coverage (deduped/session) | Raw invocation count                         |

When the blended field feeds any windowed ratio (e.g. the Memory Execution
scorer's `used / sessions` fraction), the numerator grows with account age
rather than reflecting recent posture. A user who invoked `/btw` hundreds of
times six months ago — but not at all in the last 30 days — gets full
session-coverage credit in the current window. The ratio drifts up over time
without any change in behavior.

## The fix

PR #119 un-blends the two counters into separate fields:

```js
// v0.9.18 (after the fix):
btwCommandUses: maxProbe(signals, "btwCommandUses"),        // 30-day windowed
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0, // cumulative all-time
```

`btwCommandUses` now carries only the 30-day windowed session-coverage count
(MAX-merged from `history.jsonl` and transcript scans, as before). The
cumulative all-time counter is promoted to a dedicated `cliBtwUseCountAllTime`
field and routed to the uses that actually want "have you ever adopted this
habit" semantics: the `btw-side-channel` predicate for Boris tips 33 and 54.

The probe catalog gained one entry (`cliBtwUseCountAllTime`, `source: runtime`)
to make the new field addressable from the `/methodology/probes` page. The
tracker header counts updated accordingly: probe-catalog 47 → 48,
`signalsSummary` keys 71 → 72.

## Semantic axes in detail

Every field that feeds a ratio numerator should be classified on both axes
before being included in any sum:

| Axis              | Classes                                        |
| ----------------- | ---------------------------------------------- |
| (a) Time window   | Windowed (e.g. 30-day) / Cumulative (lifetime) |
| (b) Counter class | Session-coverage (deduped per session) / Raw invocation count |

If a candidate field differs from existing numerator inputs on either axis, it
belongs on a separate surface — not in the same `sum`. Routes for
incompatible fields:

- **Cumulative all-time**: expose as a dedicated `*AllTime` field; surface as
  evidence text in the scorer, or gate a `>=1` habit-only predicate.
- **Raw invocation count** vs. per-session-coverage: keep as a separate signal
  for absolute-volume display; don't divide by session count.
- **Different time window**: introduce a matched denominator, or keep separate.

The `Math.max(maxProbe(s, field), cumulativeCounter)` pattern is specifically
prohibited for ratio numerators: it looks like a conservative take-the-higher
fallback, but it silently promotes cumulative all-time signal into a windowed
slot. The resulting ratio is neither honestly windowed nor honestly cumulative —
and the problem compounds as the account ages.

## Effect on scores

The Memory Execution scorer body was **not** affected by the blend at the
`signalsSummary` surface — it already called `maxProbe(signals, ...)` directly
against the raw signals object, bypassing `buildSignalsSummary` for the ratio
numerator. The Memory Execution score is unchanged at 16 in the post-fix run.

What the fix restores is **honest numerator semantics on `signalsSummary`**.
Any future scorer or predicate that reads `btwCommandUses` from the summary
now gets a cleanly windowed value, not an inflated blend. The deeper Memory
Execution scorer redesign — per-field semantic categorization of the original
four-command blend (`/btw`, `/clear`, `/compact`, `/rewind`), narrowing the
numerator to the two session-coverage signals — is filed as **CCE-79** and
builds on this clean baseline.

## Rubric predicate routing

The tip 33 predicate (`btw-side-channel`) was rerouted to `cliBtwUseCountAllTime`:

```jsonc
// rubric.json (after CCE-78):
"satisfiedWhen": "cliBtwUseCountAllTime>=1"
// Previously: "btwCommandUses>=1"
```

This is semantically correct: "have you ever adopted `/btw`" is a cumulative
habit check, not a 30-day coverage ratio. The binary `>=1` predicate does not
go into any Execution scorer numerator — it gates only the Platform Setup
next-action filter — so using the cumulative all-time counter here is the
right call.

## Hard rule added to CLAUDE.md

PR #119 codified the two-axis classification requirement as a hard rule in
`CLAUDE.md` under **Hard rules**:

> **Per-field semantic categorization before adding to any numerator.** When
> adding a new field to a ratio numerator (or summing multiple fields into
> one), classify each field on two independent axes BEFORE writing the `sum` …
> If the new field's class on either axis differs from existing numerator
> inputs, it doesn't belong in the same `sum`.

The rule includes the CCE-79 case as the canonical reference example and
explicitly calls out the `Math.max` anti-pattern.

## Files changed

| File | Change |
| ---- | ------ |
| `scripts/run-assessment.mjs` | Un-blends `btwCommandUses` / `cliBtwUseCountAllTime` in `buildSignalsSummary` |
| `app/data/probe-catalog.json` | Adds `cliBtwUseCountAllTime` entry (`source: runtime`) |
| `app/data/rubric.json` | Reroutes tip 33 predicate to `cliBtwUseCountAllTime>=1` |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Updates header counts (48 probes, 72 `signalsSummary` keys) |
| `CLAUDE.md` | Adds hard rule on two-axis counter classification |

## See also

- **CCE-79** — Memory Execution scorer redesign: narrows the ratio numerator to
  `/clear` + `/compact` (both session-coverage, windowed); surfaces `/btw` as
  cumulative evidence text; recalibrates rubric target 92 → 60.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — living
  probe tracker; the CCE-78 row updates land in the same PR per the hard rule.
