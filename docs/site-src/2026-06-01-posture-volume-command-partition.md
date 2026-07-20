---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Posture vs. volume: partitioning slash commands in the transcript scanner

`scanTranscriptInvocations` (`scripts/_usage-data.mjs`) walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session for Execution scoring. Until CCE-71 / PR #110, it applied no
session-kind filter — every transcript the scanner could see, including
observer and SDK-orchestrated sessions, counted toward the same command
tallies as a real interactive session.

That's a problem for a specific subset of commands. Observer sessions
watch a primary session's work and emit structured observations that
echo the primary session's `<command-name>cmd</command-name>` markup —
so a single real `/color` invocation in the primary session could show
up a second time in the observer transcript, inflating the count without
a second real invocation ever happening.

## The fix: classify, then gate by command class

The scanner now calls `classifySessionKind(path)` once per session file.
It reads up to the first 5 lines looking for an `entrypoint` field and
returns one of `"interactive_cli"`, `"sdk_orchestrated"`, `"observer"`,
`"unknown"`, or `"subagent"` (the last is unreachable today — see
below). From that, the scanner derives:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`"unknown"` is deliberately treated as eligible for posture counting.
The reasoning is conservative-fallback: a session with no detectable
`entrypoint` in its first 5 lines is more likely a legitimate
interactive session that predates entrypoint tracking than a hostile
observer transcript.

Not every command is gated the same way. `TARGET_COMMANDS` splits into
two disjoint sets:

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

**Posture commands** are counted only when `allowPosture` is true.
These are the commands that express something about how *you* work —
plan mode discipline, permission posture, memory hygiene — and an
observer or SDK-orchestrated session echoing the markup doesn't mean
you actually did any of that.

**Volume commands** stay unconditional, counted across every session
kind the scanner sees. `/loop`, `/schedule`, `/babysit`, `/go`, and
`/batch` represent autonomous-workflow volume that's real regardless of
who fired it — a subagent or SDK-orchestrated run genuinely running
`/loop` is exactly the signal the scheduled/automation dimensions want
to see. This distinction exists because of a real regression: a v0.9.17
attempt at a blanket fix (exclude `observer`/`sdk_orchestrated`/
`subagent` from the scanner entirely) dropped the `scheduled` dimension
from 75 to 63 by deleting genuine `/loop` + `/schedule` signal along
with the false positives. It was reverted. The per-command partition is
the shape that survives: filter posture, preserve volume.

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside the
partition entirely — they're detected by regex-over-prompt-text and
structural lookahead from `ExitPlanMode`, not by `extractSlashCommands`,
so they were never subject to the observer-echo problem the partition
addresses.

## A fail-loud guard against drift

`assertCommandPartition(posture, volume, target)` runs once at module
load and checks three invariants:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint.
2. Every member of `TARGET_COMMANDS` is classified as posture or volume.
3. Every partition member is actually in `TARGET_COMMANDS` (catches dead
   classification — a command removed from scanning but left in the
   partition).

Any violation throws at import time, which happens at the top of the
assessment chain — so a partition-drift bug aborts `npm run assess`
before any `assessment.json` is written, rather than silently
miscounting. If a cron/LaunchAgent run exits non-zero with no
`assessment.json` on disk, check stderr for a `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` error before assuming an environmental problem.

## What changed on a live run

Running the partitioned scanner against real transcript history moved
two posture counters — `simplify` and `rewind` — downward across their
adoption thresholds, exactly as the design spec predicted. Both lack a
`history.jsonl` MAX-merge floor (unlike, say, `/color`, which
`run-assessment.mjs` already floors against `~/.claude/history.jsonl`
typed-prompt history), so nothing masked the corrected, lower count.
Every other score was unchanged. `/rewind` in particular has no history
floor at all — it's a keyboard shortcut, not a typed prompt — so it was
the counter most exposed to a real drop; the live run confirmed it
stayed above its `>=1` adoption threshold post-partition.

## A traversal detail worth knowing

`classifySessionKind` returns `"subagent"` for any path matching
`/subagents/agent-*.jsonl`. But the scanner's traversal reads exactly
`projectsRoot/*/*.jsonl` — two levels deep — while real subagent
transcripts live three levels deeper, at
`projects/<project>/<session-uuid>/subagents/agent-*.jsonl`. So
`"subagent"` is unreachable from this scanner today; there's no
explicit skip for it because there's nothing to skip. If a future
change adds recursive traversal to reach those files, it needs to add
`if (sessionKind === "subagent") continue` explicitly rather than
inherit this assumption silently.

## Where this fits

This closes a documented "known limitation / deferred follow-up" that
had lived in CLAUDE.md since the CCE-79 Memory Execution redesign — the
posture-vs-volume split was previously enforced only by convention
(`POSTURE_COMMANDS` / `VOLUME_COMMANDS` as a documentation table, not
code). It's now a machine-enforced invariant: `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the canonical source
of truth, and `assertCommandPartition` is the regression test that
keeps them honest as new commands get added to `TARGET_COMMANDS`.

No new probes, catalog entries, or `signalsSummary` keys were added —
this is an accuracy refinement of existing transcript-derived signals,
not new coverage.
