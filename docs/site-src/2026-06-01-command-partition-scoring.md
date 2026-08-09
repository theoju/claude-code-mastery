---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Command counting splits posture from volume

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl`
and counts slash-command occurrences per session, feeding the Execution-axis
command counters (`colorCommandUses`, `btwCommandUses`, `loopCommandUses`, and
friends). PR #110 closed a real gap in that counting: some of those counters
could be inflated by sessions that never represented the user typing the
command themselves.

## The problem

Observer sessions (which monitor a primary session's work and emit structured
observations) and SDK-orchestrated sessions frequently echo the primary
session's `<command-name>cmd</command-name>` markup in their own transcripts.
Before this change, `scanTranscriptInvocations` counted every transcript it
scanned with no session-kind filter, so that echoed markup got counted as if
the observer or SDK session itself had invoked the command — quietly
inflating posture counters like `/color`, `/btw`, and `/clear`.

A prior attempt at a fix (v0.9.17) went too far: it excluded `observer`,
`sdk_orchestrated`, and `subagent` sessions from the scanner entirely. That
regressed the `scheduled` dimension score from 75 to 63, because it also
deleted genuine `/loop` and `/schedule` signal — autonomous-workflow commands
that are meaningful evidence of use regardless of which session kind fired
them. That blanket fix was reverted.

## The fix: a per-command partition

PR #110 replaces the blanket exclusion with a partition declared as two
module-level `Set`s in `scripts/_usage-data.mjs`:

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

Inside the per-session loop, `scanTranscriptInvocations` now calls
`classifySessionKind(path)` once per transcript and computes:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters are gated behind `allowPosture`; volume-command
counters stay unconditional, counted across every session kind the scanner
sees. The rationale is the same distinction CLAUDE.md documents: posture
commands (`/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`,
`/simplify`, `/rewind`, `/fewer-permission-prompts`) reflect a setting the
user chose for their own session and shouldn't be credited from a session
that merely echoed it. Volume commands (`/loop`, `/schedule`, `/babysit`,
`/go`, `/batch`) represent autonomous-workflow signal that's real no matter
which session kind emitted it.

`"unknown"` is treated as eligible for posture counting, alongside
`interactive_cli` — the conservative read is that a session with no
detectable `entrypoint` in its first five lines is more likely a legitimate
interactive session predating entrypoint tracking than a disguised observer
transcript.

Two signals sit outside the partition entirely, by design: `effortMaxCommandUses`
(detected via `hasEffortMax()`, a regex over the prompt text rather than
`<command-name>` markup) and `planThenLaunchSessions` (a structural pattern
detected from an `ExitPlanMode` tool_use lookahead). Neither is a
slash-command name matched by `extractSlashCommands`, so the posture/volume
classification doesn't apply to them.

## The guard against drift

`assertCommandPartition(posture, volume, target)` runs at module load and
fails loudly if any of three invariants breaks:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap (not disjoint).
2. A member of `TARGET_COMMANDS` (the canonical scanned command set) isn't
   classified into either Set.
3. A member of the posture/volume union isn't in `TARGET_COMMANDS` — dead
   classification.

Because this runs at import time, a partition drift crashes the entire
`npm run assess` invocation before any score is written — no `assessment.json`,
no Slack post. That's intentional: silently miscounting is worse than failing
loudly. If the LaunchAgent/cron `npm run assess` exits non-zero with no
`assessment.json` written, check stderr for a `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` partition error before assuming an environmental issue.

## What this means if you're adding a command

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the
canonical source of truth for this split. Adding a new command to
`TARGET_COMMANDS` without classifying it into one of the two Sets will crash
the assessment at module load via `assertCommandPartition` — that's the
signal to go classify it, not a bug to work around.

One structural note if the scanner ever grows a recursive directory walk:
`classifySessionKind` already returns `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`, but the scanner's current traversal only reads
`projectsRoot/*/*.jsonl` (two levels deep) while subagent transcripts live
four levels deep — so subagent sessions are unreachable from this scanner
today, and there's no explicit skip for that kind in the per-session loop. A
future traversal change that recurses into subagent directories needs to add
that skip explicitly rather than assume it's already handled.
