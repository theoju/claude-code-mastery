---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for posture vs. volume commands

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session for the Execution-axis scorers. As of PR #110, that count is no
longer unconditional — it's split into two named sets, and one of them is
gated on session kind.

## The problem

Observer sessions (which monitor a primary session's work and emit
structured observations) and SDK-orchestrated sessions echo the primary
session's `<command-name>cmd</command-name>` markup in their own
transcripts. A naive scan over every `.jsonl` file double-counts every
command that was actually a single user invocation, inflating
posture-based Execution ratios.

A prior attempt (v0.9.17) fixed this with a blanket exclusion — drop
`observer`, `sdk_orchestrated`, and `subagent` sessions from
`scanTranscriptInvocations` entirely. That regressed the `scheduled`
dimension 75→63 because it deleted genuine `/loop` and `/schedule`
autonomous-workflow signal that legitimately fires from non-interactive
sessions. It was reverted.

## The fix: partition by command, not by scanner

`scripts/_usage-data.mjs` now defines two disjoint module-level sets:

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

Inside the per-session scan loop, `classifySessionKind(path)` runs once per
transcript and produces `allowPosture = sessionKind === "interactive_cli" ||
sessionKind === "unknown"`. Posture-command counters are gated behind
`allowPosture`; volume-command counters stay unconditional — they count
across every scanned session kind, exactly as before. `"unknown"` (the
classifier's conservative fallback when no `entrypoint` field turns up in
the first 5 lines of a transcript) is treated as posture-eligible: a
session with no detectable entrypoint is more likely a legitimate
interactive session predating entrypoint tracking than a hostile observer
transcript.

Two commands sit outside the partition entirely: `effortMaxCommandUses`
(detected via a regex over the raw prompt text, not `<command-name>`
markup) and `planThenLaunchSessions` (a structural pattern keyed off an
`ExitPlanMode` tool_use, not a slash command at all). Neither is a member
of `TARGET_COMMANDS`, so the boundary assertion below doesn't apply to
them.

## The fail-loud guard

`assertCommandPartition(posture, volume, target)` runs once at module
load and checks three invariants against `TARGET_COMMANDS` (the canonical
scanned-command set):

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint.
2. Every member of `TARGET_COMMANDS` is classified as posture or volume
   (catches a newly-scanned command that nobody categorized).
3. Every partitioned command is still in `TARGET_COMMANDS` (catches dead
   classification — a command removed from scanning but left in the
   partition).

If any check fails, the module throws at import time — before any score
is written. That means a partition-drift bug takes down the whole
`npm run assess` run rather than silently under- or over-counting. If the
LaunchAgent/cron invocation exits non-zero with no `assessment.json`
written, check stderr for a `POSTURE_COMMANDS` / `VOLUME_COMMANDS`
partition error before assuming an environmental issue.

## Why this shape and not the blanket exclusion

The posture/volume split already existed as a documented convention in
CLAUDE.md before this PR — the code just didn't enforce it. Posture
commands (`/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`,
`/simplify`, `/rewind`, `/fewer-permission-prompts`) represent something
about how the *user* is configuring their own session — echoed markup from
an unrelated observer transcript isn't a real signal. Volume commands
(`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) represent
autonomous-workflow activity that's real regardless of which session kind
fired it — a `/loop` invoked from an SDK-orchestrated run is still genuine
`/loop` usage. Filtering both classes the same way, as v0.9.17 did, throws
away the second category's signal to fix the first category's noise.

## Known gap: subagent transcripts aren't reachable here

`classifySessionKind` can return `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`, but the scanner's traversal in
`scanTranscriptInvocations` only reads `projectsRoot/*/*.jsonl` — two
levels deep. Subagent transcripts live at
`projects/<project>/<session-uuid>/subagents/agent-*.jsonl`, three levels
deeper, so they're unreachable from this scanner today. There's
deliberately no `if (sessionKind === "subagent") continue` guard — it
would be dead code under the current traversal. The `_usage-data.mjs`
source comments this explicitly so that a future change adding recursive
traversal doesn't silently reintroduce inheritance noise from subagent
sessions without adding that guard.

## Where to look

- `scripts/_usage-data.mjs` — `POSTURE_COMMANDS`, `VOLUME_COMMANDS`,
  `assertCommandPartition`, and the gated counters inside
  `scanTranscriptInvocations`.
- `scripts/__tests__/_usage-data.test.mjs` — fixture-backed coverage for
  observer/SDK/interactive/unknown session kinds crossed with posture vs.
  volume commands, plus direct tests of `assertCommandPartition` against
  forged sets.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` —
  the living probe tracker, annotated with a footnote on the posture-command
  rows noting they now honor the session-kind partition.
