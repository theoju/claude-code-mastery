---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# CCE-78: Scoring signal fix — cumulative/windowed counter blend (PR #119)

**Release:** v0.9.18 · **Scope:** `scripts/run-assessment.mjs`, `scripts/score.mjs`, `app/data/probe-catalog.json`, `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

---

## What changed

PR #119 removes a `Math.max` blend in `run-assessment.mjs` that was silently
conflating two semantically incompatible sources into the `signalsSummary`
field `btwCommandUses`:

```js
// Before (corrupting blend — removed)
btwCommandUses: Math.max(
  maxProbe(signals, 'btwCommandUses'),   // 30-day windowed session-coverage
  signals.cliBtwUseCount                 // cumulative all-time invocation count
)
```

The blend made `signalsSummary.btwCommandUses` drift upward with account age
rather than reflecting recent posture — exactly the wrong signal to feed into a
30-day windowed ratio numerator.

**After the fix:**

- `btwCommandUses` in `signalsSummary` is the unblended 30-day windowed
  session-coverage counter.
- A new `cliBtwUseCountAllTime` field exposes the cumulative source separately.
- The Boris tip 33+54 btw-side-channel predicate (`btwCommandUses >= 1`) is
  rerouted to `cliBtwUseCountAllTime >= 1` — adoption-habit semantics belong
  on the cumulative source, not the windowed one.

## Why this matters

Every ratio scorer has two independent semantic axes:

| Axis | Classes |
| ---- | ------- |
| **(a) Time window** | windowed (e.g. 30-day) / cumulative (lifetime) |
| **(b) Counter class** | session-coverage (deduped per session) / raw invocation count |

The original blend conflated both: `btwCommandUses` was windowed + session-coverage;
`cliBtwUseCount` was cumulative + raw invocation count. Mixing them via `Math.max`
made the numerator look like whichever source was larger — and since the cumulative
count grows monotonically, a long-lived account would always end up with the
cumulative value in the windowed ratio.

This is now a documented hard rule in `CLAUDE.md`: before adding a field to any
ratio numerator, classify it on both axes. If a new field's class differs from
existing numerator inputs on either axis, it does not belong in the same `sum`.
Route it to a separate surface — evidence text, a standalone predicate, or a
ratio with a matched denominator.

## Numerical impact

The Memory Execution score is **numerically unchanged at 16/100**. The fix
corrects the honesty of the `signalsSummary` surface and the probe predicate;
it does not change the score formula itself. The deeper Memory Execution
numerator redesign (per-field semantic categorization across `/btw`, `/clear`,
`/compact`, and `/rewind`) is tracked as **CCE-79**.

## Probe catalog and tracker

Probe count advanced from 47 → 48; `signalsSummary` key count advanced from
71 → 72, reflecting the newly surfaced `cliBtwUseCountAllTime` field. Both
header counts in `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
are CI-enforced by `scripts/__tests__/tracker-counts.test.mjs`.

## What stays the same

- `signals.settings.cliBtwUseCount` (the raw field from `~/.claude.json`) is
  still read by `scripts/signals.mjs`.
- The Memory **Platform Setup** scorer evidence line (`scripts/score.mjs:813`)
  still references the raw field directly — only the corrupting blend at the
  `signalsSummary` layer was removed.
- All other signals, scorers, and probe predicates are unaffected.

## Relation to CCE-79

CCE-79 tracks the follow-up: a full per-field semantic audit of the Memory
Execution numerator, which currently sums `/btw + /clear + /compact + /rewind`
even though those four signals mix time windows, counter classes, and near-zero
binary signals. CCE-78 fixed the `signalsSummary` surface; CCE-79 will fix the
numerator itself and recalibrate the rubric target from 92 → 60 to match the
narrowed realistic ceiling.
