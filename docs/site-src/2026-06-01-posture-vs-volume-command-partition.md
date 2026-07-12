---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Posture vs. volume: partitioning transcript command counters (CCE-71)

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks every
`~/.claude/projects/*/*.jsonl` transcript and counts slash-command
occurrences. Until PR #110, it counted every session it could see — including
`observer` sessions (which watch a primary session and echo its work) and
`sdk_orchestrated` sessions. Observer transcripts in particular replicate the
primary session's `<command-name>cmd</command-name>` markup verbatim, so a
single real `/color` invocation could show up twice: once in the primary
session, once in its observer's transcript. That inflated posture-style
counters like `colorCommandUses`, `btwCommandUses`, and `focusCommandUses`
without the user having done anything twice.

This was a known, deferred gap. CLAUDE.md's "Corollary" rules on session-kind
gating already said posture ratios must restrict their denominator to
`interactive_cli`, and the v0.9.17 cycle had already tried (and reverted) a
blanket fix — excluding `observer`/`sdk_orchestrated`/`subagent` from the
scanner entirely regressed `scheduled` from 75 to 63, because that blanket
exclusion also deleted genuine `/loop` and `/schedule` autonomous-workflow
signal fired from those session kinds. The correct fix needed to be
**per-command**, not per-scanner.

## The partition

`_usage-data.mjs` now declares two disjoint, module-level command sets:

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

The distinction: **posture** commands are user-behavior signals — did *you*
set a color, phrase a `/btw`, hit `/clear`? Volume commands represent
autonomous-workflow throughput — did a `/loop` or `/schedule` run, regardless
of which session kind fired it? An SDK-orchestrated run genuinely scheduling
work is real signal; an SDK-orchestrated run's observer *echoing* that a
human typed `/color` is not.

`effortMax` detection and `planThenLaunchSessions` sit outside the partition
entirely — they aren't matched via `extractSlashCommands` at all.
`effortMax` is detected by a regex over the raw prompt text
(`hasEffortMax`), and `planThenLaunchSessions` is a structural pattern (an
`ExitPlanMode` tool_use followed by a real assistant turn), not a
slash-command name. Neither belongs in `POSTURE_COMMANDS` or
`VOLUME_COMMANDS`, and the boundary assertion (below) only checks
`TARGET_COMMANDS`, so it correctly leaves both alone.

## Session-kind gating

Per session, the scanner now calls `classifySessionKind(path)` once, which
reads up to the first five lines of the transcript for an `entrypoint`
field and returns one of `"interactive_cli"`, `"sdk_orchestrated"`,
`"observer"`, `"subagent"`, or the fallback `"unknown"`. From that:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters (`sessionHasColor`, `sessionHasBtw`,
`sessionHasFocus`, etc.) only flip when `allowPosture` is true. Volume
counters (`goCommandUses`, `batchCommandUses`, `scheduleCommandUses`,
`sessionHasLoop`, `sessionHasBabysit`) stay unconditional, exactly as before.

`"unknown"` is deliberately treated as posture-eligible, not excluded. The
reasoning: a transcript with no detectable `entrypoint` in its first five
lines is more likely a legitimate interactive session predating entrypoint
tracking than a hostile observer echo — so the conservative choice is to
keep counting it, not to zero it out.

One subtlety worth knowing if you touch the traversal logic:
`classifySessionKind` also returns `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`, but the scanner's directory walk only reads
`projectsRoot/*/*.jsonl` (two levels deep) — subagent transcripts live four
levels deep, so they're unreachable today. That makes an explicit
`subagent` skip dead code under the current traversal; it's called out
inline in `_usage-data.mjs` so a future contributor who adds recursive
traversal doesn't silently reintroduce inheritance noise.

## Fail-loud drift detection

A new `assertCommandPartition(posture, volume, target)` runs at module load
against the live `POSTURE_COMMANDS` / `VOLUME_COMMANDS` / `TARGET_COMMANDS`
sets and throws on three drift shapes:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap (not disjoint).
2. A `TARGET_COMMANDS` member isn't classified as posture or volume.
3. A partition member isn't in `TARGET_COMMANDS` at all (dead
   classification — the set claims to gate a command the scanner never
   looks for).

Because the check runs at import time — which happens at the top of the
assessment chain — a partition/`TARGET_COMMANDS` mismatch aborts the entire
`npm run assess` invocation before any score is written: no
`assessment.json`, no Slack post. That's intentional (per CLAUDE.md, fail
loud on contributor drift rather than silently miscount), but it means an
operator debugging a LaunchAgent/cron run that produced no
`assessment.json` should check stderr for a `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` error before assuming an environmental problem.

## What changes for a user

Posture counters (`color`, `btw`, `voice`, `clear`, `compact`, `simplify`,
`fewer-permission-prompts`, `focus`, `rewind`) may trend down or stay flat
wherever observer-session echoes were inflating them; volume counters
(`schedule`, `go`, `batch`, `loop`, `babysit`) are unaffected. Most posture
scorers already had a conservative floor from the `history.jsonl` MAX-merge
(`maxProbe` in `run-assessment.mjs`), so the visible drop is usually small.
`/rewind` is the one posture command with no history-derived floor — it's a
keyboard shortcut, not present in the CLI's history command list — so it's
the counter most exposed to a real drop if your `/rewind` usage was mostly
observer noise.

## Where this lives

- Sets, gating, and the assertion: `scripts/_usage-data.mjs`
  (`scanTranscriptInvocations`, `POSTURE_COMMANDS`, `VOLUME_COMMANDS`,
  `assertCommandPartition`).
- Tests: `scripts/__tests__/_usage-data.test.mjs` — posture-in-observer
  (excluded), volume-in-observer (included), posture-in-sdk-orchestrated
  (excluded), volume-in-sdk-orchestrated (included), posture-in-interactive
  (included), unknown-entrypoint fallback (included), and direct unit tests
  of `assertCommandPartition` against forged sets.
- Design record: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`.
- Historical context (the reverted v0.9.17 blanket fix, and why a
  per-command shape was necessary instead): CLAUDE.md, under "Command
  counting honors the posture-vs-volume partition."
