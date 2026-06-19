---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Memory Execution scorer — remove the `/btw` cumulative blend

**PR #119 · v0.9.18**

## The bug

`scripts/run-assessment.mjs` was blending two signals of incompatible types into
a single `signalsSummary` field:

```js
// Before CCE-78 (simplified):
btwCommandUses: Math.max(maxProbe(signals, "btwCommandUses"), signals.settings?.cliBtwUseCount ?? 0),
```

`btwCommandUses` (from `maxProbe`) is a **30-day windowed session-coverage**
counter — how many distinct sessions in the lookback window included a `/btw`
invocation. `signals.settings.cliBtwUseCount` is a **cumulative all-time
invocation count** maintained by Claude Code in `~/.claude.json`. They are
different animals on two independent axes:

| Axis              | `btwCommandUses` (probe)   | `cliBtwUseCount` (settings) |
| ----------------- | -------------------------- | --------------------------- |
| (a) Time window   | 30-day windowed            | Cumulative all-time         |
| (b) Counter class | Session-coverage (deduped) | Raw invocation count        |

Taking `Math.max` of these silently promoted the cumulative counter into the
ratio numerator of the Memory Execution scorer, which divides by a
30-day-windowed denominator. The result: any account that had historically used
`/btw` — even with zero usage in the current window — reported inflated Memory
Execution scores. Scores drifted upward with account age, not with recent
practice.

## The fix

PR #119 makes three surgical changes:

1. **Remove the blend.** `btwCommandUses` now comes from `maxProbe` only —
   30-day windowed, session-coverage semantics, no cumulative contamination:

   ```js
   // scripts/run-assessment.mjs (CCE-78)
   btwCommandUses: maxProbe(signals, "btwCommandUses"),
   cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
   ```

2. **Expose `cliBtwUseCountAllTime` as its own field.** Predicates that want
   "have you ever adopted this habit" semantics — specifically Tip 33's
   `satisfiedWhen` predicate — now target this field directly:

   ```
   cliBtwUseCountAllTime >= 1
   ```

   That is the right shape for an adoption probe: it answers "has this habit
   been established at all?" and the cumulative counter is exactly what you
   want for that question.

3. **Update `probe-catalog.json` and tracker counts.** `cliBtwUseCountAllTime`
   gets its own catalog entry under the `runtime` source category (alongside
   `coworkDispatchAdopted` and `opus47AwarenessAdopted`) with the blending
   prohibition stated explicitly in its description.

The three CI tests added in `scripts/__tests__/signals-summary.test.mjs` nail
the contract:

- `btwCommandUses` is the transcript+history MAX only — the cumulative
  `cliBtwUseCount: 36` setting does not bleed in when windowed usage is 5.
- With zero windowed usage and `cliBtwUseCount: 36`, `btwCommandUses` stays 0
  and `cliBtwUseCountAllTime` is 36.
- When `settings.cliBtwUseCount` is absent, `cliBtwUseCountAllTime` defaults to 0.

## The two-axis taxonomy

This bug is an instance of a broader classification problem. Before adding any
field to a ratio numerator — or summing multiple fields into one — classify each
field on both axes:

| Axis              | Classes                                                        |
| ----------------- | -------------------------------------------------------------- |
| (a) Time window   | windowed (e.g. 30-day) / cumulative (lifetime)                 |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count  |

If a candidate field's class on either axis differs from the existing numerator
inputs, it doesn't belong in the same sum. Route it to the appropriate surface
instead:

| Where it belongs                | When to use                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Ratio numerator                 | Same time window, same counter class as denominator                          |
| Cumulative evidence text        | All-time counters — display as "N all-time uses" in the scorer output        |
| Separate binary predicate       | Adoption checks ("has the user ever done X?") — target `cumulative >= 1`     |
| Separate ratio with matched denom | Windowed but different counter class — needs its own denominator universe |

The `Math.max` pattern looks ergonomic but conflates both axes. It silently
promotes a cumulative field into a windowed ratio surface on any run where the
cumulative count exceeds the windowed count — which is guaranteed for any
long-running account with historical usage and low recent activity.

## Reference for CCE-79

CCE-78 exposed `cliBtwUseCountAllTime` to preserve predicate ergonomics. The
Memory Execution scorer itself still carried `/btw` session-coverage in its
ratio numerator through CCE-79, where the numerator was narrowed further to
`/clear + /compact` only (the two genuine windowed session-coverage signals for
memory management), the rubric target was recalibrated 92 → 60, and
`cliBtwUseCountAllTime` was routed to cumulative evidence text in the scorer
output rather than the ratio.

CCE-78 is the precedent: **separate cumulative fields before blending, then let
the scorer decide which surface to put them on**. CCE-79 completed that
routing. The two-axis table above is the shared reference; the spec for CCE-79
is at
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.

## Files changed

| File | Change |
| ---- | ------ |
| `scripts/run-assessment.mjs` | Removed `Math.max` blend; added `cliBtwUseCountAllTime` projection from `signals.settings.cliBtwUseCount` |
| `app/data/probe-catalog.json` | Added `cliBtwUseCountAllTime` entry (source: `runtime`); updated `btwCommandUses` description with CCE-78 note |
| `scripts/__tests__/signals-summary.test.mjs` | Three assertions locking the separation contract |
| Probe tracker | Counts updated (48 probes, 72 `signalsSummary` keys) |
