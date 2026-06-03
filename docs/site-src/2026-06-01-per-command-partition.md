---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command partition: posture vs volume (CCE-71)

The transcript scanner in `scripts/_usage-data.mjs` counts slash-command
invocations to feed both Platform Setup next-actions and Execution scorers.
PR #110 codifies the **posture-vs-volume command partition** that prevents
observer-session markup from inflating posture counters while preserving
autonomous-workflow signal for volume commands.

## The problem: observer sessions double-count posture commands

`scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl` and counts
every `<command-name>` occurrence it finds. Before this change it applied no
session-kind filter, so observer sessions — which monitor a primary session and
replicate its structured markup — counted every command a second time. A single
`/btw` invocation by the user produced two hits: one from the primary
`interactive_cli` session and one from the observer session that shadowed it.

The inflated counters silently overstated posture adoption. The Memory Execution
scorer's `btwCommandUses` numerator was the clearest victim: the ratio crept
above what real usage warranted because each interactive `/btw` was counted
twice.

## Why the naive fix regressed `scheduled` from 75 to 63

v0.9.17 attempted a blanket fix: exclude `observer`, `sdk_orchestrated`, and
`subagent` sessions from the transcript scan entirely. This correctly stopped
the false positives for posture commands, but it also deleted genuine
autonomous-workflow signal. `/loop`, `/schedule`, and `/babysit` are legitimately
fired from autonomous contexts — that's exactly the signal the scheduled and
automation scorers need to see. Removing those sessions cut the `scheduled`
Execution score from 75 to 63 in a real assessment. The change was reverted.

## The correct shape: per-command partition

The right fix applies the filter **per command**, not per session. Commands split
into two disjoint classes:

**Posture commands** — reflect user configuration choices. Counted only when the
session kind is `interactive_cli` or `unknown` (the conservative fallback for
sessions where kind can't be determined):

```
/color  /voice  /focus  /btw  /clear  /compact  /simplify  /rewind  /fewer-permission-prompts
```

**Volume commands** — autonomous-workflow signal. Counted across every session
kind, because these commands are real whether fired from an interactive terminal
or an SDK-orchestrated run:

```
/loop  /schedule  /babysit  /go  /batch
```

The implementation adds two named `Set` constants near the existing
`PLANNING_SKILL_COMMANDS` / `LEARNING_SKILL_COMMANDS` block:

```js
const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
const VOLUME_COMMANDS = new Set(["loop", "schedule", "babysit", "go", "batch"]);
```

The scanner then gates each command's increment on its partition membership:

```js
if (POSTURE_COMMANDS.has(cmd)) {
  // count only in interactive_cli | unknown sessions
} else if (VOLUME_COMMANDS.has(cmd)) {
  // count in all sessions
}
```

## Runtime assertion guards future drift

A fail-loud `assertCommandPartition` runs at module load time and enforces three
invariants:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint (no command in both).
2. Their union equals `TARGET_COMMANDS` (the canonical scanned set) — a new
   command added to `TARGET_COMMANDS` but not to either partition fails immediately.
3. No partition member is absent from `TARGET_COMMANDS` — catches the inverse
   case where a partition entry is added but `TARGET_COMMANDS` isn't updated.

If any invariant breaks, `npm run assess` exits non-zero with a descriptive
error before any JSON is written. Check stderr for the partition error message
before assuming an environmental issue.

## Operational notes

- Adding a new tracked slash command: update `TARGET_COMMANDS` first, then place
  it in exactly one of `POSTURE_COMMANDS` or `VOLUME_COMMANDS`. The assertion
  will fail loudly if you forget the second step.
- The probe tracker at
  `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` must be
  updated in the same PR as any change to either set.
- The CLAUDE.md "Command counting honors the posture-vs-volume partition" rule
  documents the behavioral contract; this page documents the implementation
  that enforces it.
