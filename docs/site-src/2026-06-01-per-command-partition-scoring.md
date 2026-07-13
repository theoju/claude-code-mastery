---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for transcript scanning (CCE-71)

Observer and SDK-orchestrated sessions echo the primary session's
`<command-name>` markup. Before PR #110, `scanTranscriptInvocations`
(`scripts/_usage-data.mjs`) counted every transcript it walked with no
session-kind filter, so that echoed markup inflated the posture-command
counters — most visibly `/focus`, `/simplify`, and `/rewind` — and silently
corrupted Execution scoring for the affected dimensions.

## The fix: partition commands, not sessions

The earlier v0.9.17 attempt tried the blanket version of this fix —
exclude `observer`, `sdk_orchestrated`, and `subagent` session kinds from
the scanner entirely — and it regressed `scheduled` 75→63 by deleting
genuine `/loop` / `/schedule` autonomous-workflow signal along with the
false positives. That was reverted. The correct shape, landed here, is a
**per-command partition**: gate only the commands whose semantics are
about user posture, and leave commands that represent real
autonomous-workflow volume uncounted.

`scripts/_usage-data.mjs` now declares two disjoint module-level `Set`s:

```js
export const POSTURE_COMMANDS = new Set([
  "color",
  "voice",
  "focus",
  "btw",
  "clear",
  "compact",
  "simplify",
  "rewind",
  "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop",
  "schedule",
  "babysit",
  "go",
  "batch",
]);
```

Inside the per-session loop, each session is classified once via
`classifySessionKind(path)`, and posture commands are only counted when
`sessionKind` is `interactive_cli` or `unknown` (the conservative
fallback for transcripts with no detectable `entrypoint` in their first
five lines):

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Volume-command counters (`goCommandUses`, `batchCommandUses`,
`scheduleCommandUses`, `sessionHasLoop`, `sessionHasBabysit`) stay
unconditional — autonomous-workflow signal is real regardless of which
session kind emitted it.

Two things sit outside the partition by design: `effortMaxCommandUses`
(detected via a regex over the raw prompt text, not `<command-name>`
markup) and `planThenLaunchSessions` (a structural pattern keyed off
`ExitPlanMode` tool_use lookahead). Neither is a slash-command name
`extractSlashCommands` matches, so `assertCommandPartition` doesn't
apply to them.

## Fail-loud drift guard

A boundary assertion runs at module load, before any score is computed:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

It catches three drift cases: the posture/volume sets overlapping, a
`TARGET_COMMANDS` member left unclassified, and a partition member that
isn't actually in `TARGET_COMMANDS` (dead classification). Because this
runs at import time — the top of the `gatherSignals` chain — a violation
aborts the entire `npm run assess` invocation with a stack trace before
`assessment.json` is written. That's intentional: silently miscounting a
posture command is worse than a loud failure. If the LaunchAgent/cron run
exits non-zero with no `assessment.json` written, check stderr for a
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before assuming an
environmental problem.

## What changed in practice

Live verification (`npm run assess --include-transcripts
--insights-lookback 30`) showed `simplifyCommandUses` and
`rewindCommandUses` crossing their thresholds downward — as the spec
predicted, since neither participates in the `history.jsonl` MAX-merge
floor that shields most other posture commands (e.g. `/color`, whose
count is `Math.max`'d against `history.jsonl`, which only contains typed
prompts from interactive sessions). This is the removal of false-positive
inflation, not a scoring regression: the raw counts were never real user
invocations in the first place.

Platform Setup and Execution top-line scores were unchanged by this PR.
Only the raw (uncapped) Terminal & Customization score shifted, from 90
to 85.

## Why `subagent` doesn't need an explicit skip — yet

`classifySessionKind` returns `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`, but the scanner's traversal in
`scanTranscriptInvocations` only reads `projectsRoot/*/*.jsonl` — two
levels deep. Real subagent transcripts live four levels deep, so they're
unreachable from this scanner today, and an explicit
`if (sessionKind === "subagent") continue` would be dead code. It's
documented inline instead: a future traversal that recurses into
subagent directories must add that skip explicitly rather than
inheriting the current omission silently.

## Where this lives

The partition constants and the assertion are canonical in
`scripts/_usage-data.mjs`. CLAUDE.md's Conventions section points here
for anyone auditing command-counting behavior. Test coverage for the
partition (observer/SDK sessions suppressing posture but not volume,
`unknown` falling back to counted, and the four `assertCommandPartition`
drift cases) lives in `scripts/__tests__/_usage-data.test.mjs`.
