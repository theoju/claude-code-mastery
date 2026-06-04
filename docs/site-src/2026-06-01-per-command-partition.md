---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Posture-vs-volume command partition (CCE-71)

The transcript scanner in `scripts/_usage-data.mjs` now applies a formal
**posture-vs-volume partition** when counting slash-command invocations from
`~/.claude/projects/*/*.jsonl`. The change landed in PR #110.

## The problem it solves

An earlier fix tried to exclude `observer`, `sdk_orchestrated`, and `subagent`
sessions wholesale from `scanTranscriptInvocations`. That blanket filter was
architecturally wrong: it stripped genuine autonomous-workflow signal and
regressed the Scheduled Work Execution score from 75 to 63. Commands like
`/loop`, `/schedule`, and `/batch` are _volume_ signals — evidence that
automation is running — and those signals are valid no matter which session kind
emitted them.

The partition draws the right line: filter by session kind _only_ where it
actually matters.

## Two command classes

| Class   | Commands                                                                                               | Counted from                        | Why                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------- |
| Posture | `/color` `/voice` `/focus` `/btw` `/clear` `/compact` `/simplify` `/rewind` `/fewer-permission-prompts` | `interactive_cli` + `unknown` only  | Reflect deliberate user choices; counting SDK/subagent sessions would dilute them. |
| Volume  | `/loop` `/schedule` `/babysit` `/go` `/batch`                                                          | All session kinds                   | Autonomous-workflow signal is real regardless of how the session was spawned.      |

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the
canonical source of truth. Any new command goes into exactly one set.

## Fail-loud guard

`assertCommandPartition` runs at module load. It enforces three invariants:

1. The two sets are disjoint — no command appears in both.
2. Every recognized command is classified — nothing is silently uncounted.
3. No dead classification exists — no entry in either set is unrecognized.

If any invariant fails, the module throws before a single score is computed.
This means a miscategorized command causes `npm run assess` to exit non-zero
with a clear message rather than producing silently wrong numbers.

## Session universe recap

The posture restriction (`interactive_cli ∪ unknown`) matches the denominator
universe declared on posture-ratio scorers via `withGates({ universe:
"interactive_or_unknown" })` in `scripts/score.mjs`. Volume commands use no
session-kind filter, consistent with scorers that use `universe: "all_sessions"`.

The general rule: **a command's counting universe must be a subset of the
scorer's denominator universe** — or the resulting ratio can silently exceed
100%. The partition enforces this at the counting layer so individual scorer
tests don't have to re-verify it.

## Related

- Design spec:
  [`docs/superpowers/specs/`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/)
  (filed under CCE-71)
- Probe tracker:
  [`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-05-25-probe-implementation-status.md)
- Scoring universe rules: [`scripts/score.mjs`](https://github.com/theoju/claude-code-self-assessment/blob/main/scripts/score.mjs) — `withGates` docblock
