---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Memory & Context Management Execution scorer redesign (CCE-79)

PR #128 narrows the Memory & Context Management Execution scorer's ratio
numerator so it only sums fields that share the same counter class, and
recalibrates the rubric target to match the narrowed ceiling.

## What changed

`scripts/score.mjs::memory` used to sum four slash-command counters as
fungible numerator inputs:

```js
const sum = btw + clear + compact + rewind;
```

It now sums two:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
```

`/btw` no longer contributes to the ratio at all. Instead, the scorer reads
`s.signalsSummary.cliBtwUseCountAllTime` and — when it's greater than
zero — appends a sentence to the evidence string: `"Plus N all-time /btw
invocations (cumulative, not in ratio)."` You still get credit for using
`/btw`, just not blended into a 30-day windowed percentage.

`/rewind` also drops out of the sum. It's still tracked — the
`rewind-reflex` next-action in `app/data/rubric.json` still gates on
`rewindCommandUses>=1` (Boris tip 62) — but it no longer moves the Memory
Execution score. The zero-signal gap text changed to match: `"No /clear or
/compact in any interactive session"` (previously enumerated all four
commands).

The rubric target for the `memory` dimension dropped from 92 to 60
(`app/data/rubric.json`). With half as many commands feeding the numerator,
92% session-coverage is a much taller bar than it was — 60% represents
mature usage of the narrowed set (most interactive sessions have at least
one `/clear` or `/compact`). The universe stays `interactive_or_unknown`;
only the numerator's contents changed.

## Why

This is the reference implementation of a hard rule the project now
documents in `CLAUDE.md`: before summing fields into one ratio numerator,
classify each field on two independent axes — **(a) time window** (windowed
vs. cumulative) and **(b) counter class** (per-session-coverage vs. raw
invocation count). If a candidate field's class differs from what's already
in the sum, it doesn't belong there.

The old numerator mixed three classes in one `sum`:

| Field      | Time window | Counter class                    |
| ---------- | ----------- | --------------------------------- |
| `/clear`   | windowed    | session-coverage                  |
| `/compact` | windowed    | session-coverage                  |
| `/btw`     | cumulative all-time | raw invocation count      |
| `/rewind`  | windowed    | session-coverage, but near-zero (it's the Esc-Esc keyboard shortcut, rarely typed as a slash command) |

CCE-79 is the design-level follow-up to CCE-78, which had already fixed a
narrower instance of the same bug: `cliBtwUseCount` (a cumulative all-time
counter surfaced by `~/.claude.json`) was being `Math.max`'d into
`btwCommandUses` (a 30-day session-coverage counter) before it ever reached
the ratio. That fix stopped the field-level blend but left the scorer
summing `/btw` alongside `/clear` and `/compact` regardless — still mixing
a cumulative count into a windowed ratio, just one step removed. CCE-79
removes `/btw` from the sum entirely rather than patching around it again,
and applies the same scrutiny to `/rewind`, whose near-zero signal was
diluting the ratio without meaningfully reflecting behavior.

Dropping `/btw` from the ratio does lower the Memory Execution score for
anyone who was relying on `/btw` volume to inflate it — that's the
intended correction, not a regression. The evidence text keeps the count
visible so nothing about your `/btw` usage disappears from the dashboard,
it's just no longer conflated with session-coverage.

## What to check if you're touching this scorer

- The numerator's fields must share both a time window and a counter class.
  `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
  covers the narrowed-numerator behavior (`/btw` and `/rewind` excluded
  from `score`), the conditional `cliBtwUseCountAllTime` evidence text, and
  the cap-preservation regression case.
- `app/methodology/page.tsx`'s Memory & Context Management `<li>` block
  narrates the same formula and target — if you change the numerator or
  target again, that page needs the matching edit in the same PR.
- The probe tracker
  (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
  and `app/data/probe-catalog.json` descriptions for `btwCommandUses`,
  `cliBtwUseCountAllTime`, and `rewindCommandUses` were updated to point
  future readers at this redesign — keep them in sync per the "Keep the
  probe tracker in sync with every probe change" rule in `CLAUDE.md`.
- The Customization scorer (`scripts/score.mjs::customization`, `/color +
  /voice + /focus`) was audited as part of this design and found not to
  need the same fix — all three fields are session-coverage from the same
  window, no class mismatch.

## Related

- `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
  — full spec, including the per-field semantics table and risk surface.
- `docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`
  — implementation plan.
- `CLAUDE.md` — "Per-field semantic categorization before adding to any
  numerator" hard rule (follow-up to the CCE-78 "Don't blend cumulative
  all-time counters into windowed ratio surfaces" rule).
