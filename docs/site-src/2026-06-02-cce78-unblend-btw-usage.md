---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: un-blend `/btw` usage out of the Memory Execution ratio

PR #119 removes a `Math.max` blend that had quietly mixed a cumulative,
all-time counter into a 30-day windowed Execution signal. The Memory
Execution score itself doesn't move — this is a correctness fix to the
signal underneath it, not a rubric retune.

## The bug

`buildSignalsSummary()` in `scripts/run-assessment.mjs` projects raw
`gatherSignals()` output into the flat scalar map the rubric's
`satisfiedWhen` predicates evaluate against. For most slash-command
counters (`/go`, `/batch`, `/focus`, …) that projection takes
`maxProbe(signals, "...")` — the larger of a `history.jsonl` count and a
transcript-scanned count, both measured over the same 30-day lookback
window. `/btw` originally went through the same path, but its history
and transcript counts were then further blended with
`signals.settings.cliBtwUseCount`: a **lifetime** invocation counter
Claude Code itself maintains in `~/.claude.json`, with no window at all.

That collapsed two independent semantic axes into one number: time
window (30-day vs. all-time) and counter class (deduped session-coverage
vs. raw invocation count). The result fed `btwCommandUses`, which sits in
the numerator of the windowed Memory Execution ratio — so an account with
a long `/btw` history could show near-100% recent memory-command coverage
even in a 30-day window with almost no `/btw` use at all. The ratio drifted
up with account age rather than reflecting recent posture, exactly the
failure mode this repo's CLAUDE.md now calls out as a standing hard rule
(per-field semantic categorization before adding to any numerator).

## The fix

`buildSignalsSummary` (`scripts/run-assessment.mjs`) now keeps the two
counters separate:

- `btwCommandUses` stays `maxProbe(signals, "btwCommandUses")` — 30-day,
  session-coverage only. It continues to feed the Memory Execution ratio
  numerator with no lifetime data mixed in.
- `cliBtwUseCountAllTime` is a new field, sourced directly from
  `signals.settings.cliBtwUseCount`. It carries the cumulative, all-time
  count and is not part of any windowed ratio.

The rubric's `/btw` habit-adoption predicate (Boris tips 33/54) was
rerouted from the windowed field to `cliBtwUseCountAllTime`, since "have
you ever adopted this habit" is exactly the question a cumulative counter
answers correctly and a windowed one doesn't. `app/data/probe-catalog.json`
documents both fields under the `btwCommandUses` and `cliBtwUseCountAllTime`
entries, spelling out why they're not blended and which one predicates
should read.

## Why the Memory Execution score didn't change

The fix corrects the *shape* of the signal, not its recent value — for
sessions inside the 30-day window, `btwCommandUses` was already the
transcript/history max before the blend ever ran; the cumulative term only
mattered for accounts with old `/btw` history outside the window, where it
was silently inflating the ratio. Removing it makes the score track actual
recent practice; it doesn't retroactively change what "recent practice"
means for an account with steady `/btw` use throughout the window.

## The general rule

CCE-78 is the reference case for a rule now codified in this repo's
CLAUDE.md: before adding a field to any ratio numerator, classify it on
two axes — **time window** (windowed vs. cumulative) and **counter class**
(session-coverage vs. raw invocation count). If a candidate field doesn't
match the existing numerator inputs on both axes, it doesn't belong in the
same sum; route it to a separate cumulative field, a separate binary
predicate, or a separate ratio with a matched denominator instead. The
follow-up ticket, CCE-79, applies the same per-field audit to the rest of
the Memory Execution numerator (`/clear`, `/compact`, `/rewind`) rather
than treating the numerator's field list as fungible.
