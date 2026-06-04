---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution scorers (CCE-76)

**PR #116** completes full Execution coverage across all twelve scoring
dimensions. Before this change, Memory & Context Management and Terminal &
Customization were the only two dimensions whose Execution scorers returned
`noTelemetryData` stubs — they showed italic labels and a `¹` footnote on the
radar, signalling that no signal fed them rather than silently scoring zero.
Those stubs are now replaced with real posture-command coverage scorers.

## What the scorers measure

Both new scorers follow the same pattern as the existing `learning`
(★ Insight banner) and `parallel` (worktree usage) Execution scorers: they
count how many qualifying sessions contain at least one invocation of a
designated posture command, then divide by the total qualifying-session count
to produce a coverage ratio.

| Dimension | Commands counted |
|---|---|
| Memory & Context Management | `/btw`, `/clear`, `/compact`, `/rewind` |
| Terminal & Customization | `/color`, `/voice`, `/focus`, `/simplify`, `/fewer-permission-prompts` |

These commands are part of the `POSTURE_COMMANDS` set in
`scripts/_usage-data.mjs`. The boundary assertion `assertCommandPartition`
(run at module load) enforces disjointness with `VOLUME_COMMANDS` and catches
any future drift.

## Session universe gating

Posture signals only make sense in sessions you actively drive. Both scorers
restrict their denominator to the `interactive_cli ∪ unknown` session universe
— the same gate used by the Memory Execution ratio (CCE-78) and the
plan-mode posture scorer. `sdk_orchestrated`, `observer`, and `subagent`
sessions run with SDK defaults and would silently dilute the numerator if
included.

The `withGates({ universe: "interactive_or_unknown" })` constructor enforces
this at score-build time. If the session universe is empty (zero qualifying
sessions in the scoring window), the scorer sets `gapReason` rather than
scoring zero, and the radar continues to render the dimension as
italic-unmeasured.

## Radar effect

After this PR, `gapReason !== null` applies only to dimensions that genuinely
have no Execution signal in the current window — it no longer applies
unconditionally to Memory and Customization. If you have qualifying interactive
sessions in the lookback window and have invoked any of the commands above, the
radar renders those vertices with solid labels at real scores rather than italic
stubs.

The methodology page (`/methodology`) reflects the updated scorer breakdown.

## Related

- CCE-71 — introduced the transcript-derived posture-command coverage counters
  that this PR's scorers consume.
- CCE-78 — fixed the `/btw` blend that was mixing cumulative all-time counts
  into a 30-day windowed ratio; landed in v0.9.18 alongside the Memory
  Execution scorer redesign.
- CCE-79 — follow-up redesign for per-field semantics in the Memory Execution
  scorer (filed; not yet landed).
