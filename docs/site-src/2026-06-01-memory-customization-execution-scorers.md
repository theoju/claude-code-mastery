---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory and Customization get real Execution scorers

Two of the twelve rubric dimensions — Memory & Context Management and
Terminal & Customization — used to route straight to `noTelemetry()` in
`scripts/score.mjs`. That's the `EXECUTION_SCORERS` placeholder that
tells `withGates` "don't even try": no ratio, no gate checks, just a
permanent unmeasured vertex on the radar, italicized with the footnote
that tells you not to read it as a zero. PR #116 (CCE-76) retired both
placeholders and replaced them with real transcript-derived ratio
scorers, which means every one of the twelve dimensions now has an
Execution-axis measurement. Model & Effort Tuning is still the outlier
worth naming precisely: it's *partially* measured — Opus-dominant
session ratio comes from transcripts, effort level (`max`/`xhigh`/etc.)
stays settings-only because it's never written to session-meta.

## Why these two were stuck on `noTelemetry()`

The cooked telemetry that most Execution scorers read —
`~/.claude/usage-data/{facets,session-meta}/*.json` — never breaks
invocations down by slash command. There's no field in there for
"did this session run `/clear`." That's a real constraint, but the
CLAUDE.md rule that grew out of it ("no cooked telemetry → unmeasured")
was over-broad: it conflated *cooked telemetry* with *Execution*, when
other dimensions had already shown the two aren't the same thing.
`learning` scores off a transcript scan for the `★ Insight` banner;
`parallel` scores off a transcript scan for worktree usage. Both mix
transcript signals into Execution scoring via
`withGates({ transcripts: true, ... })`. CCE-76 extends that same
pattern to Memory and Customization, using posture-command counters
that CCE-71 had already made trustworthy by partitioning them away from
observer/SDK echo inflation.

## What the scorers measure

Both new scorers live in `scripts/score.mjs` under
`EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization`, and
both are `withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`
ratio scorers — session-coverage hits over a session-count denominator,
capped at 100%.

**Memory** counts session-coverage hits on `/clear` and `/compact` via
`maxProbe(s, "clearCommandUses")` / `maxProbe(s, "compactCommandUses")`
(the MAX-merge across transcript- and history-sourced counters), divides
by `interactiveOrUnknownSessionsAnalyzed`, and reports the percentage.
`/btw` and `/rewind` are deliberately **not** in that ratio — more on
why below. When the sum is zero, the scorer surfaces a gap: *"No
/clear or /compact in any interactive session."*

**Customization** counts session-coverage hits on `/color`, `/voice`,
and `/focus` (again via `maxProbe`), divides by the same denominator,
and reports the percentage. Zero-signal gap: *"No /color, /voice, or
/focus in any interactive session."*

Both evidence strings surface the cap explicitly when a session used
more than one of the counted commands and the raw ratio exceeds 100% —
`"... — capped from 160% (multiple memory commands per session)"` — so
a user reading the radar sees the over-use rather than a misleadingly
clean 100. That's a deliberate rejection of hiding the multi-counting
risk behind `Math.min(ratio, 1)` alone.

## The new session universe: `interactive_or_unknown`

This is the part of the change that took the most care, because it's
exactly the class of bug the CLAUDE.md hard rule from PR #97 warns
about: *a ratio's numerator must be a subset of its denominator's
universe, or the ratio can exceed 100% and the cap silently masks the
violation.*

The seven posture-command counters (`/btw`, `/clear`, `/compact`,
`/rewind`, `/color`, `/voice`, `/focus`) are gated by `allowPosture` to
`interactive_cli ∪ "unknown"` — CCE-71's conservative-fallback design,
because `classifySessionKind` sometimes can't determine a session's
kind (truncated or legacy transcript formats) and `"unknown"` is the
safe bucket for those. But the existing `interactiveSessionsAnalyzed`
denominator was strict `interactive_cli` only. Gating a new scorer on
`{ universe: "interactive_only" }` against that numerator would have
reproduced the exact numerator-superset-of-denominator bug PR #97 fixed
for planning — any session classified `"unknown"` would contribute to
the numerator without counting in the denominator.

The fix: `scripts/insights-signals.mjs` now computes and returns

```
interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown
```

and `withGates` in `scripts/score.mjs` grew a third `universe` option
alongside `"interactive_only"` and `"all_sessions"`:

```
- "interactive_only":       s.insights.interactiveSessionsAnalyzed
- "interactive_or_unknown": s.insights.interactiveOrUnknownSessionsAnalyzed
- "all_sessions":           s.insights.sessionsAnalyzed
```

