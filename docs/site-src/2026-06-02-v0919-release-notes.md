---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 Release Notes

**Released:** 2026-06-02  
**PRs:** #118, #119, #120 (bundled into the version bump)  
**Breaking:** No

## What shipped

v0.9.19 bundles two changes landed in PRs #118 and #119:

1. **CCE-78 — scoring honesty fix for `btwCommandUses`** (PR #119): separates the cumulative all-time `/btw` invocation count from the 30-day windowed session-coverage metric.
2. **Plans housekeeping** (PR #118): archives completed plans for CCE-72 and CCE-76 out of `plans/`, and adds a new hard rule to CLAUDE.md on cumulative-vs-windowed counter semantics.

---

## CCE-78: `btwCommandUses` split

### The bug

`signalsSummary.btwCommandUses` was computed via `Math.max(btwCommandUses_windowed, cliBtwUseCountAllTime)` — blending a 30-day windowed session-coverage counter with a lifetime invocation count pulled from `~/.claude.json`. For a user who had run `/btw` hundreds of times historically but rarely in the past 30 days, that blend silently inflated `btwCommandUses` to the all-time ceiling, overstating recent Memory Execution coverage.

The two fields differ on both semantic axes:

| Field | Time window | Counter class |
|---|---|---|
| `btwCommandUses` (pre-fix) | 30-day | session-coverage (deduped per session) |
| `cliBtwUseCountAllTime` (new) | cumulative / lifetime | raw invocation count |

Blending them conflates both axes and produces a ratio that drifts up with account age rather than reflecting recent posture.

### The fix

- `signalsSummary.btwCommandUses` now contains only the 30-day windowed session-coverage count — no Math.max blend.
- A new additive field `signalsSummary.cliBtwUseCountAllTime` exposes the cumulative count from `~/.claude.json`.
- The `btw-side-channel` predicate (tips 33 and 54) is rerouted to read from `cliBtwUseCountAllTime`. This is appropriate: those predicates are habit-adoption checks (`>= 1`), not ratio inputs, so the cumulative field is the right signal.
- The Memory Execution ratio numerator no longer touches `btwCommandUses`, so the scorer result is honest for all window sizes.

### Impact on existing users

For most users — those with consistent recent `/btw` usage — the Memory Execution score is unchanged. If you had high historical `/btw` usage but low recent usage, you may see a lower `btwCommandUses` value post-upgrade. That's the correct reading: the dimension now measures what you've done in the last 30 days.

Third-party consumers of `signalsSummary.btwCommandUses` should expect this narrowing. The new `cliBtwUseCountAllTime` field is available if you need the lifetime signal.

---

## Plans housekeeping

Completed plans for **CCE-72** (ship-journal stage counters) and **CCE-76** (all-twelve-dimension Execution scorers) are archived out of `docs/superpowers/plans/` into `docs/superpowers/plans/archived/`. Both shipped in earlier PRs; the archive follows the convention that completed plans don't stay in the live plans directory.

---

## New CLAUDE.md hard rule

A new **"Per-field semantic categorization before adding to any numerator"** rule is now documented in CLAUDE.md. The rule requires classifying every field on two independent axes — `(a) time window` (windowed vs. cumulative) and `(b) counter class` (session-coverage vs. raw invocation count) — before summing fields into a ratio numerator. Fields that differ on either axis belong on separate surfaces. CCE-78 is the reference case for this rule.

---

## Follow-up: CCE-79

CCE-78 fixes the immediate honesty bug but doesn't fully redesign the Memory Execution scorer. **CCE-79** is filed to apply per-field semantic categorization across all Memory Execution numerator inputs. The current numerator (`/clear + /compact + /btw + /rewind`) mixes at least three semantic classes. The redesign will restrict the numerator to the two genuine session-coverage signals (`/clear + /compact`), surface `/btw` as cumulative evidence text, keep `/rewind` as a next-action probe only, and recalibrate the rubric target to match the narrowed realistic ceiling. CCE-79 is not in this release.
