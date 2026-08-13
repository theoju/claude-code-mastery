---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Command partition scoring

The scorer reads slash-command usage straight from `~/.claude/projects/*/*.jsonl`
transcripts, and transcripts aren't only produced by the session you typed
into. Observer sessions and SDK-orchestrated sessions both echo the primary
session's `<command-name>` markup as part of how they record what happened —
which means a single `/color` invocation in your interactive terminal could
show up two or three times across the transcript set. `scanTranscriptInvocations`
in `scripts/_usage-data.mjs` now resolves this with a **posture-vs-volume
partition**: two disjoint command sets that get counted under different
rules, gated by a fail-loud assertion so the classification can't silently
drift out of sync with the commands actually being scanned.

## Why a blanket fix doesn't work

The obvious fix — stop scanning `observer` / `sdk_orchestrated` / `subagent`
sessions altogether — was already tried and already reverted. It regressed
the `scheduled` dimension from 75 to 63 by deleting real `/loop` and
`/schedule` signal: autonomous-workflow commands genuinely fire from
SDK-orchestrated contexts, and that's not noise, it's the point of those
commands. The false positive is specific to a narrower class of commands —
the ones that express a **user's interactive posture** (did you turn on
focus mode, did you compact your context, did you invoke `/rewind`) — not
to command usage in general. Excluding non-interactive sessions wholesale
throws out real signal to fix a problem that only affects part of the
signal.

## The partition

Two module-level `Set`s in `scripts/_usage-data.mjs` classify every command
in `TARGET_COMMANDS`:

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

**Posture commands** are only counted when the emitting session's kind
resolves to `interactive_cli` or the `unknown` fallback. **Volume commands**
are counted across every session kind the scanner sees, unconditionally —
the same as before this change.

The session kind comes from `classifySessionKind()`, which reads up to the
first five lines of a transcript looking for an `entrypoint` field:
`"cli"` or `"claude-desktop"` resolve to `interactive_cli`; `"sdk-cli"`
resolves to `observer` (if the path is under `observer-sessions`) or
`sdk_orchestrated` otherwise; anything else — no recognized entrypoint in
the first five lines — falls through to `"unknown"`. `"unknown"` is treated
as posture-eligible deliberately: a transcript with no detectable
entrypoint reads as more likely a legitimate interactive session predating
entrypoint tracking than a hostile observer echo, so the gate errs toward
counting it rather than dropping it.

Inside `scanTranscriptInvocations`, the gate looks like this per session:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command hits then only flip their per-session flag
(`sessionHasFocus`, `sessionHasBtw`, `sessionHasClear`, and so on) when
`allowPosture` is true, while volume commands (`goCommandUses`,
`batchCommandUses`, `scheduleCommandUses`, `sessionHasLoop`,
`sessionHasBabysit`) increment regardless of session kind.

One command sits outside the partition entirely: `effortMaxCommandUses`
is detected via `hasEffortMax()`, a regex over the raw prompt text rather
than the `<command-name>` markup `extractSlashCommands` matches against, so
it isn't a member of either `POSTURE_COMMANDS` or `VOLUME_COMMANDS` and the
boundary assertion below doesn't apply to it. Same for
`planThenLaunchSessions` — it's a structural pattern (an `ExitPlanMode`
tool_use followed by a real assistant turn), not a slash-command name.

## The fail-loud guard

`assertCommandPartition(posture, volume, target)` runs once at module load
against the live `POSTURE_COMMANDS` / `VOLUME_COMMANDS` / `TARGET_COMMANDS`
sets, and checks three invariants:

1. **Disjointness** — posture and volume don't overlap.
2. **No uncategorized command** — every member of `TARGET_COMMANDS` (the
   canonical set the scanner matches against) is classified as posture or
   volume.
3. **No dead classification** — every posture or volume member is actually
   in `TARGET_COMMANDS`, catching the inverse drift (a command classified
   but never scanned for).

Because this runs at import time, adding a new command to `TARGET_COMMANDS`
without classifying it — or classifying a command that isn't scanned —
aborts `npm run assess` before any score is written, with no
`assessment.json` produced and no Slack post sent. If the LaunchAgent or a
cron-triggered run exits non-zero with no `assessment.json` written, check
stderr for a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` error before assuming
an environmental problem.

## Real-world impact

Live verification against real transcript data showed some posture
counters dropping substantially once observer/SDK inflation was removed —
`focusCommandUses` went from 15 down to 1 for one sampled account. That's
expected: the partition is specifically removing echoed markup that never
represented a distinct user action, not real usage. Volume commands
(`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) are unaffected by
design, since the whole point of preserving them unconditionally is that
autonomous-workflow signal from non-interactive sessions is real.

Most posture-command counters that also have a `history.jsonl`-derived
floor (via the `Math.max(transcript, history)` merge in
`run-assessment.mjs`) stay stable even after a transcript-side drop,
because `history.jsonl` only records typed prompts from interactive
sessions in the first place. `/rewind` is the one posture command with no
such floor — it's driven by a keyboard shortcut, not a line in
`history.jsonl` — so it's the counter most exposed to a real drop from this
change.

## Where it lives

- `scripts/_usage-data.mjs` — `POSTURE_COMMANDS`, `VOLUME_COMMANDS`,
  `assertCommandPartition`, and the `allowPosture` gate inside
  `scanTranscriptInvocations`.
- `scripts/__tests__/_usage-data.test.mjs` — fixtures covering posture
  commands in observer and SDK-orchestrated sessions (must not count),
  volume commands in the same session kinds (must count), posture commands
  in interactive and unknown-entrypoint sessions (must count), and direct
  tests of `assertCommandPartition` against forged sets for all three
  drift cases.
- The Memory & Context Management and Terminal & Customization Execution
  scorers are the consumers that benefit most directly — both rely on
  accurate per-session posture-command coverage as their numerator, per
  the `interactive_cli ∪ unknown` gating this partition enforces.

This closes a "Known limitation / deferred follow-up" that had been
sitting in the project's memory file since the posture-vs-volume split was
first identified as correct-but-unimplemented; the partition is now
enforced at the scanner boundary rather than documented as a constraint a
future change could violate silently.