The choice is recorded on the wrapped scorer as `__universe`, which is
how tests audit the contract:
`EXECUTION_SCORERS.memory.__universe === "interactive_or_unknown"` and
the same for `customization`. The alternative — tightening
`allowPosture` to `interactive_cli` only — was considered and rejected:
it would undo CCE-71's conservative fallback and risk under-counting
for anyone whose transcripts don't classify cleanly. Widening the
denominator to match the numerator's universe was the smaller, more
principled diff.

## Why the memory numerator excludes `/btw` and `/rewind`

If you read the original CCE-76 design spec, the memory ratio was
specified as `btw + clear + compact + rewind`. The scorer that actually
shipped — and the one you'll find in `scripts/score.mjs` today — sums
only `clear` and `compact`. That's not a discrepancy; it's CCE-79, a
follow-on redesign that landed after CCE-76's own review caught a
category error the design spec had inherited from the original memory
scorer plan: `/btw`'s `cliBtwUseCount` is a **cumulative all-time**
invocation count, not a 30-day windowed session-coverage counter like
the others, and mixing a cumulative source into a windowed ratio's
numerator inflates it in a way that drifts upward with account age
rather than with recent posture — the same class of bug CLAUDE.md's
per-field semantic categorization rule exists to catch. `/rewind` is a
keyboard shortcut, effectively never typed as a slash command, so it
contributed near-zero real signal.

The redesigned scorer keeps both, just not in the ratio:

- `/clear` and `/compact` are the numerator — both are windowed,
  session-coverage counters, so they're semantically matched to the
  `interactiveOrUnknownSessionsAnalyzed` denominator.
- `/btw`'s cumulative count surfaces as evidence text instead:
  `"Plus 42 all-time /btw invocations (cumulative, not in ratio)."`
  (via `signalsSummary.cliBtwUseCountAllTime`, omitted entirely when
  it's zero).
- `/rewind` drops out of the scorer body altogether and lives on only
  as a binary `rewindCommandUses>=1` next-action predicate in
  `rubric.json`.

The rubric's `memory.target` was recalibrated from 92 to 60 to match
the narrowed, more realistic ceiling — a two-command numerator
saturates at a lower raw score than a four-command one would, so the
normalization target had to move with it.
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`
pins this down directly: Test 12a asserts a session with `btw=100` and
`rewind=100` but `clear=0` and `compact=0` scores **0**, and Test 12f
asserts `rubric.json`'s `memory` dimension target reads `60`.

Customization's three inputs (`/color`, `/voice`, `/focus`) didn't need
the same treatment — the counter-class unification below already made
all of them windowed session-coverage counters, so `customization`'s
numerator stayed `color + voice + focus` with no exclusions.

## A quieter fix underneath: counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` in
`scripts/_usage-data.mjs` incremented **per message** (once per
`/focus` or `/rewind` invocation seen), while the other five posture
counters (`btw`, `clear`, `compact`, `color`, `voice`) incremented
**per session** (once per session that used the command at least
once, regardless of how many times). That split was an artifact of
when each counter was added, not a deliberate design choice, and it
meant any scorer summing across all seven would be adding two
different units together. This PR retrofits `focus` and `rewind` onto
the same session-coverage flag-set pattern the other five already
used, so every input to both new ratio scorers is now the same unit:
one hit per session, no matter how many times the command fired inside
it.

## What this unlocks and what it doesn't

Two italic-unmeasured Execution vertices become real, solid ones on
the radar — no UI change was needed for that; `RadarChart.tsx` already
renders italic + reduced opacity only when `gapReason !== null`; once
these scorers return `gapReason: null`, the vertex renders normally.

What it doesn't do: fix the multi-counting risk at its root. A session
that ran both `/clear` and `/compact` still contributes 1 to each
counter, so summing them can push the raw ratio over 100% — that's
what the `Math.min(ratio, 1)` cap and the "capped from N%" evidence
suffix are for. The cleaner fix — a single
`sessionsWithAnyMemoryCommand`-style aggregate counted once per session
regardless of how many qualifying commands it used — was deliberately
deferred rather than folded into this change.

## Net effect

All twelve rubric dimensions now report an Execution score wherever
the gates are satisfied (transcripts scanned, sessions in window).
Where a dimension's Execution score is still `gapReason !== null` —
zero interactive-or-unknown sessions in the lookback window, or
transcripts not scanned at all — the radar still shows the italic
unmeasured treatment. That's now a per-run data-availability state
rather than a permanent per-dimension one.
