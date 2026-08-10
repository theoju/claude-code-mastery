---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory Execution scorer redesign: narrowing the numerator to session-coverage signals

CCE-79 (PR #128) changes what counts toward the Memory & Context Management
Execution score. The ratio numerator drops from four memory-hygiene
commands to two, `/btw` moves from the ratio into evidence text, and the
rubric target comes down from 92 to 60 to match the narrower ceiling.

## The problem

The original `memory` scorer in `scripts/score.mjs` summed four slash-command
counters as if they were interchangeable:

```
sum = btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses
ratio = min(sum / interactiveOrUnknownSessionsAnalyzed, 1)
```

That sum quietly mixed three different kinds of signal. `/clear` and
`/compact` are 30-day windowed, per-session-deduped counts sourced from
`history.jsonl` — genuine session-coverage. `/btw` is not: its reliable
source is `~/.claude.json`'s cumulative all-time `btwUseCount`
(`cliBtwUseCount`), a lifetime invocation count with no window at all.
`/rewind` is technically session-coverage too, but it's almost always zero
in practice — `/rewind` is triggered by the Esc-Esc keyboard shortcut far
more often than typed as a slash command, so it barely ever shows up in
transcripts or `history.jsonl`.

CCE-78 (the prior fix, PR #119) had already caught and closed the sharpest
version of this bug: `run-assessment.mjs` was `Math.max`-ing the cumulative
`cliBtwUseCount` straight into the windowed `btwCommandUses` field before it
ever reached the scorer, corrupting the numerator at the data-assembly
layer. That fix stopped the specific leak but left the deeper problem
standing — even with clean inputs, the `memory` scorer's `sum` still
combined a cumulative counter and a near-zero binary signal with two
legitimate windowed counters in one undifferentiated total. CCE-79 is the
follow-up structural redesign.

## The decision

Classify every candidate numerator field on two axes before it goes into a
`sum`: **time window** (30-day windowed vs. cumulative all-time) and
**counter class** (per-session-coverage vs. raw invocation count). A field
whose class differs from the rest of the numerator on either axis doesn't
belong in it — it needs its own surface.

Applying that to Memory:

- **Numerator narrowed to `/clear` + `/compact`.** Both are 30-day
  windowed, per-session-coverage counts — the same class, so they're safe
  to sum. `scripts/score.mjs`'s `memory` scorer now reads only
  `clearCommandUses` and `compactCommandUses` via `maxProbe`.
- **`/btw` moved to evidence text.** It's still computed and still visible
  — just not in the ratio. When `signalsSummary.cliBtwUseCountAllTime` is
  greater than zero, the scorer appends `"Plus N all-time /btw invocations
  (cumulative, not in ratio)."` to the evidence string. Users who lean on
  `/btw` don't lose visibility into that habit; they just don't get a
  windowed ratio inflated by a lifetime counter.
- **`/rewind` dropped from the ratio, kept as a next-action probe.** The
  `rewindCommandUses>=1` `satisfiedWhen` check for the `rewind-reflex`
  next-action (Boris tip 62) in `app/data/rubric.json` is untouched — "have
  you ever used `/rewind`" is still a useful binary signal. It just no
  longer contributes to the Execution ratio, where its near-zero rate was
  diluting the numerator for everyone regardless of actual memory hygiene.
- **Rubric target lowered 92 → 60.** With two commands in the numerator
  instead of four, hitting the old 92% ceiling would require session
  coverage no realistic workflow produces. 60% represents mature usage of
  the narrowed set — most interactive sessions carrying at least one
  `/clear` or `/compact`.

The methodology page's Memory & Context Management formula block
(`app/methodology/page.tsx`) and the probe-implementation tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) were
updated in the same PR to describe the two-command numerator and the new
target — the tracker's per-change-sync rule treats a stale tracker as an
incomplete change, and this counts as one even though it adds no new
probes, catalog entries, or `signalsSummary` keys.

## Consequences

- **Existing users may see a large Memory vertex jump.** Because the target
  dropped from 92 to 60, someone previously scoring, say, 55/92 (60
  normalized) now scores 55/60 (92 normalized) for the *same underlying
  behavior* — a +32 jump with no change in habits. That's expected: it's
  the target recalibration doing its job, not new credit.
- **Users who relied on `/btw` to inflate their Memory Execution score will
  see it fall.** That's the intended correction — `/btw`'s cumulative count
  was never a legitimate windowed signal. The evidence text keeps the
  count visible so the change reads as "accounted properly," not "lost."
- **The two-axis categorization is now a standing rule**, not a one-off
  fix. CLAUDE.md's hard rules capture it for future scorer work: before
  adding any field to a ratio numerator (or summing multiple fields
  together), classify it on time window and counter class first. If a new
  field's class doesn't match the rest of the sum, route it to evidence
  text, a separate binary predicate, or a separately-denominated ratio
  instead.
- **Coverage regression tests live in
  `scripts/__tests__/memory-customization-execution-scorers.test.mjs`** —
  including cases asserting `/btw` and `/rewind` no longer move the score,
  the evidence-text format for `cliBtwUseCountAllTime`, and cap behavior
  (`rawRatio > 1`) on the narrowed numerator.

## Non-goals

This change didn't touch the Customization scorer (`/color` + `/voice` +
`/focus`), which sums three fields that are already the same class —
no asymmetry to fix there. It also didn't touch `/btw`'s Platform Setup
scoring, which correctly uses `cliBtwUseCount` as a presence/cumulative
signal outside any ratio. Auditing the remaining Execution scorers
(planning, parallel, scheduled, remote, verification, integrations,
learning, model-effort) against the same per-field categorization process
is tracked separately, as is a possible per-month normalization for
cumulative counters like `/btw`'s, should one ever need to enter a ratio.
