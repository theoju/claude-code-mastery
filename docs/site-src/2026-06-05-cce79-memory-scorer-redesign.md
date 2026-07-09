---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# CCE-79: Memory Execution scorer redesign

PR #128 narrows the Memory Execution scorer's ratio numerator to only the
session-coverage signals it should have had all along. It's the structural
follow-up to CCE-78, which patched a single leaking field; CCE-79 fixes the
class of bug so it doesn't come back with the next command someone adds.

## What changed

The Memory Execution scorer (`scripts/score.mjs::memory`) used to sum four
slash-command counters as if they were interchangeable:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

They aren't. `/clear` and `/compact` are per-session, deduped, 30-day-windowed
session-coverage counts — the same shape as the denominator
(`interactiveOrUnknownSessionsAnalyzed`). `/btw` is a **cumulative all-time**
invocation count read off `~/.claude.json`. `/rewind` is a session-coverage
signal in principle, but in practice it's almost always zero — `/rewind` is
the Esc-Esc keyboard shortcut, and people rarely type it as a slash command,
so it contributes noise rather than signal.

The redesigned scorer:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
const ratio = Math.min(rawRatio, 1);
```

`/btw` no longer touches the ratio at all. Instead, its cumulative count
(`signalsSummary.cliBtwUseCountAllTime`) is appended to the evidence string
as context — *"Plus N all-time /btw invocations (cumulative, not in
ratio)"* — so a heavy `/btw` user still sees the number, just not folded into
a 30-day ratio it doesn't belong in. `/rewind` drops out of the sum entirely;
it's kept only as a binary next-action probe (`rewindCommandUses>=1`) in
`app/data/rubric.json`, which is a fair way to credit "have you ever done
this" without diluting a session-coverage ratio with a near-always-zero term.

The rubric target for this dimension dropped from **92 to 60**
(`app/data/rubric.json`, `dimensions[id=memory].target`). With the numerator
narrowed from four commands to two, hitting a 92% ceiling stopped being
realistic — 60% now represents "most interactive sessions have at least one
`/clear` or `/compact`," which is the actual bar for mature memory hygiene
under the new formula.

The methodology page (`app/methodology/page.tsx`), the probe catalog
(`app/data/probe-catalog.json`), and the probe-implementation-status tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) were all
updated in the same PR to describe the narrowed formula — none of them
gained or lost a probe, catalog entry, or `signalsSummary` key, so the
tracker's five machine-enforced header counts stayed unchanged.

## Why

CCE-78 had already fixed the immediate bug: `cliBtwUseCount` (cumulative,
all-time) was being `Math.max`'d into `btwCommandUses` (30-day,
session-coverage) for predicate convenience, which silently inflated the
Memory Execution ratio's numerator. That was a field-level patch. CCE-79 is
the design-level fix — it establishes that **every candidate numerator field
needs to be classified on two independent axes before it's allowed into a
`sum`**:

| Axis              | Possible classes                                              |
| ------------------ | --------------------------------------------------------------- |
| (a) Time window    | windowed (e.g., 30-day) / cumulative (lifetime)                |
| (b) Counter class  | session-coverage (deduped per session) / raw invocation count  |

The original numerator mixed three classes in one sum: `/clear` and
`/compact` (windowed, session-coverage), `/btw` (cumulative, invocation-count),
and `/rewind` (windowed, session-coverage in theory, but near-zero in
practice — a reliability problem rather than a class problem). If a new
field's class differs from what's already in the sum, it doesn't belong
there — route it to a separate surface instead: evidence text for cumulative
counters, a separate binary predicate for near-zero/reliability-poor signals,
or a separate ratio with a matched denominator for windowed-but-different-class
signals.

This pattern is now a standing hard rule in this repo's `CLAUDE.md`
("Per-field semantic categorization before adding to any numerator"), with
CCE-79 as the worked example, so the next person adding a command to any
Execution scorer's numerator has a checklist to run first instead of
rediscovering the bug.

## Consequences

- **Users who leaned on `/btw` to inflate their Memory Execution score will
  see that dimension drop.** This is the intended correction, not a
  regression — the evidence text still shows their `/btw` count, just
  outside the ratio.
- **The rubric-target drop (92 → 60) means the same raw behavior can produce
  a visibly higher normalized score than before**, since normalization is
  `clamp(round(rawScore / target × 100))`. A user previously scoring 55/92
  (~60 normalized) now scores 55/60 (~92 normalized) for identical `/clear`
  + `/compact` usage. That's expected — it's the ceiling recalibration, not
  a scoring bug — but it's worth knowing if you're comparing a score from
  before this PR to one from after.
- **`/rewind` is out of the ratio for good** unless a future redesign
  specifically finds a way to make it a reliable session-coverage signal
  (it currently isn't, per the design spec's per-field table). It still
  counts toward the tip-62 next-action.
- **The Customization scorer (`/color` + `/voice` + `/focus`) was
  deliberately left untouched** — all three of its inputs are windowed
  session-coverage counters from the same source, so there's no class
  mismatch to fix there. Auditing the remaining Execution scorers
  (planning, parallel, scheduled, remote, verification, integrations,
  learning, model-effort) against the same two-axis check is filed as a
  followup, not part of this change.

## Where to look

- Scorer: `scripts/score.mjs` (`memory` block).
- Rubric target: `app/data/rubric.json` (`dimensions[id=memory].target`).
- Evidence-text source field: `signalsSummary.cliBtwUseCountAllTime`.
- Tests: `scripts/__tests__/memory-customization-execution-scorers.test.mjs`.
- Design spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`.
- Hard rule: `CLAUDE.md`, "Per-field semantic categorization before adding
  to any numerator."
