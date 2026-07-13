---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Decision: stop blending `/btw`'s cumulative counter into a windowed ratio

**PR:** [#119](https://github.com/theoju/claude-code-self-assessment/pull/119) · **Ticket:** CCE-78

## What changed

`signalsSummary.btwCommandUses` — the field that feeds the Memory Execution
dimension's ratio numerator — no longer `Math.max`-blends a cumulative
all-time counter into a 30-day windowed session-coverage metric.

Before this PR, `scripts/run-assessment.mjs#buildSignalsSummary` folded
`~/.claude.json`'s `btwUseCount` (a lifetime invocation count Claude Code
maintains itself) into the same field that also tracked 30-day
`history.jsonl` + transcript session coverage for `/btw`. That blend was
added during the v0.9.15 runtime-adoption-probes cycle purely to make the
tip-33 predicate more forgiving — but it silently conflated two independent
semantic axes on one number.

The fix splits the two signals apart:

- `btwCommandUses` stays strictly 30-day windowed session-coverage
  (`~/.claude/history.jsonl` + transcript MAX-merge, gated to
  `interactive_cli ∪ unknown` sessions like the other posture commands).
- A new field, `cliBtwUseCountAllTime` — sourced from `~/.claude.json →
btwUseCount` — carries the cumulative signal on its own, tagged in
  `app/data/probe-catalog.json` as a `runtime`-source, habit-only adoption
  signal.

The rubric's `btw-side-channel` predicate (Boris tips 33/54) was rerouted
from `btwCommandUses>=1` to `cliBtwUseCountAllTime>=1`. For a "have you ever
adopted the `/btw` habit" check, the cumulative field is the truer signal
anyway — a 30-day window can go quiet for a habit the user picked up eight
months ago, and the predicate shouldn't flip back to unsatisfied just
because the lookback window rolled past the last use.

Probe catalog, rubric, the probe-implementation-status tracker's header
counts, and regression tests (`scripts/__tests__/build-signals-summary.test.mjs`,
`scripts/__tests__/signals-summary.test.mjs`, `app/lib/__tests__/rubric-predicates.test.ts`)
were all updated in the same PR.

## Why

The Memory Execution score itself was unaffected — `scripts/score.mjs`'s
memory scorer already read `maxProbe(...)` directly rather than going
through the blended `signalsSummary` field, so no user-facing number moved.
This was a surface-level honesty fix: `signalsSummary.btwCommandUses` is
also read by the probes page and by anything downstream that assumes
"windowed" means windowed. Left uncorrected, the blend would have corrupted
the numerator the moment a scorer *did* start reading that field directly —
exactly the kind of drift the CCE-78 audit was run to catch.

The deeper problem — that the Memory Execution ratio's numerator originally
summed `/btw + /clear + /compact + /rewind` across three different counter
classes in one `sum` — is a separate, larger redesign. That's tracked as
**CCE-79** and is out of scope here; this PR only removes the blend.

## The rule going forward

`CLAUDE.md` now states a general check for any field being folded into a
ratio numerator, checked on two independent axes:

| Axis | Possible classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

If a new field's class differs from the existing numerator's on either
axis, it doesn't belong in the same `sum` — route it to a separate surface
(evidence text, a standalone predicate, or a separately-denominated ratio)
instead. `cliBtwUseCountAllTime` is the reference example: cumulative +
raw-invocation-count, kept off the windowed session-coverage ratio and
exposed only as its own predicate input.

This generalizes the same violation this repo already caught once before —
the `cliBtwUseCount` all-time blend in a different windowed ratio, fixed
earlier in the same v0.9.18 cycle — into a standing rule so it doesn't
recur under a different field name.

## Related

- Follow-up: **CCE-79**, the full per-field redesign of the Memory
  Execution scorer's numerator (restricting it to session-coverage-only
  signals and moving `/btw` and `/rewind` off the ratio entirely).
- Tracker: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  — updated in the same PR for the new probe-catalog entry and header
  counts.
