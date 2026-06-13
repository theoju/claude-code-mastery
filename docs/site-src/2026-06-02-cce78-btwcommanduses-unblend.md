---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78 — Unblend `btwCommandUses` from `cliBtwUseCount`

**PR:** #119 · **Released:** v0.9.18 · **Follow-up:** CCE-79

## Decision

`signalsSummary.btwCommandUses` is a **30-day windowed session-coverage
counter** only. It no longer blends with `settings.cliBtwUseCount` (a
cumulative all-time invocation count). The cumulative value is exposed on a
new field, `cliBtwUseCountAllTime`, so predicates that ask "have you ever
adopted this habit?" can read the right source without touching the ratio
numerator.

## Context: two semantic axes that must stay separate

Every counter field belongs on two independent axes before you route it into
any numerator:

| Axis              | Classes                                               |
|-------------------|-------------------------------------------------------|
| (a) Time window   | **windowed** (e.g. 30-day) · **cumulative** (lifetime)|
| (b) Counter class | **session-coverage** (deduped per session) · **raw invocation count** |

`btwCommandUses` is windowed session-coverage — it counts distinct sessions
in the scoring window that fired `/btw`. `settings.cliBtwUseCount` is
cumulative raw invocation count — it grows monotonically with account age
regardless of recent posture. Blending them with `Math.max` conflated both
axes simultaneously.

## What was wrong

The v0.9.15 cycle introduced this line in `buildSignalsSummary`
(`scripts/run-assessment.mjs:134–137` at the time):

```js
// Before CCE-78 (do not reintroduce)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),
  signals.settings?.cliBtwUseCount ?? 0,
),
```

The intent was predicate ergonomics — the `btw-side-channel` predicate
(`btwCommandUses>=1`) needed to return `true` if the user had ever used `/btw`,
even when recent windowed sessions showed zero uses. The `Math.max` achieved
that, but at the cost of letting a large cumulative `cliBtwUseCount` (e.g. 36)
flood into what was supposed to be a 30-day windowed field.

Any Execution scorer that consumed `btwCommandUses` from `signalsSummary`
would silently produce a ratio that drifted upward with account age, not with
recent behavior.

## What changed

After CCE-78, `buildSignalsSummary` maps the two sources independently:

```js
// CCE-78: btwCommandUses is 30-day windowed session-coverage only. The
// cumulative all-time counter (settings.cliBtwUseCount) is exposed
// separately as cliBtwUseCountAllTime to keep predicates that want
// "have you ever adopted this habit" semantics working without
// corrupting the ratio numerator in any windowed Execution scorer.
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

The `btw-side-channel` predicate (Boris tips 33 and 54) was rerouted from
`btwCommandUses>=1` to `cliBtwUseCountAllTime>=1`. The habit-adoption
semantic correctly reads from the cumulative source; the windowed field is
kept clean for any ratio consumer.

**Memory Execution score:** unchanged by design. The scorer body already
called `maxProbe()` directly against the raw signals, bypassing the corrupted
`signalsSummary` surface entirely. No retuning needed.

## Catalog impact

Two counts bumped in `app/data/probe-catalog.json` and the probe tracker:

| Counter | Before | After |
|---------|--------|-------|
| Catalog-backed probes | 47 | 48 |
| `buildSignalsSummary` keys | 71 | 72 |

The new `cliBtwUseCountAllTime` entry appears as a `runtime`-source catalog
probe. Its `satisfiedWhen` predicate (`cliBtwUseCountAllTime>=1`) is the
canonical "btw habit adopted" gate for tips 33 and 54.

## Tests

`scripts/__tests__/signals-summary.test.mjs` adds three assertions to
enforce the split permanently:

1. `btwCommandUses` takes the MAX of transcript and history counters only —
   never `cliBtwUseCount`.
2. `cliBtwUseCountAllTime` is exposed separately and reflects the cumulative
   settings value.
3. `cliBtwUseCountAllTime` defaults to `0` when `settings.cliBtwUseCount` is
   absent.

The sweep guard in `app/lib/__tests__/rubric-predicates.test.ts` was updated
with `cliBtwUseCountAllTime: 1` in the all-satisfied fixture so the new
predicate resolves correctly.

## Rule

The CLAUDE.md hard rule "Never blend cumulative all-time counters into
windowed ratio surfaces" was codified from this incident. The full
per-field classification table and the two semantic axes are documented there
under **"Per-field semantic categorization before adding to any numerator."**
Apply the same classification checklist before adding any new field to a
ratio numerator.

## Follow-up: CCE-79

The deeper issue — the Memory Execution numerator summing multiple
commands (`/btw + /clear + /compact + /rewind`) despite each belonging
to a different counter class — is addressed separately in **CCE-79**.
That redesign restricts the numerator to the two session-coverage signals
(`/clear + /compact`), surfaces `/btw` as evidence text via
`cliBtwUseCountAllTime`, and recalibrates the rubric target from 92 → 60
to match the narrower realistic ceiling. CCE-78 is a prerequisite: it cleans
the surface that CCE-79 then reads correctly.
