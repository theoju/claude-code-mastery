---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# CCE-76: Memory & Customization Execution Scorers

**PR #116 · 2026-06-01**

Before this change, the Memory & Context Management and Terminal & Customization
dimensions had `noTelemetry()` stub Execution scorers. Both vertices on the
radar were rendered italic and footnoted as unmeasured — honest, but an
incomplete picture. CCE-76 replaces those stubs with real ratio scorers driven
by transcript-derived, per-session posture-command signals, completing live
Execution coverage across all twelve dimensions.

## What changed

### Two new Execution scorers

Both scorers use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.
The `interactive_or_unknown` universe counts sessions where
`classifySessionKind` returned `"interactive_cli"` or the conservative fallback
`"unknown"` (no transcript present). This matches the partition already used by
the posture-command scanners added in CCE-71.

**Memory scorer** — numerator is the sum of per-session coverage hits for
`/clear` and `/compact`, read via `maxProbe` so the higher of the transcript or
history scanner wins. The ratio is capped at 1 when a single session records
multiple memory commands. Evidence text surfaces all-time `/btw` invocations
(`cliBtwUseCountAllTime`) alongside the ratio without contributing to it — see
the CCE-78/CCE-79 history below for why.

```
Memory hygiene commands: N session-coverage hits across M interactive_cli∪unknown sessions (R%)
Plus K all-time /btw invocations (cumulative, not in ratio).
```

**Customization scorer** — numerator sums per-session coverage hits for
`/color`, `/voice`, and `/focus`. Same cap-at-1 and `maxProbe` mechanics as the
memory scorer.

```
Customization commands: N session-coverage hits across M interactive_cli∪unknown sessions (R%)
```

### Counter-class fix: `focusCommandUses` and `rewindCommandUses`

These two counters were previously raw invocation counts (incrementing once per
message that contained the command). This PR retrofits them to per-session
coverage counters, matching the canonical pattern already in use for `/btw`,
`/clear`, and `/compact`. A session that invokes `/focus` three times now
contributes `1` to the counter, not `3`. This prevents the ratio numerator from
exceeding the denominator when a command is used multiple times within one
session.

### New denominator field: `interactiveOrUnknownSessionsAnalyzed`

`gatherInsightsSignals` now computes and exposes:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` routes to this field when `universe: "interactive_or_unknown"` is
declared. Without this field, a `universe: "interactive_only"` denominator
would silently exclude sessions whose transcripts were inaccessible, potentially
producing ratios above 100% when those same sessions' posture commands were
counted by the scanner.

## Design decisions and trade-offs

### Why `interactive_or_unknown` instead of `interactive_only`

Posture commands like `/clear` and `/focus` are scanned from transcripts. A
session without a transcript path gets kind `"unknown"` — the scanner never
sees its commands, so its posture-command count is zero. Including `"unknown"`
sessions in the denominator correctly accounts for those zero-contribution
sessions and prevents the numerator from exceeding the denominator due to a
universe mismatch.

### Why `/btw` is evidence text, not a ratio input

`/btw` (Boris tip 33) is a side-channel command written directly to
`~/.claude.json` rather than into the JSONL transcript. Its counter
(`cliBtwUseCount`) is a cumulative all-time invocation count, not a
30-day-windowed session-coverage counter. Adding a cumulative, raw-invocation
counter to a windowed, session-coverage numerator conflates two independent
semantic axes (time window × counter class) and produces ratios that drift
upward with account age independent of recent posture. This is the exact
failure mode described in CLAUDE.md under "Don't blend cumulative all-time
counters into windowed ratio surfaces."

The CCE-78 incident (v0.9.18) demonstrated the corruption concretely: the
original Memory Execution scorer's `Math.max` blend of `cliBtwUseCount` into
`btwCommandUses` silently inflated the Memory ratio's numerator. CCE-79 (PR
TBD) is the full redesign; this scorer reflects the final shape — `/btw`
surfaced as cumulative evidence text via `cliBtwUseCountAllTime`, not in the
ratio.

### Why `/rewind` is excluded from the ratio

`/rewind` is triggered by a keyboard shortcut, not a typed command, so the
JSONL scanner rarely captures it. Including a near-zero signal in a ratio
numerator adds noise without meaningful coverage. It is retained as a
next-action probe in the rubric's `satisfiedWhen` predicate but is not scored
into the Execution ratio.

## Impact

After this PR, the radar's Memory and Customization vertices are no longer
italic-unmeasured. A `gapReason: null` return from both scorers means the
vertices render at their computed score, with evidence and gap text surfaced in
the dimension drilldown at `/dimensions/memory` and `/dimensions/customization`.

The methodology page and probe tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
are updated in the same PR to reflect the completed Execution coverage.

## Files touched

| File | Change |
| ---- | ------ |
| `scripts/score.mjs` | Added `memory` and `customization` entries to `EXECUTION_SCORERS`; wired `withGates({ transcripts: true, universe: "interactive_or_unknown" })` for both |
| `scripts/score.mjs` | Extended `withGates` to accept and route the new `"interactive_or_unknown"` universe option |
| `scripts/insights-signals.mjs` | Added `interactiveOrUnknownSessionsAnalyzed` to the returned result object |
| `scripts/_usage-data.mjs` | Retrofitted `focusCommandUses` and `rewindCommandUses` from per-message invocation counts to per-session coverage counters |
| `app/methodology/page.tsx` | Methodology page updated to document the new scorers |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Tracker updated to reflect all-twelve-dimension Execution coverage |
