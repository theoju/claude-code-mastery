---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending `btwCommandUses` from `cliBtwUseCount` (CCE-78)

PR #119 fixes a data-corruption bug in the Memory Execution scoring surface:
`signalsSummary.btwCommandUses` was silently blended from two counters that
look interchangeable but aren't.

## The bug

`btwCommandUses` is supposed to be a **30-day windowed session-coverage**
signal — how many recent sessions used `/btw` as a side-channel command
while Claude was working. Before this fix, `run-assessment.mjs` took
`Math.max()` of that windowed count against `settings.cliBtwUseCount`, a
**cumulative all-time invocation counter** read straight from
`~/.claude.json`. The blend was added for predicate ergonomics on the tip 33
rubric check, without weighing the fact that the two counters differ on two
independent axes:

| Axis              | `btwCommandUses` (windowed)      | `cliBtwUseCount` (cumulative) |
| ------------------ | --------------------------------- | ------------------------------ |
| Time window        | 30-day                            | lifetime                       |
| Counter class       | session-coverage (deduped/session) | raw invocation count           |

Once account age passes ~30 days, `cliBtwUseCount` almost always exceeds any
plausible windowed count, so the `Math.max` silently pinned the numerator to
the cumulative value. Any Execution ratio consuming `btwCommandUses` would
overstate recent `/btw` posture and drift upward with account age rather than
reflecting actual recent behavior — the exact failure mode the project's
hard rule on cumulative-vs-windowed blending (CLAUDE.md, "Don't blend
cumulative all-time counters into windowed ratio surfaces") now exists to
prevent.

In practice the Memory Execution scorer itself was unaffected — CCE-79
had already narrowed that scorer's numerator to `/clear + /compact` and
routed `/btw` to evidence text only — so this was a latent corruption on the
summary surface, not an active scoring regression. Fixing it before another
numerator addition read the blended field was the point.

## The fix

- `signals.settings.cliBtwUseCount` is now exposed on `signalsSummary` as its
  own field, `cliBtwUseCountAllTime`, computed directly
  (`signals.settings?.cliBtwUseCount ?? 0`) rather than merged into
  `btwCommandUses`.
- `btwCommandUses` reverts to a pure `maxProbe(signals, "btwCommandUses")`
  call — history.jsonl ∪ transcript MAX-merge only, still windowed,
  still session-coverage.
- The `btw-side-channel` rubric predicate (Boris tip 33+54, in the `memory`
  dimension of `app/data/rubric.json`) now reads
  `satisfiedWhen: "cliBtwUseCountAllTime>=1"` instead of consuming the
  blended field — a cumulative "have you ever used this" adoption check is
  exactly what that predicate wants, so the fix is more correct on both
  ends of the split.
- `app/data/probe-catalog.json` documents both fields explicitly, including
  the "NOT blended with" cross-reference on `btwCommandUses` and the CCE-78
  provenance note on `cliBtwUseCountAllTime`.
- CLAUDE.md gained a general hard rule: per-field semantic categorization
  (time window × counter class) before adding anything to a ratio numerator,
  so a future scorer author doesn't reintroduce the same shape with a
  different pair of counters.

## What didn't change

The Memory Execution score itself is unchanged — the scorer body never read
the corrupted `btwCommandUses` field in the first place (CCE-79 had already
moved `/btw` to evidence-only). This PR corrects the summary surface and the
predicate wiring underneath it, not the score.

## Verification

`app/lib/__tests__/rubric-predicates.test.ts` sweeps every `satisfiedWhen`
predicate in `rubric.json` against an all-satisfied fixture, which now
includes `cliBtwUseCountAllTime`. `scripts/__tests__/build-signals-summary.test.mjs`
locks the full `signalsSummary` key set with an inline snapshot, so
`cliBtwUseCountAllTime` appearing and `btwCommandUses` reverting to its
narrow windowed value are both regression-covered.

## Related

- CCE-78 (this ticket) — the un-blend itself.
- CCE-79 — the earlier Memory Execution scorer redesign that removed `/btw`
  from the ratio numerator in the first place (see
  `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`).
- CLAUDE.md hard rules: "Don't blend cumulative all-time counters into
  windowed ratio surfaces" and "Per-field semantic categorization before
  adding to any numerator."
