---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Unblend `btwCommandUses` from the all-time `/btw` counter (CCE-78)

## Context

`btwCommandUses` is the Memory Execution scorer's signal for `/btw`
adoption: a 30-day windowed, session-coverage count, MAX-merged from
`~/.claude/history.jsonl` and transcript scanning (`/btw` is a
side-channel command that rarely lands in the session JSONL, so
`history.jsonl` is the primary source — see the `btwCommandUses` entry
in `app/data/probe-catalog.json`).

Separately, `~/.claude.json` maintains `btwUseCount`, a cumulative,
all-time invocation counter that Claude Code itself updates. During the
runtime-adoption-probes work, the tip 33 predicate (`/btw` for
side-channel questions) needed *some* signal to gate on, and the
original implementation took the ergonomic shortcut of blending the two
straight into the numerator with `Math.max(maxProbe(s, "btwCommandUses"),
cliBtwUseCount)` in `scripts/run-assessment.mjs`.

That blend conflates two independent semantic axes, per the rule this
repo's CLAUDE.md now states explicitly for any numerator addition:

| Axis              | `btwCommandUses` (windowed) | `btwUseCount` (all-time) |
| ------------------ | ---------------------------- | -------------------------- |
| (a) Time window     | 30-day windowed              | cumulative / lifetime      |
| (b) Counter class   | session-coverage (deduped)   | raw invocation count       |

Both axes differ. Folding the all-time counter into a windowed ratio's
numerator via `Math.max` means the Memory Execution score for `/btw`
never regresses and drifts upward purely with account age, independent
of anything the user did in the last 30 days — the same failure mode
this repo has already hit once with cumulative all-time flags like
`hasUsedAgentsFleet`.

## Decision

PR #119 (CCE-78) removes the blend:

- `btwCommandUses` in `signalsSummary` is now `maxProbe(signals,
  "btwCommandUses")` only — windowed session-coverage, no all-time
  component. It still feeds the Memory Execution ratio numerator (see
  `app/lib/__tests__/rubric-predicates.test.ts` and
  `scripts/__tests__/build-signals-summary.test.mjs` for the split
  coverage).
- The all-time counter is exposed as its own field,
  `cliBtwUseCountAllTime` (`signals.settings?.cliBtwUseCount ?? 0`), and
  documented in `app/data/probe-catalog.json` as a "habit-only adoption
  signal" — good for a `>=1` predicate, wrong for a windowed ratio.
- The tip 33 next-action (`btw-side-channel` in the `memory` dimension
  of `app/data/rubric.json`) is rerouted from the blended field to
  `cliBtwUseCountAllTime>=1` directly. Predicate ergonomics ("has the
  user ever used `/btw`") are served by the cumulative field on its own
  terms, not by smuggling it into a ratio.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  (the probe tracker) and its CI-enforced header counts were updated in
  the same PR, per the probe-tracker-sync rule in CLAUDE.md.

## Consequences

- The Memory Execution ratio's `/btw` numerator now genuinely tracks
  recent behavior. A user who used `/btw` heavily a year ago but not in
  the last 30 days no longer gets free credit for it.
- `cliBtwUseCountAllTime` is a new field on `signalsSummary` — anything
  that wants "has this user ever adopted `/btw`" reads that field, not
  `btwCommandUses`.
- This is the narrow fix. The broader problem — the whole Memory
  Execution numerator originally summed `/btw + /clear + /compact +
  /rewind` across three different semantic classes in one `sum` — is
  tracked separately as **CCE-79**: a full per-field redesign of that
  numerator (restricting it to genuinely comparable session-coverage
  signals, moving `/btw` to cumulative evidence text, and keeping
  `/rewind` as a next-action probe only). See the per-field
  classification table this PR's fix follows in CLAUDE.md's Hard Rules
  section ("Per-field semantic categorization before adding to any
  numerator").
- General rule going forward, now codified in CLAUDE.md: before adding
  or summing any field into a ratio numerator, classify it on both the
  time-window axis and the counter-class axis. If either axis differs
  from what's already in the sum, it doesn't belong there — route it to
  evidence text, a separate binary predicate, or its own ratio with a
  matched denominator instead.
