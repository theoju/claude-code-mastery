---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization now have real Execution scorers

Through PR #116 (CCE-76), the Execution axis stopped stubbing out two of its
twelve dimensions. Memory & Context Management and Terminal & Customization
used to route straight to "unmeasured" — a `noTelemetry()` placeholder in
`scripts/score.mjs` — because the cooked telemetry under
`~/.claude/usage-data/{facets,session-meta}/*.json` has no command-invocation
breakdown to score against. That reasoning about cooked telemetry was correct,
but it conflated "cooked telemetry" with "Execution." `learning` (the `★
Insight` banner scan) and `parallel` (worktree usage) already proved that
transcript scanning is a legitimate Execution source. CCE-76 extends the same
pattern to the last two holdouts. **All twelve scored dimensions now have a
real Execution scorer.** Model & Effort Tuning remains the only *partially*
measured one — the Opus-usage half comes from transcripts, effort level stays
settings-only.

## What the scorers count

Both scorers are ratio scorers built on `withGates`, wired the same way as
`learning` and `model-effort`:

```
memory:        withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)
customization: withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)
```

The numerator is session-coverage counts of posture-command slash commands,
read from `scanTranscriptInvocations` in `scripts/_usage-data.mjs` and
MAX-merged against the history.jsonl-derived counters via `maxProbe` (history
catches side-channel commands like `/btw` that never land in the session
JSONL; transcripts catch everything else).

- **Memory**: `clearCommandUses + compactCommandUses`, capped against the
  session denominator.
- **Customization**: `colorCommandUses + voiceCommandUses + focusCommandUses`.

Notably, memory's numerator does **not** include `/btw` or `/rewind`, even
though both are memory-adjacent commands and both were in the original CCE-76
design. `/btw` is a cumulative all-time counter (`cliBtwUseCountAllTime`), not
a 30-day windowed session-coverage count — mixing it into a windowed ratio's
numerator would overstate coverage and drift upward with account age rather
than reflecting recent posture, which is exactly the per-field semantic
violation CLAUDE.md's hard rules call out. `score.mjs`'s memory scorer instead
surfaces it as evidence text only ("Plus N all-time /btw invocations
(cumulative, not in ratio)"), sourced from `s.signalsSummary?.cliBtwUseCountAllTime`.
`/rewind` was dropped from the ratio entirely (near-zero signal in practice —
it's a keyboard shortcut, rarely typed) and now lives only as a binary
next-action probe (`rewindCommandUses>=1`) in the rubric. This is the CCE-79
follow-up redesign; the rubric's `memory.target` moved from 92 to **60** to
match the narrowed realistic ceiling of a two-command numerator.
`customization.target` stays at **80**.

## The new `interactive_or_unknown` universe

The seven posture-command counters in `scanTranscriptInvocations` (`/color`,
`/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`,
`/fewer-permission-prompts` minus the two dropped above) are gated by
`allowPosture`, which is true for sessions classified as `interactive_cli` **or**
`"unknown"` — the conservative fallback `classifySessionKind` returns when it
can't determine a transcript's entrypoint. The existing
`interactiveSessionsAnalyzed` denominator, by contrast, counts only strict
`interactive_cli` sessions. Dividing the wider numerator by the narrower
denominator would let a ratio exceed 100% whenever any `"unknown"` session
contributed a hit — the same numerator-not-a-subset-of-denominator bug fixed
for planning in PR #97.

The fix is a new denominator that matches the partition. `insights-signals.mjs`
now computes it inline, right after `interactiveSessionsAnalyzed`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` gained a third `universe` option, `"interactive_or_unknown"`,
alongside the existing `"interactive_only"` and `"all_sessions"`. Both the
memory and customization scorers set `__universe: "interactive_or_unknown"` on
the wrapped function, so the contract is auditable at runtime the same way
every other scorer's universe already is.

## Counter-class unification: `/focus` and `/rewind` become session-coverage

Before this change, `focusCommandUses` and `rewindCommandUses` incremented
once per *matching message*, while the other five posture counters (`/btw`,
`/clear`, `/compact`, `/voice`, `/color`, plus `/simplify` and
`/fewer-permission-prompts`) incremented once per *session* via a
`sessionHas*` flag flipped on first sighting. The mismatch was a leftover of
when each counter was added rather than an intentional design choice. CCE-76
retrofits `/focus` and `/rewind` onto the same per-session flag pattern in
`scanTranscriptInvocations`, so every posture counter is now a uniform unit —
one hit per session that used the command at least once, capped at the number
of sessions scanned. That uniformity is what makes summing them into a single
ratio numerator defensible in the first place.

## Reading the score

Both scorers report evidence in the same shape:

```
Memory hygiene commands: 23 session-coverage hits across 120 interactive_cli∪unknown sessions (19.17%).
```

When a session fires more than one memory or customization command, the raw
ratio can exceed 100% — a session that both `/clear`s and `/compact`s
contributes one hit to each counter, so it's double-counted in the sum. The
scorer clamps the displayed score to 100 but doesn't hide the overage: when
`rawRatio > 1`, the evidence string appends a `— capped from N% (multiple
memory commands per session)` suffix, so the radar's honesty extends to the
calibration risk, not just the headline number. A true per-session union count
(`sessionsWithAnyMemoryCommand`) would eliminate the double-count outright but
is deferred — it would add new signals rather than just recompute existing
ones.

If `s.insights` is absent, transcripts weren't scanned, or
`interactiveOrUnknownSessionsAnalyzed` is zero, both scorers fall through
`withGates`'s standard gate chain to `unavailable(...)` with the matching
`GAP_REASONS` entry — the same unmeasured-with-a-reason contract every other
Execution scorer uses. On the radar, a dimension only renders italic when its
Execution score's `gapReason !== null`; once a user has any qualifying
session in their lookback window, Memory and Customization render as solid
vertices like everything else.
