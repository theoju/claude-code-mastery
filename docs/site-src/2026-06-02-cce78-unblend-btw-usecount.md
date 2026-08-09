---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: unblend `/btw` usage from the Memory Execution ratio

PR #119 fixes a scoring bug in the Memory Execution scorer: the signal that
counted `/btw` invocations was silently blending a cumulative, all-time
counter into a 30-day windowed ratio.

## The bug

`buildSignalsSummary()` in `scripts/run-assessment.mjs` derives
`signalsSummary.btwCommandUses` — the numerator input the Memory Execution
scorer uses to compute recent `/btw` usage. Before this fix, that field was
computed with a `Math.max` blend between two sources that look
interchangeable but aren't:

- the 30-day windowed, session-coverage count of `/btw` derived from
  `~/.claude/history.jsonl` and transcript scanning (via `maxProbe`), and
- `settings.cliBtwUseCount`, a **cumulative, all-time** invocation counter
  Claude Code itself maintains in `~/.claude.json`.

`Math.max` was chosen for predicate ergonomics when the `/btw` probe was
added during the v0.9.15 runtime-adoption-probes cycle — it made the "have
you ever used `/btw`" check trivially true once you'd used it, even once.
But `btwCommandUses` doesn't just back that adoption predicate; it's also
the numerator half of a windowed ratio in the Memory Execution scorer. Blend
the two and the ratio's numerator silently drifts upward with account age
rather than with recent usage — the scorer rewards having typed `/btw`
_ever_, not typing it in the current scoring window.

CLAUDE.md's per-field semantic table names this exact failure mode: any
field entering a ratio numerator has to be checked on two independent axes,
**time window** (windowed vs. cumulative) and **counter class**
(per-session coverage vs. raw invocation count), before it's summed or
`Math.max`-ed with anything else. `cliBtwUseCount` fails both checks against
the windowed, session-coverage signals it was blended with.

## The fix

`btwCommandUses` is now `maxProbe(signals, "btwCommandUses")` only — the
windowed, session-coverage value, with no cumulative input. The cumulative
counter is exposed as its own field, `cliBtwUseCountAllTime`
(`signals.settings?.cliBtwUseCount ?? 0`), sourced in `probe-catalog.json`
as a `runtime`-category signal (`~/.claude.json → btwUseCount`). The tip-33
`satisfiedWhen` predicate — the "have you adopted `/btw`" adoption check —
now reads `cliBtwUseCountAllTime` instead of the blended field, so the
adoption-ergonomics goal the original blend was solving for is preserved
without touching the ratio.

The probe-catalog entries for both fields spell out the split explicitly:
`btwCommandUses` documents that it is windowed session-coverage and is
**not** blended with the all-time counter, and `cliBtwUseCountAllTime`
documents that it's the cumulative counterpart, reserved for "have you ever
adopted this habit" predicates.

## Why it matters

This is the same class of bug CLAUDE.md already flags for
`hasUsedAgentsFleet`-style cumulative flags: a numerator that mixes a
windowed, per-session-coverage signal with a lifetime invocation count
overstates recent coverage and makes the score drift upward simply because
the account is older, independent of whether the user's `/btw` habit is
still active. CCE-78 is the root-cause fix for the `/btw` field
specifically. The broader redesign of the Memory Execution scorer's
numerator — restricting it to per-field-semantics-correct inputs across all
of `/btw`, `/clear`, `/compact`, and `/rewind` rather than one fungible sum
— is filed separately as CCE-79.

## References

- PR: [#119](https://github.com/theoju/claude-code-self-assessment/pull/119)
- `scripts/run-assessment.mjs` — `buildSignalsSummary()`, the `btwCommandUses` /
  `cliBtwUseCountAllTime` split
- `app/data/probe-catalog.json` — `btwCommandUses` and `cliBtwUseCountAllTime`
  entries
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — living
  probe tracker, updated in the same PR
- CLAUDE.md — "Don't blend cumulative all-time counters into windowed ratio
  surfaces" and "Per-field semantic categorization before adding to any
  numerator"
