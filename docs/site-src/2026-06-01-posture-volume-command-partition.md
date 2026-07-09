---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: partition posture commands from volume commands in transcript scanning

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session. As of PR #110, it no longer counts every session kind the same
way. Commands are split into two disjoint sets, and one of them is gated
by session kind before it's allowed to increment a counter.

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

## The problem this fixes

Observer sessions (which watch a primary session and emit structured
observations) and SDK-orchestrated sessions echo the primary session's
`<command-name>cmd</command-name>` markup into their own transcripts. Before
this fix, `scanTranscriptInvocations` had no session-kind filter at all — it
counted every `.jsonl` file under `~/.claude/projects/`, so a single user
invocation of `/color` or `/btw` could be double- or triple-counted if an
observer session was also watching. That inflates the Execution-axis
posture ratios (permissions, memory, terminal/customization) with counts
that don't reflect a real user choice — the observer session didn't decide
to run `/color`, it just quoted the primary session's transcript.

This had been a documented "known limitation / deferred follow-up" in
CLAUDE.md since the v0.9.16 cycle, where `/color` was patched around rather
than fixed: `colorCommandUses` got MAX-merged against `~/.claude/history.jsonl`
(which only holds typed prompts from interactive sessions), masking the
false positive for that one command without touching the underlying scan.

A v0.9.17 attempt at a real fix went too broad — it excluded `observer`,
`sdk_orchestrated`, and `subagent` sessions from the scan entirely — and
regressed the `scheduled` dimension from 75 to 63 by deleting genuine
`/loop` and `/schedule` signal. Autonomous-workflow commands fired from a
non-interactive session are still real evidence of autonomous-workflow
usage; only the *posture* commands are meaningless outside an interactive
context. That PR was reverted.

## The fix: gate posture, not volume

Every session the scanner visits gets classified once via
`classifySessionKind(path)`, which returns `"interactive_cli"`,
`"sdk_orchestrated"`, `"observer"`, `"unknown"`, or `"subagent"` (the last
is unreachable from this scanner's current two-level traversal — see the
inline comment at `scripts/_usage-data.mjs:290-298`). From that:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters (`sessionHasColor`, `sessionHasBtw`,
`sessionHasFocus`, and so on) only flip when `allowPosture` is true. Volume
commands (`goCommandUses`, `batchCommandUses`, `scheduleCommandUses`,
`sessionHasLoop`, `sessionHasBabysit`) stay unconditional, counted across
every session kind the scanner sees, exactly as before.

`"unknown"` is treated as posture-eligible on purpose. `classifySessionKind`
falls through to `"unknown"` when it can't find a recognized `entrypoint`
field in a transcript's first five lines — the conservative read is that a
session with no detectable entrypoint predates entrypoint tracking and is
more likely a legitimate interactive session than a hostile observer
transcript.

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside the
partition entirely — they're detected structurally (a regex over prompt
text, and an `ExitPlanMode` lookahead), not via `extractSlashCommands`, so
neither Set claims them.

## Fail-loud drift protection

`assertCommandPartition` runs once at module load and throws if any of
three invariants break:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap.
2. A member of `TARGET_COMMANDS` (the canonical scanned set) isn't
   classified into either partition.
3. A partition member isn't in `TARGET_COMMANDS` — dead classification.

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

Because this fires at import time — before `gatherSignals` runs — a
partition-drift bug aborts the entire `npm run assess` invocation with a
stack trace instead of silently miscounting. No `assessment.json` gets
written and no Slack post goes out. If a LaunchAgent or cron run of
`npm run assess` exits non-zero with no `assessment.json`, check stderr for
a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before assuming an
environmental problem — this is the same operational note CLAUDE.md now
carries under Hard rules.

## What downstream consumers should expect

- Posture-command counts (`color`, `voice`, `btw`, `clear`, `compact`,
  `simplify`, `focus`, `rewind`, `fewer-permission-prompts`) trend down or
  flat after this lands, wherever observer/SDK echo was inflating them. The
  existing MAX-merge against `~/.claude/history.jsonl` (`run-assessment.mjs`)
  is unchanged and keeps most posture scorers stable — `/color` was already
  covered by that floor.
- `/rewind` has no `history.jsonl` floor (it's a keyboard shortcut, not a
  typed prompt), so it's the one posture command most exposed to a real
  count drop from this change.
- Volume-command counts (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
  are unaffected — this was the exact signal the reverted v0.9.17 attempt
  destroyed, and this fix is structured specifically to preserve it.
- No new probes, catalog entries, or `signalsSummary` keys were added. The
  probe-tracker spec (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
  is annotated to note that posture-command rows in the Transcripts layer
  now honor the `interactive_cli ∪ unknown` gate; the five CI-enforced
  header counts didn't change.

## Source of truth

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are
canonical. If you're adding a new slash command to `TARGET_COMMANDS`, you
must also add it to exactly one of the two partition Sets — the module-load
assertion will refuse to let you forget.
