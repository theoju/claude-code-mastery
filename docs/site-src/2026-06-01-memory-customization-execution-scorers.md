---
title: Memory & Customization get real Execution scorers
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Customization get real Execution scorers (CCE-76)

Before PR #116, ten of the twelve scoring dimensions had an Execution
scorer. **Memory & Context Management** and **Terminal & Customization**
routed to `noTelemetry()` in `scripts/score.mjs` — a placeholder that
returns `gapReason: NO_TELEMETRY` and renders as an italic, unmeasured
vertex on the radar. The reasoning behind the placeholder was correct as
far as it went: the cooked telemetry under `~/.claude/usage-data/` (the
same `{facets,session-meta}/*.json` files `/insights` reads) never
contains a per-command breakdown, so there was no honest way to score
memory-hygiene or customization habits from that source alone.

What the placeholder conflated was "no cooked-telemetry signal" with "no
Execution signal at all." Two other dimensions — `learning` (the `★
Insight` banner scan) and `parallel` (worktree-usage detection) — already
mixed transcript-derived signals into Execution scoring via
`withGates({ transcripts: true, … })`. PR #116 extends that same pattern
to memory and customization, using the posture-command counters that
`scanTranscriptInvocations` already collects in `scripts/_usage-data.mjs`.

## What changed

**Two ratio scorers replace the placeholders.** `EXECUTION_SCORERS.memory`
and `EXECUTION_SCORERS.customization` in `scripts/score.mjs` now sum
session-coverage hits for a fixed command set — `/btw`, `/clear`,
`/compact`, `/rewind` for memory; `/color`, `/voice`, `/focus` for
customization — and divide by a session-count denominator, the same
`clamp(round(rawScore / target × 100))` normalization every other
dimension uses.

**A new session universe closes a numerator/denominator gap.** The seven
posture-command counters are gated by `allowPosture` to sessions
classified as `interactive_cli` **or** `"unknown"` (the conservative
fallback for transcripts `classifySessionKind` can't confidently place).
The existing `interactive_only` universe in `withGates` only covers
`interactive_cli`, so a naive scorer built on it would let `"unknown"`
sessions inflate the numerator without ever appearing in the denominator
— exactly the numerator-exceeds-denominator failure mode the CLAUDE.md
hard rule from PR #97 warns about. `scripts/insights-signals.mjs` now
computes and returns a new field to close that gap:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` gained a matching `universe: "interactive_or_unknown"`
option alongside the existing `interactive_only` and `all_sessions`
choices. Both new scorers are declared with
`withGates({ transcripts: true, universe: "interactive_or_unknown" }, …)`,
and each wrapped function exposes the choice on `__universe` so tests (and
the methodology page) can audit the contract directly.

**Two counters were unified from per-message to per-session counting.**
`focusCommandUses` and `rewindCommandUses` used to increment once per
matching message; the other five posture counters (`btw`, `clear`,
`compact`, `color`, `voice`) already incremented once per session that
used the command at least once. PR #116 retrofits `focus` and `rewind`
onto the session-coverage pattern so every input to the new ratio scorers
shares the same unit — a session either used the command or it didn't,
never a raw message count. Existing predicates (`rewindCommandUses>=1`,
`focusCommandUses>=1`) are invariant under the change since they're
binary thresholds; the one test that asserted a raw count (two `/rewind`
messages in one session → `2`) was updated to assert `1`.

**The cap is now visible when it fires.** Because all seven inputs are
session-coverage counters, a single session that used both `/clear` and
`/compact` contributes to both terms of the sum — the ratio can exceed
1.0 before it's clamped. Rather than silently rendering a clean 100/100,
both scorers append a `"— capped from N% (multiple memory/customization
commands per session)"` suffix to their evidence string whenever the raw
ratio exceeds 1, so the over-counting is visible instead of hidden behind
the cap.

## Result

All twelve scoring dimensions now have Execution scores. The two new
dimensions surface real — and, in most environments, low — scores instead
of being hidden behind the italic-unmeasured treatment on the radar. In
the reference environment used to validate the PR, the overall Execution
composite moved from 77 to 66: a drop, but an honest one. The placeholder
was quietly excluding two real usage deficits from both the radar and
`rankedNextActions`; scoring them for the first time necessarily pulls the
composite down toward what was already true.

## Note: memory numerator later narrowed (CCE-79)

The memory scorer's ratio-based numerator shipped in PR #116 summed
`/btw`, `/clear`, `/compact`, and `/rewind` together. A follow-up change
(CCE-79) split those four inputs apart per the CLAUDE.md per-field
semantics rule: `/btw` is a cumulative all-time counter rather than a
30-day windowed session-coverage signal, and `/rewind` is a
keyboard-shortcut command whose signal is close to zero in practice.
Mixing three different counter classes into one `sum` overstated the
ratio in a way the CLAUDE.md hard rule on numerator semantics flags
directly. As of that follow-up, `EXECUTION_SCORERS.memory` restricts the
ratio to `/clear` and `/compact` only, surfaces cumulative `/btw` usage as
evidence text instead of ratio input, and keeps `/rewind` solely as a
binary next-action probe. See `scripts/score.mjs` (the `memory` scorer
body carries an inline comment citing CCE-79) for the current shape; this
page documents the scorer's original introduction in PR #116, including
the universe fix and counter unification, both of which are unchanged by
that later narrowing.
