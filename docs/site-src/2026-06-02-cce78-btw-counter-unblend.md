---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/119
synthesized_into: []
doc_kind: decision
---

# CCE-78: un-blending the `/btw` counter

PR #119 fixed a real corruption in the Memory Execution scorer: the
`btwCommandUses` signal had been `Math.max`-blending a cumulative all-time
counter into a 30-day windowed ratio numerator. This page documents what was
wrong, the fix, and the standing rule it leaves behind for anyone adding a
field to a scorer's numerator in the future.

## The blend

`scripts/run-assessment.mjs::buildSignalsSummary` computes `btwCommandUses`
via `maxProbe(signals, "btwCommandUses")` — a max of the `/btw` count seen in
`~/.claude/history.jsonl` and the count seen scanning
`~/.claude/projects/*/*.jsonl` transcripts. That MAX-merge pattern exists for
good reason across most posture commands: a typed slash command can land in
either surface, and `history.jsonl` catches side-channel invocations the
transcript scanner misses. Before this PR, `/btw` also had a third input
folded into the same max: `signals.settings.cliBtwUseCount`, which is
`~/.claude.json`'s **lifetime** invocation counter for `/btw` — not
windowed, and not deduped to session-coverage.

That third input was introduced during the v0.9.15 runtime-adoption-probes
cycle for predicate ergonomics — it made a `btwCommandUses>=1` check pass
reliably. But `btwCommandUses` also feeds the numerator of the Memory
Execution scorer's windowed ratio, and folding a cumulative all-time count
into a 30-day-windowed numerator overstates that ratio and makes it drift
upward with account age rather than reflect recent posture.

## The fix

PR #119 splits the two counters cleanly:

- `btwCommandUses` in `buildSignalsSummary` is now `maxProbe(signals,
"btwCommandUses")` only — the transcript/history MAX-merge, with no
  `cliBtwUseCount` folded in. It stays 30-day windowed session-coverage, as
  the Memory Execution ratio numerator requires.
- `signalsSummary.cliBtwUseCountAllTime` is a new field, sourced directly
  from `signals.settings.cliBtwUseCount`, exposed for habit-only "have you
  ever adopted this" predicates.
- The rubric's `btw-side-channel` predicate (Boris tips 33/54) now keys off
  `cliBtwUseCountAllTime` instead of the windowed `btwCommandUses` — a
  cumulative-count field is the right backing signal for a lifetime-habit
  check, and the change stops leaking that cumulative signal into the
  windowed ratio through the back door.

`app/data/probe-catalog.json`'s `cliBtwUseCountAllTime` entry spells out the
distinction directly: "Distinct from `btwCommandUses` which is 30-day
windowed session-coverage; mixing the two in a ratio would corrupt window
semantics (CCE-78)." `scripts/__tests__/signals-summary.test.mjs` locks the
non-blend in with a source-level test —
`"btwCommandUses takes MAX of transcript and history only — NOT
cliBtwUseCount (CCE-78)"` — and `app/lib/__tests__/rubric-predicates.test.ts`
carries both fields (`btwCommandUses` and `cliBtwUseCountAllTime`) in its
all-satisfied fixture so a future predicate rewire that drops either field
fails CI rather than failing silently.

Note that the memory Execution ratio's numerator composition itself — which
signals it sums, and whether `/btw` belongs in it at all — is a separate,
larger redesign tracked as **CCE-79**; `probe-catalog.json` and CLAUDE.md
already forward-reference it. CCE-78 is scoped to stopping the semantic
blend at the `buildSignalsSummary` layer; it doesn't reshape the ratio.

## The standing rule

CCE-78 generalizes into a CLAUDE.md hard rule for anyone adding a field to
a ratio numerator (or summing several fields together) going forward.
Classify every candidate field on two independent axes before it goes into
a `sum`:

| Axis | Possible classes |
| --- | --- |
| (a) Time window | windowed (e.g. 30-day) / cumulative (lifetime) |
| (b) Counter class | session-coverage (deduped per session) / raw invocation count |

If a new field's class differs from the existing numerator inputs on either
axis, it doesn't belong in the same sum. Route it instead to a separate
surface: evidence text (cumulative counts), a separate binary predicate, or
a separate ratio with a matched denominator. `cliBtwUseCountAllTime` is the
reference example of the "separate predicate" branch of that rule — CCE-79
is expected to also exercise the "evidence text" branch when it lands.

## Why this class of bug is easy to introduce

The blend wasn't a typo — `Math.max` reads as reasonable "take the best
signal we have" ergonomics, and it genuinely helped one thing (predicate
reliability) while quietly breaking another (ratio integrity) it wasn't
being reviewed against. The project has hit this shape of bug before with
the `sessionsByKind` universe-gating rules and the posture/volume command
partition — the fix each time has been the same: name the two axes
explicitly, write the classification down before the code, and back it with
a test at the signal-construction layer (not just a scorer-fixture test)
so a future regression at the counting layer fails CI instead of drifting
scores silently.
