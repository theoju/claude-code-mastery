---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `btwCommandUses` from its cumulative source

**PR #119 · 2026-06-02**

## Problem

`signalsSummary.btwCommandUses` was computed with a `Math.max` that merged two
semantically incompatible sources:

```js
// before CCE-78 (run-assessment.mjs)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),  // 30-day windowed session-coverage
  signals.settings?.cliBtwUseCount ?? 0 // cumulative all-time invocation count
)
```

These differ on two independent axes:

| Axis              | `maxProbe("btwCommandUses")`         | `settings.cliBtwUseCount`  |
| ----------------- | ------------------------------------ | -------------------------- |
| (a) Time window   | 30-day windowed                      | Cumulative all-time        |
| (b) Counter class | Session-coverage (deduped per session) | Raw invocation count     |

Blending them via `Math.max` meant `btwCommandUses` could only ever increase as
the account aged, regardless of whether `/btw` had been used recently. Any
Execution scorer that fed `btwCommandUses` into a ratio with a 30-day windowed
denominator would produce a ratio that drifted upward over account lifetime
instead of reflecting actual recent posture.

The Memory Execution scorer happened to use `maxProbe` directly rather than the
`signalsSummary` field, so its own ratio was unaffected. The corruption was
confined to `signalsSummary` itself — but that surface feeds the predicate
engine and any future scorer that reads the pre-computed field, so the blend was
still a correctness hazard.

The original blend was introduced during the v0.9.15 runtime-adoption-probes
plan (Boris tips 33/54) for predicate ergonomics: the tip-33 predicate
`btwCommandUses >= 1` needed to fire for users who had ever adopted `/btw`, and
the cumulative count was the reliable "ever adopted" signal. The `Math.max`
shortcut avoided adding a new field, but it silently violated the semantic
contract of the existing windowed counter.

## Fix

Split the field into two purpose-specific outputs in `buildSignalsSummary`
(`scripts/run-assessment.mjs`):

```js
// after CCE-78
btwCommandUses: maxProbe(signals, "btwCommandUses"),
cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0,
```

`btwCommandUses` is now purely 30-day windowed session-coverage — the `MAX` of
the transcript scanner and `historyInvocations`, both windowed sources. The
cumulative all-time count is exposed separately as `cliBtwUseCountAllTime` for
predicates that want "have you ever adopted this habit" semantics.

The tip-33 predicate in the rubric was rerouted from `btwCommandUses >= 1` to
`cliBtwUseCountAllTime >= 1`, matching the actual semantic: the predicate gates a
Platform Setup next-action asking whether the user has ever adopted `/btw`, not
whether they used it in the last 30 days.

## Evidence

Three tests in `scripts/__tests__/signals-summary.test.mjs` enforce the
field split:

- **"btwCommandUses takes MAX of transcript and history only — NOT
  cliBtwUseCount (CCE-78)"**: sets `historyInvocations.btwCommandUses = 5` and
  `settings.cliBtwUseCount = 36`; asserts `btwCommandUses === 5` (not 36).
- **"exposes cliBtwUseCountAllTime separately for habit predicates (CCE-78)"**:
  same inputs; asserts `cliBtwUseCountAllTime === 36`.
- **"cliBtwUseCountAllTime defaults to 0 when settings.cliBtwUseCount is
  missing"**: empty settings; asserts `cliBtwUseCountAllTime === 0`.

The key-contract snapshot in `scripts/__tests__/build-signals-summary.test.mjs`
was updated to include `cliBtwUseCountAllTime` in the locked-in sorted key list,
making a silent omission a CI failure.

## Scope

- `signalsSummary` probe count: 71 → 72 (one new field added).
- `probe-catalog.json` entry count: 47 → 48.
- No change to the Memory Execution scorer body (it already read `maxProbe`
  directly, not `signalsSummary.btwCommandUses`).
- No change to how `btwCommandUses` is _counted_ at the gathering layer
  (`scripts/_usage-data.mjs` and `scripts/insights-signals.mjs`) — only the
  `buildSignalsSummary` projection was wrong.

## Invariant going forward

Every field in `signalsSummary` that is used as a ratio numerator must come from
a single time window and a single counter class. When you need both a windowed
coverage counter and a cumulative adoption flag for the same underlying behavior,
expose them as two fields — one per semantic axis — and route each predicate to
the field that matches its actual question. The CLAUDE.md "per-field semantic
categorization" hard rule codifies this for future changes.

The deeper redesign of the Memory Execution scorer (restricting its numerator to
the two session-coverage signals `/clear` + `/compact` and retiring the
multi-class sum) is deferred to **CCE-79**.
