---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblending `/btw` usage from the Memory Execution numerator

PR #119 fixes a metric-blending bug in `buildSignalsSummary()`
(`scripts/run-assessment.mjs`): the `signalsSummary.btwCommandUses` field no
longer `Math.max`-combines two counters that look interchangeable but aren't.

## The bug

Before this fix, `btwCommandUses` took the max of:

- the 30-day windowed, session-coverage count of `/btw` invocations
  (`maxProbe(signals, "btwCommandUses")` — the transcript/`history.jsonl`
  merge described a few lines above it in `buildSignalsSummary`), and
- `signals.settings.cliBtwUseCount` — a **cumulative, all-time** invocation
  counter read from `~/.claude.json`.

Both numbers describe "have you run `/btw`," so folding them into one field
reads as harmless ergonomics. It isn't. Per the two-axis classification this
repo's CLAUDE.md now spells out for every ratio numerator — **(a) time
window** (windowed vs. cumulative) and **(b) counter class**
(session-coverage vs. raw invocation count) — the two counters disagree on
axis (a). `cliBtwUseCount` only grows; it never resets with the 30-day
window the Memory Execution ratio's denominator uses. Blending it into the
numerator meant the "ever adopted `/btw`" predicate and the windowed ratio
were silently sharing a field, and the ratio's apparent numerator drifted
upward with account age rather than with recent behavior — the account
looks more "adopted" every month even with zero `/btw` calls in the current
window.

This is the same failure shape CLAUDE.md documents for v0.9.18: a fungible
`sum`/`max` across fields that differ in time-window or counter-class,
which the project's hard rules call out as the thing to check *before*
writing the aggregation, not after a ratio exceeds expectations in
production.

## The fix

`scripts/run-assessment.mjs` (`buildSignalsSummary`) now keeps the two
counters on separate fields:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

- `btwCommandUses` stays exactly what its neighbors (`clearCommandUses`,
  `compactCommandUses`, `voiceCommandUses`, …) already are: a windowed,
  session-coverage count, safe to sit in a 30-day ratio numerator.
- `cliBtwUseCountAllTime` is the new home for the cumulative counter. The
  rubric's tip-33 "ever used `/btw`" `satisfiedWhen` predicate — a
  binary adoption check, not a ratio input — was rerouted to read this
  field instead of the blended one.
- The Memory Execution score itself doesn't change: the scorer in
  `scripts/score.mjs` already read the unblended windowed value directly,
  never the summary field. This PR fixes the *surface* (`signalsSummary`,
  which the probes page and next-action predicates consume), not the
  scorer's own math.

## Why not fix the scorer too

Because there's nothing to fix there yet — but the numerator composition
question is bigger than this one field. The tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) notes
the Memory Execution scorer's numerator was narrowed once already, from a
four-command blend (`/btw + /clear + /compact + /rewind`) down to the two
session-coverage signals (`/clear + /compact`), with `/btw` demoted to
evidence text and `/rewind` demoted to a next-action probe. That redesign
is tracked separately as **CCE-79**; this PR only closes the
`signalsSummary`-level leak so the cumulative counter can't re-enter a
windowed ratio through a different door before CCE-79 lands.

## Verification

- `scripts/__tests__/build-signals-summary.test.mjs` and
  `scripts/__tests__/signals-summary.test.mjs` assert `btwCommandUses` and
  `cliBtwUseCountAllTime` are exposed as independent fields and that
  `btwCommandUses` no longer reflects the cumulative counter.
- `app/lib/__tests__/rubric-predicates.test.ts` covers the rerouted tip-33
  predicate against `cliBtwUseCountAllTime`.
- No rubric target or scorer weight changed — this is a summary-surface and
  predicate-wiring fix, not a rescoring.

## Reference

See the CLAUDE.md entries for v0.9.18 / CCE-78 and the "Per-field semantic
categorization before adding to any numerator" hard rule for the general
pattern this bug matches, and CCE-79 for the follow-up scorer redesign.
