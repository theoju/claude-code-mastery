---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Unblend `/btw` usage count from Memory Execution scoring (CCE-78)

PR #119 stops the Memory Execution scorer from blending a cumulative
all-time `/btw` invocation count into a 30-day windowed ratio numerator.
`signalsSummary.btwCommandUses` is now purely the windowed signal; the
cumulative count moved to its own field, `cliBtwUseCountAllTime`.

## What was wrong

`scripts/run-assessment.mjs::buildSignalsSummary` used to feed
`btwCommandUses` from a `Math.max()` blend of two sources that look
interchangeable but aren't:

- a transcript/history-derived count, scoped to the scorer's 30-day
  `--insights-lookback` window and deduplicated per session
  (session-coverage semantics), and
- `settings.cliBtwUseCount`, a lifetime invocation counter read from
  `~/.claude.json` with no window at all.

`Math.max`-ing a cumulative counter into a windowed numerator means the
numerator can only ever go up — it never reflects a quiet recent stretch,
and the Memory Execution score drifts upward simply as the account ages,
independent of whether `/btw` was actually used in the scoring window.
That's the CCE-78 finding.

## What changed

`buildSignalsSummary` now keeps the two sources on separate fields:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` no longer touches `cliBtwUseCount` at all — it's the
plain `maxProbe()` read (transcript scan reconciled against
`history.jsonl`, same pattern as `/clear`, `/compact`, and the other
posture commands), scoped to whatever `--insights-lookback` window the
run used.

The Boris tip-33 next-action predicate (`/btw` adoption) was rerouted from
`btwCommandUses` to `cliBtwUseCountAllTime`. Tip 33 is a "have you ever
used this" adoption check, not a recent-posture ratio, so the cumulative
field is the correct source for it — and rerouting it is what keeps that
check working now that `btwCommandUses` no longer carries the cumulative
count. Both fields are asserted in the rubric-predicate sweep
(`app/lib/__tests__/rubric-predicates.test.ts`), which walks every
`satisfiedWhen` in `app/data/rubric.json` against a fixture that sets
`btwCommandUses` and `cliBtwUseCountAllTime` independently.

## Why this is the general pattern, not a one-off

This is the reference case for the "per-field semantic categorization"
rule now codified in `CLAUDE.md`: before summing or `Math.max`-ing a field
into a ratio numerator, classify it on two independent axes —

| Axis              | Classes                                                |
| ----------------- | ------------------------------------------------------- |
| (a) Time window   | windowed (e.g. 30-day) vs. cumulative (lifetime)         |
| (b) Counter class | session-coverage (deduped per session) vs. raw invocation count |

`cliBtwUseCount` was cumulative + raw-invocation; `btwCommandUses`'s other
inputs were windowed + session-coverage. Different class on both axes —
they never belonged in the same `Math.max`. When a new field's
classification doesn't match the numerator it's about to join, route it
to its own surface instead: a separate cumulative field (this fix), a
binary adoption predicate, or a separate ratio with a matched denominator.

## Follow-up

The Memory Execution numerator itself still sums `/btw`, `/clear`,
`/compact`, and `/rewind` — a mix of classes beyond just this one field.
Splitting that sum by the same per-field semantics is tracked separately
as CCE-79; this PR only closes the `/btw` cumulative-vs-windowed leak.
