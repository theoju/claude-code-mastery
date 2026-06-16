---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Counter Semantics Fix — `btwCommandUses` / `cliBtwUseCountAllTime` Split

**Decision date:** 2026-06-02  
**PR:** [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)  
**Status:** Shipped in v0.9.18

---

## Context

Every field in `signalsSummary` sits on two independent axes:

| Axis | Classes |
|------|---------|
| **(a) Time window** | windowed (30-day session coverage) vs cumulative (lifetime all-time) |
| **(b) Counter class** | session-coverage (deduped per session) vs raw invocation count |

`btwCommandUses` is a **30-day windowed, session-coverage** field — it counts
how many sessions in the last N days included a `/btw` invocation, and it
feeds the Memory Execution ratio alongside the `/clear` and `/compact`
session-coverage counters.

`~/.claude.json#btwUseCount` is a **cumulative all-time, raw invocation count**
— it grows monotonically with account age regardless of the scoring window.

## Problem

During the v0.9.15 runtime-adoption-probes cycle, a `Math.max` blend was
introduced at `scripts/run-assessment.mjs` (around line 134) to make tip-33
predicates easier to author:

```js
// BEFORE (corrupted — do not re-introduce)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),   // windowed session-coverage
  signals.settings?.cliBtwUseCount ?? 0  // cumulative all-time count
),
```

The ergonomic intent was sound — `btwCommandUses >= 1` as an "ever adopted"
habit check would read cleanly. The structural problem is that the
cumulative all-time counter **dominates** the windowed session-coverage counter
as account age grows, silently inflating the `signalsSummary.btwCommandUses`
surface to values far above realistic 30-day session counts.

Any Execution scorer that reads `btwCommandUses` from the summary as part of a
windowed ratio numerator would then divide an ever-growing cumulative value by a
30-day denominator — producing a ratio that drifts upward with account age
rather than reflecting recent posture.

## Decision

Split the two sources into separate `signalsSummary` fields, each with
unambiguous semantics:

```js
// AFTER (CCE-78)
// 30-day windowed session-coverage only — safe in Execution ratio numerators
btwCommandUses: maxProbe(signals, "btwCommandUses"),
// Cumulative all-time invocation count — for "ever adopted" habit predicates only
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The rubric predicates for Boris tips 33 and 54 (`btw-side-channel`) were
rerouted from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. The
semantics match: "have you ever used `/btw`?" is correctly answered by the
all-time counter, not by whether it appeared in the last 30 days.

## Consequences

**Memory Execution score:** unchanged (remained at 16). The Memory Execution
scorer body already called `maxProbe()` directly against the telemetry layer
and never consumed `signalsSummary.btwCommandUses` in its ratio numerator —
only the honesty of the `signalsSummary` surface was corrupted, not the
scorer's arithmetic. Verifying scorer behavior before fixing the surface
confirmed there was no silent credit inflation in the Execution radar.

**Probe tracker:** updated in-tree — probes 47 → 48, `signalsSummary` keys
71 → 72. The machine-enforced `tracker-counts.test.mjs` validates those
numbers on every CI run.

**Tests:** `scripts/__tests__/signals-summary.test.mjs` now asserts the
separation explicitly:

```js
it("btwCommandUses takes MAX of transcript and history only — NOT cliBtwUseCount (CCE-78)", () => {
  const s = makeSignals({ historyInvocations: { btwCommandUses: 5 }, settings: { cliBtwUseCount: 36 } });
  expect(buildSignalsSummary(s).btwCommandUses).toBe(5);   // not 36
});

it("exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)", () => {
  const s = makeSignals({ historyInvocations: { btwCommandUses: 0 }, settings: { cliBtwUseCount: 36 } });
  const out = buildSignalsSummary(s);
  expect(out.btwCommandUses).toBe(0);
  expect(out.cliBtwUseCountAllTime).toBe(36);
});
```

## Guardrail

A hard rule was added to `CLAUDE.md` codifying the two-axis classification
requirement. Before adding any field to a ratio numerator, classify it on both
axes. If the new field's class differs from existing numerator inputs on either
axis, route it to a separate surface: evidence text (cumulative), a separate
binary predicate, or a ratio with a matched denominator. The corrupted
`Math.max` blend is the reference anti-pattern; `cliBtwUseCountAllTime` is
the reference fix.

## Out of scope

The deeper Memory Execution scorer redesign — narrowing the numerator to
`/clear + /compact` session-coverage only, surfacing `/btw` as evidence text,
and recalibrating the rubric target 92 → 60 — is filed as **CCE-79** and was
not part of this PR.
