---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Unblend `/btw` usage count from the Memory Execution ratio (CCE-78)

## Context

The Memory & Context Management Execution scorer reports a ratio: how many
of your recent sessions actually used the memory-hygiene commands (`/btw`,
`/clear`, `/compact`, …) against a windowed denominator. Before PR #119,
`signalsSummary.btwCommandUses` — the numerator input for `/btw` — was
computed as a `Math.max()` blend of two sources:

- the 30-day transcript+history session-coverage figure (how many distinct
  sessions in the scoring window typed `/btw`), and
- `~/.claude.json`'s `btwUseCount`, a **cumulative, all-time** invocation
  counter that has no window at all.

Taking the max meant the cumulative counter almost always won once an
account had any real `/btw` history, because a lifetime count outgrows a
30-day session-coverage count quickly. The ratio's denominator, though,
stayed windowed. Mixing a lifetime numerator into a windowed ratio doesn't
just add noise — it makes the score drift upward with account age rather
than reflect recent posture, which is the opposite of what an Execution
axis is supposed to measure.

This is the same failure class CLAUDE.md's "per-field semantic
categorization" rule now names explicitly: every field going into a ratio
numerator has to be checked on two independent axes — **(a) time window**
(windowed vs. cumulative) and **(b) counter class** (session-coverage vs.
raw invocation count). `btwCommandUses` and `btwUseCount` differed on both
axes and got summed anyway.

## Decision

`scripts/run-assessment.mjs::buildSignalsSummary` now keeps the two sources
separate:

- `btwCommandUses` is `maxProbe(signals, "btwCommandUses")` only — the
  transcript ∪ history-derived, 30-day windowed session-coverage figure.
  `~/.claude.json`'s cumulative count no longer feeds into it at all.
- `cliBtwUseCountAllTime` is a new field, sourced directly from
  `signals.settings?.cliBtwUseCount ?? 0` — the raw lifetime invocation
  count, exposed on its own.

The rubric's tip 33/54 next-action (`btw-side-channel` in
`app/data/rubric.json`) was rerouted from the old blended field to
`satisfiedWhen: "cliBtwUseCountAllTime>=1"`. That next-action is a binary
"have you ever used this" habit check, which is exactly what a cumulative
counter is for — it just doesn't belong inside a windowed ratio's
numerator anymore.

`scripts/__tests__/signals-summary.test.mjs` pins the fix directly: the
`btwCommandUses takes MAX of transcript and history only — NOT
cliBtwUseCount (CCE-78)` case asserts a 36-count `cliBtwUseCount` no longer
leaks into `btwCommandUses`, and a companion case asserts
`cliBtwUseCountAllTime` still forwards it. The output-key snapshot test in
`scripts/__tests__/build-signals-summary.test.mjs` now includes
`cliBtwUseCountAllTime` in the locked field list, so a future PR that
tries to re-blend the two sources — or drops the new field — fails CI on
the snapshot, not just on a stale doc.

## Consequences

- The Memory Execution ratio numerator is now a pure windowed
  session-coverage signal, matching the shape of every other command
  counter feeding that ratio (`/clear`, `/compact`).
- `/btw` adoption is still visible and still rewarded — just on the
  Platform Setup axis, as a habit-adoption next-action, not folded into
  Execution's windowed math.
- Anyone adding a new field to an existing ratio numerator should run the
  same two-axis check (time window, counter class) documented in
  CLAUDE.md before summing or `Math.max`-ing it in. CCE-78 is the
  reference incident; CCE-79 (the broader Memory Execution scorer
  redesign that later restricted the numerator to `/clear` + `/compact`
  alone) generalizes the fix.
