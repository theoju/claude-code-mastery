---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# CCE-79: Memory Execution scorer redesign

The Memory Execution scorer (`scripts/score.mjs::memory`) summed four
slash-command counters into one ratio numerator:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

That looks like one signal class. It isn't. `/clear` and `/compact` are
30-day, per-session-deduped coverage counters — reliable, windowed,
comparable to the denominator. `/btw` is a **cumulative all-time** invocation
count (`cliBtwUseCount` from `~/.claude.json`), not windowed at all. `/rewind`
is a near-zero binary signal (it's a keyboard shortcut, Esc-Esc, rarely typed
as a slash command). Summing all four meant a lifetime counter and an
almost-always-zero counter were diluting — or, for long-tenured accounts,
inflating — a ratio that's supposed to describe *recent* session-coverage
posture.

This is the same bug class CCE-78 (PR #116 follow-up) fixed at the field
level: that PR stopped `Math.max`-blending `cliBtwUseCount` into the
`btwCommandUses` numerator. CCE-79 fixes it at the design level — the whole
scorer, not just the one field.

## What changed

The numerator is now restricted to the two commands that actually share a
counter class:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const rawRatio = sum / denom;
```

`/btw` and `/rewind` are gone from the sum, but neither signal is lost:

- **`/btw`** now surfaces as cumulative evidence text, sourced from a new
  `signalsSummary.cliBtwUseCountAllTime` field: `"Plus N all-time /btw
invocations (cumulative, not in ratio)."` The count is still visible; it
  just no longer masquerades as a windowed rate.
- **`/rewind`** drops out of the ratio entirely but stays as a next-action
  probe — `rewindCommandUses>=1` is unchanged in `app/data/rubric.json`'s
  `memory` dimension. It was never a good session-coverage signal (near-zero
  volume), so it belongs as a binary "have you ever done this" check, not a
  rate contributor.

The gap text changed to match: `"No /clear or /compact in any interactive
session"` (previously enumerated all four commands).

Universe and gating are untouched — `withGates({ transcripts: true, universe:
"interactive_or_unknown" })` and the `interactive_cli ∪ unknown` denominator
are exactly as before. Only the numerator's composition changed.

## Rubric target: 92 → 60

`app/data/rubric.json`'s `memory` dimension target dropped from 92 to 60.
With the numerator narrowed from four commands to two, hitting 92%
session-coverage is no longer a realistic ceiling — 60% now represents
mature usage of the narrowed set ("most interactive-or-unknown sessions have
at least one `/clear` or `/compact`").

Recalibrating the target alongside narrowing the numerator was a deliberate,
flagged risk: dropping the target *and* dropping two fields from the sum
partially offset each other for any given user's raw behavior, but not
exactly — a user sitting at the old `55/92` normalizes to a different value
under `raw'/60` once `raw'` reflects only `/clear + /compact`. The PR body
for #128 carries the baseline-vs-post `assessment.json` diff so the
before/after Memory `executionScore` delta is visible, not just asserted.

## Why this matters

Per the two-axis categorization rule this PR added to CLAUDE.md, every field
entering a ratio numerator needs to be checked on two independent axes before
it goes into a `sum`:

| Axis              | Classes                                                  |
| ------------------ | -------------------------------------------------------- |
| (a) Time window    | windowed (e.g. 30-day) vs. cumulative (lifetime)          |
| (b) Counter class   | session-coverage (deduped per session) vs. raw invocation count |

The pre-redesign `memory` scorer mixed three classes in one sum: `/clear` and
`/compact` (windowed, session-coverage), `/btw` (cumulative, raw invocation
count), and `/rewind` (windowed, session-coverage, but near-zero volume — a
degenerate case rather than a mismatched class). If a future field's class on
either axis differs from the numerator it's about to join, it doesn't belong
in that `sum` — route it to evidence text, a separate next-action probe, or a
separately-gated ratio instead.

## Scope

Explicitly out of scope for this change (see the design spec's Non-goals):

- The Customization Execution scorer (`/color + /voice + /focus`) — all
  three are session-coverage counters with reliable sources, so no
  cross-class mixing exists there. Flagged as a follow-up audit, not touched.
- The `/btw` **Platform Setup** credit (`scripts/score.mjs:813-816`, the
  `adoptionBonus` call in the `automation` scorer). That correctly uses
  `cliBtwUseCount` as a cumulative presence/volume signal — only the
  Execution ratio had the mixed-class bug.
- Any per-month or per-week normalization that would let a cumulative counter
  like `/btw` eventually enter a ratio on equal footing. Filed as a longer-term
  follow-up, not attempted here.

## References

- Design spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`
- Scorer: `scripts/score.mjs::memory` (Execution scorer)
- Rubric: `app/data/rubric.json` → `dimensions[].id === "memory"` → `target`
- Parent tickets: CCE-76 (original scorer, PR #116), CCE-78 (interim `/btw`
  field-level fix)
- PR: [#128](https://github.com/theoju/claude-code-self-assessment/pull/128)
