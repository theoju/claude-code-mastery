---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# CCE-79: Memory Execution scorer redesign

PR #128 restricts the Memory & Context Management Execution scorer's ratio
numerator to session-coverage signals only, and recalibrates the rubric
target that governs it. It's a follow-up to CCE-78, which patched one
symptom of the same underlying bug — this closes the class of bug, not just
the instance.

## The problem CCE-78 didn't fully fix

The original `memory` Execution scorer in `scripts/score.mjs` summed four
slash-command counters as if they were fungible:

```js
const sum = btw + clear + compact + rewind;
```

CCE-78 (v0.9.18) had already fixed the specific case where `cliBtwUseCount`
— a cumulative, all-time invocation count read from `~/.claude.json` — got
`Math.max`'d into the windowed, session-coverage `btwCommandUses` field
before it even reached this scorer. That closed the numerator leak at the
field level. But the `sum` above still mixed three distinct semantic
classes in one ratio:

| Field | Source | Counter class |
| --- | --- | --- |
| `/clear` | `history.jsonl`, per-session deduped | session-coverage, windowed |
| `/compact` | `history.jsonl`, per-session deduped | session-coverage, windowed |
| `/btw` | `~/.claude.json` (`cliBtwUseCount`) | invocation-count, cumulative all-time |
| `/rewind` | `history.jsonl` / transcripts | session-coverage, but almost always zero — it's a keyboard shortcut (Esc-Esc), rarely typed as a slash command |

Summing a windowed per-session-coverage signal with a lifetime invocation
count inflates the ratio's numerator in a way that has nothing to do with
recent behavior — exactly the CLAUDE.md rule this repo now carries under
"Don't blend cumulative all-time counters into windowed ratio surfaces."
`/rewind` wasn't a semantic mismatch on the time-window axis, but it was
functionally dead weight: near-zero across real transcripts, contributing
noise without contributing signal.

## The fix

`scripts/score.mjs`'s `memory` scorer (in the `EXECUTION_SCORERS` map) now
narrows the numerator to exactly two fields:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
```

`/btw` and `/rewind` didn't just get deleted — each was routed to the
surface that actually matches its semantics:

- **`/btw` → cumulative evidence text.** A new `signalsSummary.cliBtwUseCountAllTime`
  field carries the lifetime count separately from any windowed ratio. The
  scorer appends `"Plus N all-time /btw invocations (cumulative, not in
  ratio)"` to the evidence string whenever the count is positive, so the
  usage is still visible on the dimension card — it's just no longer
  inflating a percentage it doesn't belong in.
- **`/rewind` → standalone next-action probe, not a ratio input.** The
  `rewind-reflex` next-action in `app/data/rubric.json` (Boris tip 62,
  `satisfiedWhen: rewindCommandUses>=1`) still exists and still gates on
  the same field. Dropping it from the ratio doesn't drop the behavioral
  encouragement to use it — it just stops a near-always-zero signal from
  dragging the denominator's meaning around.

## Rubric target: 92 → 60

Narrowing the numerator from four commands to two shrinks the realistic
ceiling — hitting a given session-coverage percentage is mechanically
harder with two contributing commands than four. `app/data/rubric.json`'s
`memory` dimension target dropped from 92 to 60, on the reasoning that 60%
session-coverage of `/clear` OR `/compact` represents mature usage of the
narrowed set, not a weakened bar.

This target recalibration matters beyond cosmetics: `scripts/score.mjs`'s
`normalize()` divides raw score by rubric target to produce the 0–100
radar vertex (`clamp(round(rawScore / target × 100))`). A user sitting at
the same raw behavior before and after this change would have seen their
Memory Execution vertex jump — the old numerator (rawScore against target
92) would read one way, the new narrower numerator (rawScore against
target 60) reads differently for the same underlying `/clear`+`/compact`
usage. That's the intended effect of recalibrating the ceiling alongside
the numerator, not a bug: the two changes are meant to move together so
the vertex still reflects "hit the bar for what's actually being counted."

## Denominator and universe are unchanged

The scorer still runs under `withGates({ transcripts: true, universe:
"interactive_or_unknown" })`, dividing by
`s.insights.interactiveOrUnknownSessionsAnalyzed`. `/clear` and `/compact`
are posture commands scanned via the conservative `interactive_cli ∪
unknown` gate (per the CLAUDE.md rule on posture-vs-volume command
counting), so the denominator has to include both session kinds the
numerator draws from — using `interactive_cli` alone would let
unknown-session contributions push the ratio past 100%. This part of the
design was correct before CCE-79 and didn't need touching.

## The general lesson

CCE-79 is the reference case for a CLAUDE.md hard rule added alongside it:
before summing any new field into a ratio numerator, classify it on two
independent axes — **(a) time window** (windowed vs. cumulative) and
**(b) counter class** (session-coverage vs. raw invocation count). If a
candidate field's class differs from what's already in the sum on either
axis, it doesn't belong in that `sum` — route it to evidence text, a
separate binary probe, or a separately-denominated ratio instead. The
Terminal & Customization Execution scorer (`/color` + `/voice` + `/focus`)
was audited against the same table and found consistent — all three are
session-coverage, windowed — so it was left untouched; auditing the
remaining Execution scorers against this table is tracked as a followup,
not folded into this change.

## Where this lives

- Scorer: `scripts/score.mjs` (`EXECUTION_SCORERS.memory`)
- Rubric target: `app/data/rubric.json` (`memory` dimension, `target: 60`)
- Methodology narrative: `app/methodology/page.tsx`, Memory & Context
  Management section
- Design spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Tests: `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
