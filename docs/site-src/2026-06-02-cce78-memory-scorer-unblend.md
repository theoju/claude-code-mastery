---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: Memory Execution Scorer — Unblend `btwCommandUses`

**Date:** 2026-06-02  
**PR:** [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)  
**Status:** Merged

## Problem

`signalsSummary.btwCommandUses` was carrying two semantically incompatible counter types blended into a single field via `Math.max`:

| Counter | Time window | Counter class |
| --- | --- | --- |
| `~/.claude.json#btwUseCount` | Cumulative (all-time) | Raw invocation count |
| Transcript/history signal | 30-day windowed | Per-session coverage |

The blend was introduced in v0.9.15 for predicate ergonomics: one field could serve both the Memory Execution ratio numerator and the tip-33 `>=1` adoption probe. It was convenient but wrong.

**The failure mode:** the cumulative `btwUseCount` only ever grows. In any 30-day window where real `/btw` usage was lower than the all-time total, `Math.max` would silently inflate the numerator — making Memory Execution drift upward with account age rather than reflecting recent posture. A user who used `/btw` heavily a year ago and stopped completely would still score full credit.

This violates the **per-field semantic categorization rule** in CLAUDE.md: a ratio numerator that shares a denominator with a 30-day windowed signal must itself be windowed. Mixing cumulative counters into the numerator corrupts the ratio's meaning.

## Decision

Unblend the two counters into separate fields with distinct surfaces:

- **`btwCommandUses`** — windowed session-coverage signal only. This is what feeds the Memory Execution ratio numerator. Reflects actual `/btw` usage in the current scoring window.
- **`cliBtwUseCountAllTime`** — cumulative lifetime invocation count from `~/.claude.json#btwUseCount`. Exposed as evidence text on the dimension drilldown; never enters a windowed ratio numerator.

The tip-33 predicate (`>=1` habit-adoption check) is rerouted to `cliBtwUseCountAllTime`. An adoption probe is a binary "have you ever done this" question — the cumulative field is the right answer source. The ratio scorer stays on the windowed field.

## Why the original blend seemed safe

The `Math.max` form was designed to handle a gap: transcript scanning might miss invocations that the runtime counter captured. But it conflates two independent axes:

1. **Time window** — windowed vs. cumulative. These should never merge into a ratio numerator.
2. **Counter class** — per-session-coverage (deduplicated per session) vs. raw invocation count. These count different things.

A blend that looks like "take whichever is higher" is actually "silently override a windowed ratio with a cumulative total whenever the account is old enough." The ergonomic benefit (one field, one probe) doesn't justify that corruption.

## What changed in PR #119

- `scripts/run-assessment.mjs` — removes the `Math.max` blend at lines 134–137; `btwCommandUses` is assigned the windowed transcript/history value only; `cliBtwUseCountAllTime` is assigned `btwUseCount` from `~/.claude.json` directly.
- `scripts/insights-signals.mjs` / `scripts/_usage-data.mjs` — `btwCommandUses` definition restricted to windowed session-coverage.
- `app/data/probe-catalog.json` — `cliBtwUseCountAllTime` added as a new catalog entry with `source: runtime`.
- `app/data/rubric.json` — tip-33 `satisfiedWhen` predicate updated from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — tracker updated in-PR (per CLAUDE.md convention: probe changes update the tracker in the same PR).
- Tests updated to reflect the two-field contract.

## Follow-up: CCE-79

CCE-78 fixes the blend but leaves a broader issue: the Memory Execution numerator still sums `/btw + /clear + /compact + /rewind`, which puts three counter classes in one sum. CCE-79 (filed separately) restricts the numerator to the two genuine session-coverage signals (`/clear + /compact`), surfaces `/btw` as cumulative evidence text, keeps `/rewind` as a next-action probe only, and recalibrates the rubric target from 92 to 60 to match the narrowed realistic ceiling.

## Rule this enforces

> **Don't blend cumulative all-time counters into windowed ratio surfaces.** Numerator counters that share a ratio with a 30-day windowed denominator must also be 30-day windowed. Keep cumulative sources on separate `signalsSummary` fields and route habit-only predicates at the cumulative field.

This is now codified in `CLAUDE.md` (§Hard rules) as the canonical pattern: `cliBtwUseCountAllTime` for `cliBtwUseCount` is the reference implementation.
