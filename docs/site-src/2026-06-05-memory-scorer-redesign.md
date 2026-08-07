---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign (CCE-79)

PR #128 narrowed the Memory Execution scorer's ratio numerator to two
semantically-consistent signals and recalibrated the rubric target to match.
This is the CCE-79 follow-up to CCE-78 (PR #119), which had only patched the
immediate `/btw` blend asymmetry without addressing the deeper design
problem underneath it.

## What changed

The `memory` scorer in `scripts/score.mjs` used to sum four slash-command
counters as fungible numerator inputs — `btwCommandUses + clearCommandUses +
compactCommandUses + rewindCommandUses` — against the
`interactiveOrUnknownSessionsAnalyzed` denominator. As of PR #128, the sum
inside `memory` is just `clearCommandUses + compactCommandUses`
(`maxProbe(s, "clearCommandUses")` and `maxProbe(s, "compactCommandUses")`).
`/btw` and `/rewind` are gone from the ratio, but neither signal disappeared
from the dashboard:

- `/btw` now surfaces as cumulative evidence text. The scorer reads
  `s.signalsSummary?.cliBtwUseCountAllTime` and, when it's greater than
  zero, appends `"Plus N all-time /btw invocations (cumulative, not in
  ratio)."` to the evidence string. You still see your `/btw` usage; it just
  doesn't inflate the percentage.
- `/rewind` stays as a next-action probe only — the `rewindCommandUses>=1`
  `satisfiedWhen` predicate in `app/data/rubric.json` is untouched. It's a
  binary "have you ever used it?" check, not a ratio input.

The gap text changed to match: `sum === 0` now produces `"No /clear or
/compact in any interactive session"` instead of the old four-command
enumeration.

`app/data/rubric.json`'s `memory` dimension `target` dropped from `92` to
`60`. With the numerator narrowed from four commands to two, 92% session
coverage was no longer a realistic ceiling; 60% represents mature usage of
the narrowed set — most interactive sessions carrying at least one `/clear`
or `/compact`.

## Why

The four fields being summed didn't share a counter class. `/clear` and
`/compact` are windowed, per-session-deduped session-coverage signals read
from `history.jsonl`. `/btw`'s reliable source
(`~/.claude.json#btwUseCount`, exposed as `cliBtwUseCount`) is a cumulative
all-time invocation count — CCE-78 had already stopped it from leaking
directly into `btwCommandUses`, but the scorer still summed
`btwCommandUses` itself into the same ratio as the two session-coverage
fields. `/rewind` is a keyboard-shortcut command (Esc-Esc) that's almost
always zero in transcripts, so it contributed a near-permanent floor drag
rather than real signal. Summing across these classes silently mixed
"30-day per-session adoption" with "lifetime invocation count" inside one
percentage — the same bug shape CCE-78 had patched only at the field level.

This establishes a reusable rule, now written into this repo's CLAUDE.md:
before adding a field to a ratio numerator, classify it on two independent
axes — **(a) time window** (windowed vs. cumulative) and **(b) counter
class** (session-coverage vs. raw invocation count). If a new field's class
differs from the existing numerator inputs on either axis, it doesn't
belong in the same `sum`; route it to evidence text, a separate predicate,
or a separately-denominated ratio instead.

## What didn't change

- The scorer's universe stays `interactive_or_unknown` (via
  `withGates({ transcripts: true, universe: "interactive_or_unknown" })`) —
  unrelated to this fix.
- The Customization scorer (`/color + /voice + /focus`) wasn't touched.
  Those three fields are all session-coverage with reliable sources, so no
  asymmetry exists there; it's flagged as a possible follow-up audit, not
  addressed in this PR.
- `signalsSummary.btwCommandUses` and `signalsSummary.rewindCommandUses`
  are still computed and still populate the probe catalog — only the
  `memory` scorer's `sum` dropped them.

## If you're comparing before/after scores

A user whose Memory Execution score used to read `55 / 92` (normalized 60)
now reads against a target of 60, not 92 — the same raw behavior can
produce a meaningfully different normalized vertex. That's expected: the
old normalization was diluted by two fields that shouldn't have been in the
numerator in the first place. If your `/btw` usage was doing a lot of the
lifting on your old Memory score, expect the number to drop — check the
evidence text's `"Plus N all-time /btw invocations"` line to confirm the
count is still being tracked, just no longer folded into the ratio.

## Reference

- Spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`
- CLAUDE.md hard rule: "Per-field semantic categorization before adding to
  any numerator"
- Parent: CCE-78 (PR #119)
