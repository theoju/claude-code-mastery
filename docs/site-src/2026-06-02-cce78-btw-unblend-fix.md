---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblending `/btw` from the Memory Execution ratio

PR #119 fixes a scoring-correctness bug in the Memory & Context Management
Execution scorer. `signalsSummary.btwCommandUses` no longer `Math.max`-blends
the cumulative all-time `/btw` invocation count into the 30-day windowed
session-coverage ratio that scorer reads.

## The bug

`btwCommandUses` is supposed to be a 30-day windowed count — how many sessions
in the current lookback window show a `/btw` invocation, MAX-merged across
`~/.claude/history.jsonl` and transcript scanning (`/btw` is a side-channel
command that rarely lands in the session JSONL, so `history.jsonl` is the
primary source; see `probe-catalog.json`'s `btwCommandUses` entry). That
windowed count feeds the numerator of the Memory Execution ratio alongside
`/clear` and `/compact`.

The original implementation, added during the v0.9.15 runtime-adoption-probes
cycle purely to make the tip 33 predicate easier to write, blended in
`~/.claude.json`'s `btwUseCount` — a cumulative, all-time invocation counter —
via `Math.max(windowedCount, cumulativeCount)`. Because the cumulative counter
only grows, it eventually dominates the `Math.max` on any account old enough
to have used `/btw` a handful of times, and the "windowed" ratio silently
stops being windowed. Per the two-axis check in this repo's CLAUDE.md (time
window: windowed vs. cumulative; counter class: session-coverage vs. raw
invocation count), the blend conflated both axes at once — exactly the CCE-78
failure mode.

## The fix

`scripts/run-assessment.mjs::buildSignalsSummary` now keeps the two counters
separate:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` stays a pure `maxProbe` merge of `history.jsonl` and
transcript-derived counts — both windowed, both session-coverage. The
lifetime counter is exposed under its own key, `cliBtwUseCountAllTime`, and
the tip 33 `satisfiedWhen` predicate in `rubric.json` was rerouted to read
that field instead of `btwCommandUses`, so the "have you ever run `/btw`"
adoption check keeps working without touching the ratio.

`app/data/probe-catalog.json` documents both fields explicitly, including the
non-blend:

> Note: NOT blended with `cliBtwUseCountAllTime` — that's a separate
> cumulative all-time counter exposed for "have you ever adopted" predicates
> only. CCE-78.

## What this doesn't fix

CCE-78 stops the specific `Math.max` blend. It does not redesign the rest of
the Memory Execution numerator, which — as of this PR — still sums other
fields with mixed windowed/cumulative and coverage/count semantics (the
`probe-catalog.json` entries for `rewindCommandUses` and the ratio-numerator
composition still flag TODOs). That broader per-field-semantics redesign is
tracked separately as **CCE-79** and lands in a later PR; treat this page as
scoped to the `/btw` unblend only.

## Where to look

- `scripts/run-assessment.mjs` — `buildSignalsSummary`, the `btwCommandUses` /
  `cliBtwUseCountAllTime` split.
- `app/data/probe-catalog.json` — `btwCommandUses` and `cliBtwUseCountAllTime`
  entries, updated descriptions.
- `app/data/rubric.json` — tip 33 `satisfiedWhen`, rerouted to
  `cliBtwUseCountAllTime`.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — living
  tracker, updated header counts and Part 2 tip-33 row.
- CLAUDE.md's "Don't blend cumulative all-time counters into windowed ratio
  surfaces" rule documents the general failure class this PR is an instance
  of.
