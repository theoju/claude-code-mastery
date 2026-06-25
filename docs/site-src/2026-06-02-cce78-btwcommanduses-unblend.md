---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Unblend `btwCommandUses` from the cumulative all-time counter

**PR #119 · 2026-06-02 · non-breaking**

## Problem

Since the v0.9.15 cycle, `buildSignalsSummary` in `scripts/run-assessment.mjs`
blended the cumulative all-time `~/.claude.json` counter `cliBtwUseCount` into
the 30-day windowed session-coverage counter `btwCommandUses` via a `Math.max`:

```js
// pre-CCE-78 (removed)
btwCommandUses: Math.max(
  maxProbe(signals, "btwCommandUses"),
  signals.settings?.cliBtwUseCount ?? 0
),
```

The comment said this was for "predicate ergonomics" — the `btw-side-channel`
predicate (`btwCommandUses >= 1`) needed to fire even when the transcript
scanner missed a `/btw` invocation. The fix was well-intentioned but silently
conflated two independent semantic axes:

| Axis | `btwCommandUses` (transcript) | `cliBtwUseCount` (`~/.claude.json`) |
|---|---|---|
| **(a) Time window** | 30-day windowed | Cumulative all-time |
| **(b) Counter class** | Per-session-coverage (deduped per session) | Raw invocation count |

The `Math.max` made `btwCommandUses` grow monotonically with account age
regardless of recent behaviour — a user who used `/btw` 50 times two years
ago and zero times this month would show `btwCommandUses = 50` in
`signalsSummary`. The surface was dishonest even though the Memory Execution
scorer's actual ratio happened to bypass the corrupted field and was
unaffected (score stayed at 16).

## Decision

**Expose the two sources as separate fields with matched denominators.**

1. `btwCommandUses` now maps only to the 30-day transcript signal
   (`maxProbe(signals, "btwCommandUses")`). Its semantics are purely
   windowed session-coverage.
2. A new `cliBtwUseCountAllTime` field carries the raw cumulative
   `settings.cliBtwUseCount` lifetime counter. It is labeled _all-time_ in
   both the key name and the surrounding comment so future readers know its
   time-window class without grepping.
3. The `btw-side-channel` predicate for Boris tips 33 and 54 is rerouted
   from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. Adoption-habit
   checks ("have you ever used this?") belong on a cumulative source; ratio
   numerators belong on a windowed one.

## What changed

| Location | Before | After |
|---|---|---|
| `run-assessment.mjs` `buildSignalsSummary` | `btwCommandUses: Math.max(maxProbe(…), cliBtwUseCount)` | `btwCommandUses: maxProbe(…)` |
| `run-assessment.mjs` `buildSignalsSummary` | _(field absent)_ | `cliBtwUseCountAllTime: signals.settings?.cliBtwUseCount ?? 0` |
| Rubric predicate (tips 33, 54) | `btwCommandUses >= 1` | `cliBtwUseCountAllTime >= 1` |
| `signalsSummary` key count | 71 | 72 |
| Probe catalog count | 47 | 48 |
| Memory Execution score | 16 | 16 (unchanged) |

The probe-implementation-status tracker was updated in the same PR.

## Guard rails added

A hard rule was added to `CLAUDE.md` codifying the **two-axis classification
requirement** for any future scorer numerator addition:

> Before adding a field to a ratio numerator, classify it on (a) time window
> (windowed vs. cumulative) and (b) counter class (session-coverage vs. raw
> invocation count). If the new field's class on either axis differs from
> existing inputs, it doesn't belong in the same sum.

This prevents the same blend pattern from re-appearing under a different
field name.

## What this does NOT change

The deeper redesign of the Memory Execution numerator — moving from a
fungible sum of commands to per-field semantic categorization — is deferred
to **CCE-79**. The CCE-78 change restores surface integrity of
`signalsSummary` and adds a structural guard; it does not revisit how the
Memory Execution ratio itself weighs `/clear`, `/compact`, `/rewind`, and
`/btw`.

## Reference

- PR: [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)
- Spec for the deeper redesign: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- CLAUDE.md hard rule: "Per-field semantic categorization before adding to any numerator"
