---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19: un-blending the `/btw` counter

PR #120 cuts `v0.9.19` (`package.json` version bump only, `0.9.18` →
`0.9.19`). The substantive change it packages was already merged in PR #119
(CCE-78); this release PR is the version-bump vehicle, plus housekeeping to
archive the landed CCE-72/CCE-76 plans.

## What was wrong

`signalsSummary.btwCommandUses` is supposed to be a 30-day windowed,
session-coverage count — how many _sessions_ in the scoring window used
`/btw`. The pre-fix code instead did:

```js
Math.max(maxProbe(s, field), cliBtwUseCount);
```

`cliBtwUseCount` comes from `~/.claude.json`, and it's a cumulative,
all-time, raw invocation counter — it never resets, and it counts calls,
not sessions. Blending it into the numerator with `Math.max` meant the
Memory Execution ratio's numerator silently drifted upward with account
age, independent of anything that happened in the actual 30-day scoring
window.

This is exactly the failure mode the project's counter-semantics rule
exists to catch: two independent axes — **time window** (windowed vs.
cumulative) and **counter class** (session-coverage vs. raw invocation
count) — have to match before two fields land in the same `sum`. `/btw`
and `/clear`/`/compact` didn't match on either axis.

## The fix

- `cliBtwUseCount` (cumulative, all-time) is now exposed on its own
  `signalsSummary` field, `cliBtwUseCountAllTime`, instead of being folded
  into `btwCommandUses`.
- The `btw-side-channel` rubric predicate (tip 33/54) is rerouted to read
  `cliBtwUseCountAllTime` directly — a habit-only `>=1` adoption check is a
  legitimate use of a cumulative counter; a windowed ratio numerator is not.
- `btwCommandUses` goes back to being purely session-coverage, purely
  windowed.

## Follow-up filed

The Memory Execution scorer's numerator still sums `/btw` + `/clear` +
`/compact` + `/rewind` as a single quantity, which mixes more than just the
one field this PR fixed — `/rewind` is a near-zero binary signal, not a
comparable session-coverage count either. Redesigning that numerator
per-field is filed as **CCE-79** and is out of scope for this release.

## Why this matters beyond one field

This cycle is the reference case for a new CLAUDE.md hard rule: before
adding any field to a ratio numerator (or summing several into one), classify
each field on both axes first. A field that differs from the rest of the sum
on either axis doesn't belong in the same `sum` — route it to evidence text,
a separate binary predicate, or a separately-denominated ratio instead.
