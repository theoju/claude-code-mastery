---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
---

# CCE-78 — Unblend the `/btw` counter

PR #119 removes a silent data-quality bug in `signalsSummary.btwCommandUses`
that caused the Memory Execution scorer's numerator to drift upward with
account age rather than reflecting your recent posture.

## What was wrong

`signalsSummary.btwCommandUses` was constructed with a `Math.max` blend:

```js
btwCommandUses: Math.max(windowedSessionCoverage, cliJson.btwUseCount)
```

That one line conflated two independent semantic axes:

| Axis | `windowedSessionCoverage` | `cliJson.btwUseCount` |
|------|---------------------------|------------------------|
| (a) Time window | 30-day windowed | Cumulative all-time |
| (b) Counter class | Per-session deduped coverage | Raw invocation count |

The blend was introduced as a predicate ergonomic during the v0.9.15
runtime-adoption-probes cycle — making `btwCommandUses >= 1` true even
when no recent transcripts were scanned. That goal was reasonable, but the
implementation routed the cumulative all-time invocation count into the
same field that fed the 30-day session-coverage numerator. As your account
aged, `btwUseCount` grew without bound and silently inflated the Memory
Execution ratio.

## The fix

Two changes, each touching a different semantic layer:

**1. Separate the cumulative source into its own field.**

`signalsSummary` now exposes `cliBtwUseCountAllTime` (carrying the raw
lifetime invocation count from `~/.claude.json`) alongside the unchanged
`btwCommandUses` (which now contains only the 30-day windowed session-coverage
count, unblended).

**2. Reroute the rubric predicate.**

The `btw-side-channel` next-action (Boris tips 33 and 54) predicate was
`btwCommandUses >= 1`. That matched "have you ever adopted this habit" — a
binary, cumulative question — but it was reading from a windowed field. The
predicate now reads `cliBtwUseCountAllTime >= 1`, which matches the semantic
correctly regardless of whether recent transcripts were scanned.

## Effect on scores

The Memory Execution score is **intentionally unchanged** — it was `16`,
it stays `16`. The bug inflated `btwCommandUses` in `signalsSummary` but
the scorer's own numerator logic was already bounded by the realistic
session-coverage ceiling. What is restored is the honesty of the
`signalsSummary` surface: the field now contains what its name says.

Probe catalog and `signalsSummary` counts advanced:

| Counter | Before | After |
|---------|--------|-------|
| Probe catalog entries | 47 | 48 |
| `signalsSummary` keys | 71 | 72 |

## New hard rule

A new hard rule in `CLAUDE.md` codifies the two-axis classification
requirement for all future scorer authors:

> **Per-field semantic categorization before adding to any numerator.**
> Classify each field on (a) time window (windowed vs. cumulative) and
> (b) counter class (session-coverage vs. raw invocation count) BEFORE
> writing the sum. If the new field differs from existing numerator inputs
> on either axis, it doesn't belong in the same sum.

The canonical reference case is this PR. The deeper Memory Execution
scorer redesign — replacing the fungible sum with per-field semantics
across all four context-management commands — is tracked as **CCE-79**.

## Related

- **CCE-79** — Memory Execution scorer per-field redesign (follow-up;
  not yet shipped). Will restrict the numerator to the two genuine
  session-coverage signals (`/clear + /compact`), surface `/btw` as
  cumulative evidence text, and recalibrate the rubric target.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` —
  probe registry updated in this PR (required by the probe-tracker
  convention).
- `scripts/insights-signals.mjs` — where `cliBtwUseCountAllTime` is now
  exposed separately from `btwCommandUses`.
