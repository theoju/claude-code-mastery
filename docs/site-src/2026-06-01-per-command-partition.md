---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition: posture vs. volume commands

`scripts/_usage-data.mjs` now divides every scanned slash command into one of
two named Sets before counting it. **Posture commands** are gated behind a
session-kind check; **volume commands** are counted across all session kinds
unconditionally.

## The two Sets

Defined and exported from `scripts/_usage-data.mjs` (lines 429–446):

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw",
  "clear", "compact", "simplify", "rewind",
  "fewer-permission-prompts",
]);

export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

**Posture commands** represent user-posture choices — things like `/color`,
`/compact`, and `/rewind` that only make sense when a human is actively driving
the session. Observer sessions and SDK-orchestrated sessions replicate the
primary session's `<command-name>` markup verbatim, so a single real invocation
of `/color` can appear in two or three transcript files. Counting it in all of
them inflates the posture signal without reflecting any additional user action.

**Volume commands** represent autonomous-workflow volume — `/loop`, `/schedule`,
`/babysit`, `/go`, `/batch`. When one of these fires inside an SDK-orchestrated
or observer session, it represents real automation activity. Restricting it to
interactive sessions only would delete genuine signal.

## The session-kind gate

At the top of each session's scan loop, `scanTranscriptInvocations` calls
`classifySessionKind(path)` once and computes:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters increment only when `allowPosture` is `true`. Volume
counters are unconditional.

`"unknown"` is treated as eligible for posture counting. The reasoning: a
session with no detectable `entrypoint` field in its first five lines is
more likely a legitimate interactive session predating entrypoint tracking
than a hostile observer transcript. Treating it conservatively as interactive
preserves the historical coverage floor.

`"subagent"` sessions exist in the classifier but are unreachable from
`scanTranscriptInvocations`'s traversal: the scanner reads
`~/.claude/projects/*/*.jsonl` (two levels deep), while real subagent
transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl`
(four levels). There is no explicit subagent skip — it would be dead code
under the current traversal. If a future PR adds recursion, it should add
the skip explicitly.

## The boundary assertion

Adding a command to `TARGET_COMMANDS` without classifying it, or classifying
a command that isn't in `TARGET_COMMANDS`, crashes the entire assessment
at module load before any score is written. The guard is exported as
`assertCommandPartition` and called immediately:

```js
export function assertCommandPartition(posture, volume, target) {
  const union = new Set([...posture, ...volume]);
  if (posture.size + volume.size !== union.size)
    throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
  for (const cmd of target)
    if (!union.has(cmd))
      throw new Error(`TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`);
  for (const cmd of union)
    if (!target.has(cmd))
      throw new Error(`Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`);
}

assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

Three drift cases, each caught at startup:

| Case | Trigger | Error text |
|------|---------|------------|
| Overlap | A command appears in both Sets | `must be disjoint` |
| Uncategorized | `TARGET_COMMANDS` member missing from both Sets | `not classified as posture or volume` |
| Dead classification | Partition member not in `TARGET_COMMANDS` | `dead classification` |

If `npm run assess` exits non-zero and no `assessment.json` is written, check
stderr for one of these messages before assuming an environmental issue.

## Why not a blanket session exclusion

v0.9.17 tried to fix the observer-inflation problem by excluding `observer`,
`sdk_orchestrated`, and `subagent` session kinds from `scanTranscriptInvocations`
entirely. It regressed the `scheduled` dimension from 75 to 63 by deleting
genuine `/loop` and `/schedule` signal that had fired from SDK-orchestrated
sessions as real autonomous-workflow activity. That change was reverted.

The per-command partition is the correct shape: restrict _posture_ signals to
interactive sessions, preserve _volume_ signals across all session kinds.

## Commands outside the partition

Two detection paths sit outside the partition by design:

- **`effortMaxCommandUses`** — detected by `hasEffortMax(uText)`, a regex over
  the prompt text that checks for the argument `max` alongside `/effort`, not
  just the command name. It stays unconditional.
- **`planThenLaunchSessions`** — detected via a lookahead from `ExitPlanMode`
  tool-use events, not slash-command extraction. Also unconditional.

Neither name appears in `POSTURE_COMMANDS` or `VOLUME_COMMANDS`; the
`assertCommandPartition` check does not apply to them.

## Operational note

`assertCommandPartition` runs the first time any module imports
`_usage-data.mjs`, which happens at the top of the assessment chain. A
partition-drift error aborts the entire run — no `assessment.json` is written,
no Slack post fires. This is intentional: silent miscounting is worse than a
loud failure. After a dependency bump or a refactor that touches `TARGET_COMMANDS`,
check stderr for partition errors if the run produces no output.

## Source reference

- Implementation: `scripts/_usage-data.mjs` — `POSTURE_COMMANDS`,
  `VOLUME_COMMANDS`, `assertCommandPartition` (lines 422–475)
- Tests: `scripts/__tests__/_usage-data.test.mjs` — partition and session-kind
  gate coverage (Tests 1–8 in the spec)
- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
