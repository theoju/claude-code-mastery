---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Posture vs. volume: partitioning slash-command counts by session kind

PR #110 (CCE-71) closes a gap that had been sitting in CLAUDE.md as a
named "deferred follow-up" since v0.9.17: the transcript scanner in
`scripts/_usage-data.mjs` counted every `<command-name>` occurrence it
saw, regardless of which kind of session emitted it. Observer sessions
— the ones that watch a primary session and emit structured
observations — echo the primary session's `<command-name>` markup
verbatim. Before this PR, that echo was indistinguishable from a real
user invocation, so posture-command counters (`/color`, `/btw`,
`/clear`, and friends) could be inflated by sessions where the user
never typed the command at all.

## The fix: two sets, not one blanket exclusion

The v0.9.17 cycle already tried the obvious fix — exclude
`observer`/`sdk_orchestrated`/`subagent` sessions from
`scanTranscriptInvocations` entirely — and it regressed `scheduled`
from 75 to 63 by deleting genuine `/loop`/`/schedule` signal that
happened to come from non-interactive sessions. That's real
autonomous-workflow evidence, not noise; blanket exclusion threw it
away along with the false positives. This PR does the narrower thing
CLAUDE.md had already prescribed: split the command list itself.

`scripts/_usage-data.mjs` now exports two disjoint sets:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside `scanTranscriptInvocations`, each session file is classified
once via `classifySessionKind(path)`, and posture commands are only
counted when:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Volume commands (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
keep counting across every session kind the scanner sees, unconditionally
— the rationale is that autonomous-workflow signal is real no matter who
fired it. `effortMaxCommandUses` and `planThenLaunchSessions` sit
outside the partition entirely by design: they're detected by regex/structural
pattern matching (`hasEffortMax`, `ExitPlanMode` lookahead), not by
`extractSlashCommands`, so they were never part of the drift risk this
partition addresses.

`"unknown"` is deliberately grouped with `interactive_cli` rather than
excluded. `classifySessionKind` reads up to the first five lines of a
transcript looking for an `entrypoint` field; if none of the recognized
values (`cli`, `claude-desktop`, `sdk-cli`) appear, it falls through to
`return "unknown"`. The conservative read is that a session with no
detectable entrypoint is more likely a legitimate interactive session
predating entrypoint tracking than a disguised observer transcript — so
it stays eligible for posture counting.

## Fail-loud drift detection

A new `assertCommandPartition(posture, volume, target)` runs at module
load against the live `POSTURE_COMMANDS` / `VOLUME_COMMANDS` /
`TARGET_COMMANDS` sets and throws on any of three drift shapes:

1. **Overlap** — a command classified as both posture and volume.
2. **Uncategorized** — a command in `TARGET_COMMANDS` (the canonical
   scanned set) that isn't in either partition set.
3. **Dead classification** — a command in one of the partition sets
   that isn't actually in `TARGET_COMMANDS` (i.e., it's never scanned).

Because the assertion runs at import time — which happens at the top
of the assessment chain — a partition drift doesn't produce a
quietly-wrong score. It aborts `npm run assess` before
`assessment.json` is written at all. If a scheduled run (LaunchAgent or
cron) exits non-zero with no `assessment.json` on disk, check stderr
for a `POSTURE_COMMANDS`/`VOLUME_COMMANDS` error from this assertion
before assuming an environmental problem.

`assertCommandPartition` is exported specifically so it can be unit
tested against forged sets (`scripts/__tests__/_usage-data.test.mjs`)
without needing import-cache tricks to monkeypatch the real top-level
constants.

## What this changes for scores in practice

Posture-command counters (`color`, `btw`, `voice`, `clear`, `compact`,
`simplify`, `fewer-permission-prompts`, `focus`, `rewind`) can trend
down slightly for users whose transcripts included observer or
SDK-orchestrated sessions that echoed command markup from a primary
session. Volume-command counters (`loop`, `schedule`, `go`, `batch`,
`babysit`) are unaffected — the counting logic there is unchanged.
Most posture scorers are cushioned by the existing MAX-merge against
`~/.claude/history.jsonl` in `run-assessment.mjs` (which only reflects
typed interactive prompts and so was already a conservative floor).
`/rewind` is the one posture command with no history-derived floor —
it's a keyboard shortcut, not present in the history command list — so
it's the counter most exposed to a real count drop. If you're auditing
a score change after upgrading, `/rewind` is the first place to look.

## Why this lives here and not just in the spec/plan docs

The full design rationale, session-kind data-flow diagram, and test
matrix live in
[`docs/superpowers/specs/2026-05-31-per-command-partition-design.md`](../superpowers/specs/2026-05-31-per-command-partition-design.md)
and its companion plan. This page is the lens-facing summary: the
"what changed and why it matters for your score" version, for anyone
reading the docs site rather than the implementation history.
