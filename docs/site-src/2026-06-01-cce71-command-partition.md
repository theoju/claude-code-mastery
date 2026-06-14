---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# CCE-71: Per-command partition for transcript command counting

**Decision date:** 2026-05-31 (design approved) / shipped PR #110
**Ticket:** CCE-71
**Files:** `scripts/_usage-data.mjs`

## The problem

`scanTranscriptInvocations` walked `~/.claude/projects/*/*.jsonl` with no
session-kind filter. Observer sessions — which monitor a primary session's
work and emit structured observations — replicate the primary session's
`<command-name>/cmd</command-name>` markup verbatim. Every posture command
the user typed once was counted twice: once from the real interactive session,
once from the observer shadow. This inflated counters for `/color`, `/btw`,
`/clear`, `/compact`, `/simplify`, `/rewind`, `/voice`, `/focus`, and
`/fewer-permission-prompts`.

A v0.9.17 attempt fixed this with a blanket exclusion — filtering out
`observer`, `sdk_orchestrated`, and `subagent` sessions entirely. It worked
for posture commands but regressed the `scheduled` Execution score from 75 to
63 by discarding genuine `/loop` and `/schedule` signal from autonomous-workflow
sessions. That change was reverted.

## The decision

Partition the scanned commands into two disjoint sets:

```js
// scripts/_usage-data.mjs
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

**Posture commands** are user-posture signals. An observer session echoing
`<command-name>/color</command-name>` does not represent a new user invocation
of `/color`. These are counted only when `classifySessionKind` returns
`"interactive_cli"` or `"unknown"` — the conservative fallback for transcripts
whose entrypoint field is absent.

**Volume commands** are autonomous-workflow signals. A `/loop` or `/schedule`
invocation is real regardless of which session kind emitted it. These continue
to be counted across all session kinds the scanner sees.

## Enforcement

A fail-loud `assertCommandPartition` guard runs at module load:

```js
export function assertCommandPartition(posture, volume, target) {
  const union = new Set([...posture, ...volume]);
  if (posture.size + volume.size !== union.size) {
    throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
  }
  for (const cmd of target) {
    if (!union.has(cmd)) {
      throw new Error(
        `TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`
      );
    }
  }
  for (const cmd of union) {
    if (!target.has(cmd)) {
      throw new Error(
        `Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`
      );
    }
  }
}

assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

Three invariants are asserted: the sets are disjoint, every member of
`TARGET_COMMANDS` is classified, and no classified command is absent from
`TARGET_COMMANDS`. If any invariant is violated — e.g. because a future
contributor adds a command to `TARGET_COMMANDS` without classifying it — the
assessment aborts at module load before any score is written or posted to
Slack. Check stderr for the partition error message before assuming an
environmental issue.

## What this does not change

- **Volume command counting** — `/loop`, `/schedule`, `/babysit`, `/go`, `/batch`
  stay unconditional. The v0.9.17 regression (75→63 `scheduled`) cannot recur.
- **The history MAX-merge** — `buildSignalsSummary` still takes
  `max(transcript_count, history.jsonl_count)` for commands that appear in
  `~/.claude/history.jsonl`. The partition cleans the transcript side of
  that max; it doesn't touch the floor.
- **`effortMax` and `planThenLaunch`** — these are structural pattern
  detectors, not slash-command counters. They stay outside the partition.
- **Subagent transcripts** — `classifySessionKind` returns `"subagent"` for
  paths matching `subagents/agent-`, but the scanner reads exactly
  `projects/*/*.jsonl` (two levels deep). Real subagent transcripts live at
  `projects/<project>/<uuid>/subagents/agent-*.jsonl` (four levels deep) and
  are not reachable from the current traversal. An explicit `subagent` skip
  would be dead code today; the inline comment flags this for a future
  traversal change.

## Score deltas

Expected post-partition: small count drops on posture commands wherever
observer markup was inflating the count; no change to volume commands.
Platform Setup 95→95, Execution 77→77 on the author's snapshot — within-noise.
Two threshold crossings (`simplifyCommandUses`, `rewindCommandUses`) were
predicted by the spec and represent correct inflation removal, not regressions.

`/rewind` is the one posture command with no history MAX-merge floor — it is
a keyboard shortcut, not in `history.jsonl`. The spec recorded pre-partition
`rewindCommandUses ≈ 7`, with ≈4 observer false-positives, so post-partition
expected ≈3 — still above the `>= 1` adoption threshold.

## Tests

Eleven new tests cover the partition:

- Posture command in an observer session does **not** count (`colorCommandUses === 0`).
- Volume command in an observer session **does** count (`loopCommandUses === 1`).
- Same two cases for an SDK-orchestrated session.
- Posture command in an interactive session counts normally.
- Unknown entrypoint falls back to interactive (the conservative fallback).
- `assertCommandPartition` unit tests cover all three violation cases and the happy path.

Tests use real-filesystem fixtures under `mkdtempSync`, matching the existing
convention in `scripts/__tests__/_usage-data.test.mjs`. `POSTURE_COMMANDS`,
`VOLUME_COMMANDS`, `TARGET_COMMANDS`, and `assertCommandPartition` are exported
from `_usage-data.mjs` so the assertion helper can be tested without
import-cache games.

## Canonical reference

The `POSTURE_COMMANDS` / `VOLUME_COMMANDS` Sets in `scripts/_usage-data.mjs`
are the source of truth for which commands are posture-gated and which are
unconditional. If you add a command to `TARGET_COMMANDS`, classify it in one
of the two sets in the same commit — the boundary assertion will catch the
omission at the next `npm run assess` invocation and fail loudly.
