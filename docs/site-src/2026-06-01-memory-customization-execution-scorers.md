---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Decision: Memory & Customization Execution Scorers (CCE-76)

PR #116 closed the last measurement gap in the Execution axis. Before this
change, the Memory & Context Management and Terminal & Customization dimensions
routed to `noTelemetry()` stubs — the radar rendered their Execution vertices
as italic/unmeasured rather than scoring them. All twelve Execution scorers now
return numeric scores.

## What was wrong

The two dimensions were stubbed out because the underlying command counters
(`/btw`, `/clear`, `/compact`, `/rewind`, `/focus`, `/color`, `/voice`) were
either not gathered from transcripts at all, or gathered with the wrong
semantics. Specifically:

- `focusCommandUses` and `rewindCommandUses` were per-message invocation
  counts rather than per-session-coverage counts. Every other posture
  counter (`/btw`, `/clear`, `/compact`) was already session-coverage.
  Mixing them in a ratio numerator would violate the counter-class
  semantic partition.
- There was no session universe that correctly enclosed both
  `interactive_cli` and `unknown`-classified sessions. Posture commands
  are gated at transcript-scan time to those two session kinds; the
  existing `interactive_cli`-only universe would make the denominator
  narrower than the numerator's actual data source.

## What changed

**New session universe: `interactive_or_unknown`**

A new denominator signal, `interactiveOrUnknownSessionsAnalyzed`, counts
sessions classified as `interactive_cli` or `unknown` (161 sessions in the
reference run = `sessionsByKind.interactive_cli + sessionsByKind.unknown`).
Both Memory and Customization Execution scorers use
`withGates({ transcripts: true, universe: "interactive_or_unknown" })`.

This satisfies the CLAUDE.md hard rule (established in PR #97 / v0.9.17):
a ratio's numerator must be a strict subset of its denominator's universe.
Posture commands are scanned only from `interactive_cli ∪ unknown` sessions,
so the denominator must span exactly that universe.

**Counter-class unification**

`focusCommandUses` and `rewindCommandUses` were rewritten from per-message
invocation counts to per-session-coverage counts before joining the ratio
numerator. This matches the canonical pattern for `/btw`, `/clear`, and
`/compact`. All seven posture counters now share the same semantic class:
_deduplicated session coverage_ — at most one credit per session regardless
of how many times the command fired within it.

| Counter | Dimension | Before | After |
|---|---|---|---|
| `focusCommandUses` | Customization | per-message invocations | per-session coverage |
| `rewindCommandUses` | Memory | per-message invocations | per-session coverage |
| `/btw`, `/clear`, `/compact`, `/color`, `/voice` | both | per-session coverage | unchanged |

**Scorer implementation**

Both dimensions use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.
Their numerators sum the session-coverage counters for the relevant command
subset:

- **Memory Execution**: `/clear + /compact + /rewind` coverage sessions ÷ `interactiveOrUnknownSessionsAnalyzed`
- **Customization Execution**: `/color + /voice + /focus` coverage sessions ÷ `interactiveOrUnknownSessionsAnalyzed`

## Score impact

The Execution composite dropped from 77 → 66 on the reference machine. That
is the expected and correct outcome. The two dimensions had been excluded from
the composite average while routing through `noTelemetry()`; their actual
scores (Memory ex 16, Customization ex 3) are low, which correctly drags the
average down. This is honest measurement, not a regression in usage — the
usage was always low, just previously hidden.

## What remains partially measured

Model & Effort Tuning is the only Execution dimension that is still partially
measured: the Opus-usage half is scored from transcripts, but effort level
stays settings-only (a Platform Setup signal). Its Execution scorer returns
a numeric score, but the `gapReason` field is non-null for the effort-level
half. The radar uses italic labels + ¹ footnote only for dimensions where
`gapReason !== null`.

## Related

- Hard rule reference: CLAUDE.md §"Verify denominator semantics for every ratio scorer"
- Hard rule reference: CLAUDE.md §"Per-field semantic categorization before adding to any numerator"
- Counter-class partition: `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `scripts/_usage-data.mjs`
- Upstream design spec: `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md` (CCE-79 follow-up)
