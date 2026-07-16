---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition: posture vs. volume commands (CCE-71, PR #110)

Observer and SDK-orchestrated transcript sessions echo the primary
session's `<command-name>` markup. Before this change, `scanTranscriptInvocations`
in `scripts/_usage-data.mjs` counted every `.jsonl` file it walked under
`~/.claude/projects/*/*.jsonl` with no session-kind filter — so a single
user invocation of, say, `/focus` could get double-counted the moment an
observer session quoted it back. That inflated posture-command counters
(`focusCommandUses`, `simplifyCommandUses`, `rewindCommandUses`, and
friends) with false positives that didn't reflect genuine interactive
posture.

This was a known gap. CLAUDE.md carried it as a deferred follow-up after
the v0.9.17 cycle's blanket attempt at a fix — excluding `observer`,
`sdk_orchestrated`, and `subagent` sessions from the scanner entirely —
regressed `scheduled` from 75 to 63 by deleting genuine `/loop` /
`/schedule` autonomous-workflow signal along with the noise. The lesson
from that revert: not all commands behave the same way across session
kinds, so one blanket rule was the wrong shape.

## The fix: classify commands, not sessions

CCE-71 replaces the blanket rule with a **per-command partition**,
implemented directly in `scripts/_usage-data.mjs`:

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

**Posture commands** are only counted from a transcript when
`classifySessionKind(path)` returns `interactive_cli` or `unknown` (the
conservative fallback for a session with no detectable `entrypoint` in
its first 5 lines). **Volume commands** stay unconditional — autonomous
workflow signal is real regardless of which session kind emitted it,
which is exactly the distinction the v0.9.17 blanket fix missed.

Inside the per-session loop, this becomes one classification call and a
gate:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Every posture counter increment is then guarded with `&& allowPosture`;
volume counters (`goCommandUses`, `batchCommandUses`,
`scheduleCommandUses`, `loopCommandUses`, `babysitLoopUses`) are
untouched by the gate. Two counters sit outside the partition entirely
by design: `effortMaxCommandUses` (detected via a regex over the prompt
text, not `<command-name>` markup) and `planThenLaunchSessions`
(a structural pattern off `ExitPlanMode` tool-use lookahead) — neither
is a slash-command name that `extractSlashCommands` matches.

## Fail-loud guard against drift

A new exported function, `assertCommandPartition(posture, volume,
target)`, runs once at module load against the live `POSTURE_COMMANDS`,
`VOLUME_COMMANDS`, and `TARGET_COMMANDS` sets. It catches three drift
cases:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap (not disjoint).
2. A `TARGET_COMMANDS` member isn't classified into either set.
3. A partition member isn't in `TARGET_COMMANDS` — dead classification.

Because it fires at import time (which happens at the top of the
assessment chain), a partition drift error means `npm run assess` aborts
before any score is written — no `assessment.json`, no Slack post. That's
intentional: silently miscounting is worse than a loud crash. If a
scheduled run turns up missing `assessment.json`, check stderr for a
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` error before assuming an
environmental problem.

## Why `unknown` counts as posture-eligible

`classifySessionKind` reads up to the first five lines of a transcript
looking for a recognized `entrypoint`. `cli` and `claude-desktop` map to
`interactive_cli`; `sdk-cli` maps to `observer` (path contains
`observer-sessions`) or `sdk_orchestrated`; anything else falls through
to `unknown`. Treating `unknown` as posture-eligible is a deliberate
conservative choice — a transcript with no detectable entrypoint in its
first five lines is more likely a legitimate interactive session
(predating entrypoint tracking, or an edge-case transcript shape) than a
hostile observer echo.

One traversal detail worth knowing: `classifySessionKind` can also
return `subagent` for paths matching `.../subagents/agent-*.jsonl`, but
`scanTranscriptInvocations`'s directory walk only reads
`projectsRoot/*/*.jsonl` — two levels deep. Subagent transcripts live
three levels deeper, so they're unreachable from this scanner today.
There's no explicit `subagent` skip in the loop as a result; the code
comments flag that a future traversal change adding recursion needs to
add one.

## What this doesn't change

- Command counting stays in `_usage-data.mjs`; `POSTURE_COMMANDS` /
  `VOLUME_COMMANDS` are now the canonical source of truth for the
  posture-vs-volume split, referenced from CLAUDE.md's Hard Rules.
- No new probes, catalog entries, or `signalsSummary` keys were added —
  this is an accuracy refinement of existing transcript-derived signals,
  not new coverage.
- The `Math.max(transcript, history.jsonl)` merge in
  `run-assessment.mjs` for commands like `/color` (which also appear in
  `~/.claude/history.jsonl`) is unaffected; it still takes the higher of
  the two conservative counts.

Net effect: posture-command counts trend down or stay flat wherever
observer/SDK echo noise was present, while volume-command counts
(`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) are unchanged — the
regression class that sank the v0.9.17 attempt doesn't recur here.
