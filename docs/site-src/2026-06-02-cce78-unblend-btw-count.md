---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblend the `/btw` count out of `btwCommandUses`

## Context

`buildSignalsSummary()` (`scripts/run-assessment.mjs`) is the flat scalar
projection that every rubric `satisfiedWhen` predicate reads. Its slash-command
counters generally take a `Math.max` across transcript scanning and
`history.jsonl` scanning (via `maxProbe`) — a deliberate design so the
assessment "cannot regress below transcript-only behavior, only recover
signal the JSONL scanner misses" (see the comment at
`scripts/run-assessment.mjs:113-120`).

`btwCommandUses` originally went one step further: it also `Math.max`'d in
`signals.settings.cliBtwUseCount` — a **cumulative, all-time** invocation
counter read from `~/.claude.json`, added for predicate ergonomics during the
v0.9.15 runtime-adoption-probes cycle. That's a different kind of number from
the rest of the blend. `btwCommandUses` feeds the Memory Execution scorer's
numerator, and that numerator is windowed to the same 30-day
`--insights-lookback` as its denominator. Blending a lifetime counter into a
30-day ratio's numerator means the ratio drifts upward with account age, not
with recent posture — exactly the failure mode the CLAUDE.md hard rule "Don't
blend cumulative all-time counters into windowed ratio surfaces" now names
directly.

CCE-78 traced this: `cliBtwUseCount` is a **cumulative** counter, and it's a
**raw invocation count**, not a deduped-per-session coverage count. Every
other field feeding `btwCommandUses` (via `maxProbe`) is **windowed** and
**session-coverage**. Two axes, both mismatched — the blend didn't belong in
that `sum`.

Worth noting: `scripts/score.mjs` never read the blended field directly, so
the Memory Execution *score* itself didn't move. What was corrupted is the
`signalsSummary` surface — the thing every predicate, probe description, and
next-action evidence string is grounded in. A wrong number sitting quietly in
`assessment.json.signalsSummary` is still a wrong number.

## Decision

Split the two semantics into two fields:

- **`btwCommandUses`** stays windowed session-coverage only —
  `maxProbe(signals, "btwCommandUses")`, i.e. `Math.max` across transcript and
  `history.jsonl` scanning, nothing else. This is what feeds any windowed
  Execution ratio.
- **`cliBtwUseCountAllTime`** is new: `signals.settings?.cliBtwUseCount ?? 0`,
  forwarded verbatim. Cumulative, all-time, exactly what the field always
  was — just no longer disguised as a windowed count.

The rubric's `/btw` side-channel predicate (Boris tip 33/54 — "have you ever
used `/btw`") was rerouted from `btwCommandUses` to
`cliBtwUseCountAllTime`, since "have you ever adopted this habit" is exactly
the cumulative semantics the field now honestly carries. Any future windowed
ratio that wants `/btw` coverage reads `btwCommandUses`; any adoption-style
"ever used it" predicate reads `cliBtwUseCountAllTime`.

```js
// scripts/run-assessment.mjs — buildSignalsSummary()
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`cliBtwUseCountAllTime` is now part of the locked `buildSignalsSummary`
key-contract test
(`scripts/__tests__/build-signals-summary.test.mjs` — the inline snapshot of
sorted output keys), so a future accidental removal or re-blend fails CI
immediately.

## The general rule this cycle produced

CCE-78 wasn't just a one-field fix — it's now a standing CLAUDE.md hard rule,
checked before adding to *any* numerator: classify every candidate field on
two independent axes before summing it into a ratio.

| Axis | Possible classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

If a new field's class differs from the existing numerator inputs on either
axis, it doesn't belong in the same `sum` — route it to a separate surface
instead: evidence text (cumulative), a separate binary predicate, or a
separate ratio with a matched denominator. CCE-79, tracked separately, applies
this same table to the rest of the Memory Execution numerator (`/clear`,
`/compact`, `/rewind`) — this PR only closed the `/btw` half.

## Consequences

- `signalsSummary.btwCommandUses` now reflects only what happened in the
  scoring window; `signalsSummary.cliBtwUseCountAllTime` is the honest
  cumulative number.
- The Memory Execution score is unchanged by this PR — `score.mjs` never
  consumed the blended field — but the `signalsSummary`/probe/evidence layer
  that engineers actually read is now accurate.
- The probe-implementation-status tracker and `buildSignalsSummary` test
  fixtures were updated in the same PR, per the "keep the probe tracker in
  sync" house rule.
