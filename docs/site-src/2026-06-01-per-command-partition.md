---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Per-command partition for transcript slash-command counting

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session, feeding the Execution-axis command counters (`colorCommandUses`,
`btwCommandUses`, `loopCommandUses`, and friends). As of PR #110, that
counting is split into two disjoint classes — **posture** commands and
**volume** commands — each with different session-eligibility rules.

## The problem this fixes

Observer sessions (which watch a primary session and emit structured
observations) and SDK-orchestrated sessions frequently echo the primary
session's `<command-name>cmd</command-name>` markup. A naive scan counts
that echoed markup as a real invocation, inflating posture-command
counters like `colorCommandUses` and `btwCommandUses` for commands the
user never actually typed in that session.

A prior fix attempt took the blanket approach: exclude `observer`,
`sdk_orchestrated`, and `subagent` session kinds from
`scanTranscriptInvocations` entirely. That regressed the `scheduled`
dimension score from 75 to 63, because it also deleted genuine
autonomous-workflow signal — `/loop` and `/schedule` invocations fired
from SDK-orchestrated sessions are real usage, not noise, regardless of
which session kind emitted them. That attempt was reverted.

## The fix: partition by command, not by session

`scripts/_usage-data.mjs` now declares two module-level `Set`s over the
canonical `TARGET_COMMANDS`:

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

Posture commands are the ones that reflect a **user-settable session
posture** — toggling focus mode, adjusting permission friction, clearing
context. Volume commands represent **autonomous-workflow activity** that's
real regardless of which session kind fired it.

Inside the per-session loop, `scanTranscriptInvocations` calls
`classifySessionKind(path)` once per transcript and gates posture-command
counters behind the result:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`allowPosture` is true for `interactive_cli` sessions and for the
conservative `"unknown"` fallback (a transcript with no recognizable
`entrypoint` field in its first five lines) — the reasoning is that an
unclassifiable session is more likely a legitimate interactive session
predating entrypoint tracking than a hostile observer transcript. It's
false for `observer` and `sdk_orchestrated`.

Volume-command counters (`goCommandUses`, `batchCommandUses`,
`scheduleCommandUses`, `loopCommandUses`, `babysitLoopUses`) stay
unconditional — they're counted regardless of `allowPosture`, across
every session kind the scanner sees. `effortMaxCommandUses` and
`planThenLaunchSessions` sit outside the partition entirely: they're
detected by regex-over-prompt-text and structural tool-use lookahead
respectively, not by `extractSlashCommands`, so the partition's
disjointness rules don't apply to them.

## Fail-loud drift guard

Because `POSTURE_COMMANDS`, `VOLUME_COMMANDS`, and `TARGET_COMMANDS` are
maintained by hand, a fourth export — `assertCommandPartition` — runs at
module load and throws if any of three invariants breaks:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap (not disjoint).
2. A `TARGET_COMMANDS` member isn't classified into either set.
3. A partition member isn't in `TARGET_COMMANDS` (dead classification —
   the command is being categorized but never actually scanned).

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

This runs unconditionally at import time, which means the check fires
the moment anything in the assessment chain imports `_usage-data.mjs` —
before `gatherSignals` does any work. If the assertion throws, the whole
`npm run assess` invocation aborts with a stack trace: no
`assessment.json` is written, no Slack post fires, no dashboard update
happens. That's intentional — silently miscounting is worse than a loud
crash — but it means an operator running the LaunchAgent/cron job who
sees a missing `assessment.json` should check stderr for a
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before assuming an
environmental problem.

## Why `"unknown"` counts as posture-eligible

`classifySessionKind` reads up to the first five lines of a transcript
looking for an `entrypoint` field:

- `entrypoint === "cli"` or `"claude-desktop"` → `"interactive_cli"`
- `entrypoint === "sdk-cli"` → `"observer"` (if the path is under
  `observer-sessions/`) or `"sdk_orchestrated"` otherwise
- no recognizable entrypoint in the first five lines → `"unknown"`
- path matches `/subagents/agent-*` → `"subagent"` (checked before the
  line scan; today unreachable from `scanTranscriptInvocations`'s
  traversal — see below)

Treating `"unknown"` as posture-eligible (alongside `interactive_cli`) is
a deliberate conservative choice: a session with no detectable entrypoint
is assumed to be a legitimate interactive session rather than assumed
hostile.

## Subagent sessions are unreachable today, not excluded

`classifySessionKind` does return a `"subagent"` kind for paths matching
`.../subagents/agent-*.jsonl`, but `scanTranscriptInvocations`'s file
traversal only reads `projectsRoot/*/*.jsonl` — exactly two path
segments deep. Real subagent transcripts live four segments deep
(`projects/<project>/<session-uuid>/subagents/agent-*.jsonl`), so the
current scanner never encounters them, and there's no explicit
`if (sessionKind === "subagent") continue` guard. If a future change adds
recursive traversal to pick up subagent transcripts, that change needs to
add the skip explicitly rather than inherit this scanner's current
silent assumption.

## What downstream consumers should know

- `buildSignalsSummary` and the history-file `Math.max` merge in
  `run-assessment.mjs` are unchanged by this partition — it only affects
  what `scanTranscriptInvocations` counts before those values reach the
  merge step.
- Expect posture-command counts (`color`, `btw`, `voice`, `clear`,
  `compact`, `simplify`, `fewer-permission-prompts`, `focus`, `rewind`)
  to trend down or stay flat wherever observer/SDK markup was previously
  inflating them. Volume-command counts (`schedule`, `go`, `batch`,
  `loop`, `babysit`) are unaffected.
- `/rewind` is the one posture command with no `history.jsonl` floor to
  fall back on (it's a keyboard shortcut, not something
  `HISTORY_COMMAND_LIST` tracks), so it's the counter most exposed to a
  post-partition drop. If you're auditing a score change after this
  lands, check `rewindCommandUses` first.
- The five machine-enforced probe-tracker header counts (75 tips / 12
  dimensions / 48 next-actions / 47 probe-catalog entries / 71
  `signalsSummary` keys) are unchanged by this PR — no new probes,
  catalog entries, or summary keys were added. This is a counting-accuracy
  fix on existing signals, not new coverage.

## Tests

`scripts/__tests__/_usage-data.test.mjs` covers the partition directly:
posture commands in observer and SDK-orchestrated sessions don't count;
volume commands in the same session kinds do; posture commands in
interactive and unknown-entrypoint sessions do count; and
`assertCommandPartition` is exercised against forged `Set`s for all three
drift cases (disjointness violation, uncategorized `TARGET_COMMANDS`
member, dead classification) plus the happy path against the live sets.
