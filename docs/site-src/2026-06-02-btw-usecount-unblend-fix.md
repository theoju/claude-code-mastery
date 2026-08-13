---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# Un-blending `btwCommandUses`: cumulative vs. windowed counters (CCE-78)

`signalsSummary.btwCommandUses` used to lie a little. It reported a
30-day windowed number but was quietly topped up with an all-time
counter, which meant the reported figure drifted upward the longer
you'd had Claude Code installed — regardless of what you'd actually
done in the last 30 days. PR #119 (CCE-78) removes the blend and gives
the cumulative counter its own field.

## The bug

`/btw` is a side-channel command: it rarely lands in the session
transcript JSONL, so the scorer's primary source for it is
`~/.claude/history.jsonl`, MAX-merged with whatever the transcript scan
does find. That MAX-merge is legitimate — two windowed sources
recovering the same 30-day signal from different surfaces.

The bug was a second value getting folded into the same field:
`settings.cliBtwUseCount`, an **all-time, cumulative** invocation count
maintained by Claude Code itself (not windowed at all). The original
code, added during the v0.9.15 runtime-adoption-probes cycle for tip-33
predicate ergonomics, `Math.max`'d it straight into the 30-day figure.
A user who'd typed `/btw` 36 times over a year but zero times in the
last month would still show up with `btwCommandUses: 36` — a session-
coverage ratio's numerator inflated by a number that has no session
window at all, and that only grows with account age.

`CLAUDE.md`'s hard-rules section names the general failure mode this
instance falls under: don't blend cumulative all-time counters into
windowed ratio surfaces. Two semantic axes have to be checked
independently before summing (or `Math.max`-ing) any field into a
ratio numerator:

- **Time window** — windowed (e.g. 30-day) vs. cumulative (lifetime).
- **Counter class** — session-coverage (deduped per session) vs. raw
  invocation count.

`cliBtwUseCount` and the transcript/history-derived `/btw` count differ
on the first axis, so they don't belong in the same field, full stop —
independent of whether they'd also differ on the second.

## The fix

`buildSignalsSummary` in `scripts/run-assessment.mjs` now keeps the two
values apart:

- `btwCommandUses` stays exactly what its name says: `maxProbe(signals,
"btwCommandUses")`, the MAX-merge of transcript and `history.jsonl`
  sources within the lookback window. No cumulative input.
- `cliBtwUseCountAllTime` is a new field, sourced straight from
  `signals.settings?.cliBtwUseCount ?? 0` — the same cumulative number,
  now labeled for what it is.

The rubric's tip-33 (and tip-54) `/btw`-adoption `satisfiedWhen`
predicate was rerouted to key off `cliBtwUseCountAllTime` instead of
the windowed field — "have you ever formed this habit" is a cumulative
question, and that's the field that actually answers it now.
`app/data/probe-catalog.json`'s `cliBtwUseCountAllTime` entry documents
the split for the `/methodology/probes` page, and its `btwCommandUses`
entry explicitly calls out that the two are no longer blended.

Coverage lives in `scripts/__tests__/signals-summary.test.mjs`: one
test asserts `btwCommandUses` takes the MAX of transcript and history
only — not `cliBtwUseCount` — and two more assert
`cliBtwUseCountAllTime` is exposed correctly, including the zero
default when `settings.cliBtwUseCount` is absent.

## What didn't change

The Memory Execution score itself didn't move. The scorer body already
called `maxProbe(...)` directly rather than reading the corrupted
`signalsSummary` blend, so the fix is a data-integrity correction to
the summary surface and its predicate wiring — not a scoring-formula
change. The deeper question of whether `/btw` belongs in the Memory
Execution ratio's numerator at all is separate, harder work, filed as
CCE-79.

## Why this is a decision worth recording

The general rule (windowed vs. cumulative, session-coverage vs.
raw-invocation-count — now written up in `CLAUDE.md`) exists because
this is the second time a cumulative counter has snuck into a windowed
ratio numerator through an ergonomic-looking `Math.max`. Anyone adding
a new field to a `signalsSummary` sum should classify it on both axes
first and route anything that doesn't match the existing inputs to its
own field, exactly as `cliBtwUseCountAllTime` does here.

This page is a flat dated entry rather than folded into an existing
architecture page because the core lens doesn't yet have an
`architecture/` section — only `images/`. Once a durable "scoring model
/ ratio-scorer semantics" page exists, this fix and the CCE-79
follow-up belong together there rather than as separate dated notes.
