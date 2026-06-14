---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 — Scoring Honesty Fix (CCE-78)

**Released:** 2026-06-02 · **Breaking changes:** none

v0.9.19 is a bugfix release that corrects a silent scoring inflation in the
Memory & Context Management Execution scorer, archives two completed plan
documents, and codifies the cumulative-vs-windowed counter contract as an
enforced project rule.

## What was wrong

`signalsSummary.btwCommandUses` is a **30-day windowed, session-coverage** counter:
it counts how many sessions in the last 30 days included at least one `/btw`
invocation. That's the right denominator term for a posture ratio — "how often
does the user actually do the thing recently."

Before v0.9.19, `run-assessment.mjs` blended the cumulative all-time
`~/.claude.json#btwUseCount` counter into `btwCommandUses` via `Math.max`:

```js
// v0.9.18 (removed)
btwCommandUses: Math.max(signalsSummary.btwCommandUses, cliJson.btwUseCount ?? 0)
```

This made `btwCommandUses` silently inherit the all-time invocation total
whenever it exceeded the 30-day session count. For users with high historical
`/btw` adoption, the 30-day windowed ratio drifted upward with account age
rather than reflecting actual recent posture — the textbook failure mode for
mixing cumulative and windowed counters into the same numerator.

## The fix (PR #119 / CCE-78)

Three coordinated changes:

1. **Removed the Math.max blend.** `btwCommandUses` now reflects only the
   30-day windowed session-coverage count, as intended.

2. **Exposed the cumulative counter separately.** `~/.claude.json#btwUseCount`
   is now surfaced as `signalsSummary.cliBtwUseCountAllTime` — a clearly-named
   field that downstream consumers can route to binary adoption checks
   (`>= 1`) without corrupting ratio numerators.

3. **Rerouted the tip-33/54 predicate.** The `btw-side-channel` rubric
   predicate, which gates the "have you used `/btw` at all?" next-action, is
   now evaluated against `cliBtwUseCountAllTime` rather than `btwCommandUses`.
   The predicate was always asking a binary adoption question (ever used it?),
   not a windowed coverage question, so the cumulative field is semantically
   correct there.

No rubric targets or weights changed. No user-visible scores change for users
with consistent recent `/btw` usage. Users whose score was inflated by the
cumulative blend will see a corrected (lower) Memory Execution ratio.

## New hard rule

The fix is documented as a permanent project rule in `CLAUDE.md`:

> **Don't blend cumulative all-time counters into windowed ratio surfaces.**
> Numerator counters that share a ratio with a 30-day windowed denominator
> must also be 30-day windowed. Route cumulative counters to a separate
> `signalsSummary` field and use them only for binary adoption predicates
> (`>= 1` checks) or evidence text.

The rule also names the two semantic axes to verify before adding any field
to a ratio numerator: **(a) time window** (windowed vs. cumulative) and
**(b) counter class** (per-session-coverage vs. raw invocation count). A
field that differs on either axis from the existing numerator inputs doesn't
belong in the same sum.

## Plan archival (PR #118)

PR #118 moves the completed CCE-72 and CCE-76 plan documents from
`docs/superpowers/plans/` to `docs/superpowers/plans/archived/`. Both plans
shipped in v0.9.18; archival is routine housekeeping to keep the active plans
directory scoped to in-flight work.

## Follow-up: CCE-79

The `/btw` blend was symptomatic of a broader issue: the Memory Execution
scorer's numerator originally summed `/btw + /clear + /compact + /rewind` even
though those fields span three different (time window, counter class) profiles.
CCE-79 is filed for a full Memory Execution scorer redesign that restricts the
numerator to the two session-coverage signals (`/clear + /compact`), surfaces
`/btw` as cumulative evidence text, keeps `/rewind` only as a next-action
probe, and recalibrates the rubric target from 92 to 60 to match the narrowed
realistic ceiling.

That redesign is separate work. v0.9.19 fixes the most acute correctness
violation without waiting for the full redesign.
