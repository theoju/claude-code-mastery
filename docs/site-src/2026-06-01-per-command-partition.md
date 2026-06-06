---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-Command Posture-vs-Volume Partition

PR #110 introduced a partition in the transcript-scanning layer that separates posture commands from volume commands and applies different session-kind filtering to each. The change eliminates false-positive inflation from observer sessions without discarding genuine autonomous-workflow signal.

## Background

When Claude Code runs a slash command in an interactive session, the transcript records a `<command-name>` entry. Observer sessions — which mirror the primary session's transcript — echo that same markup verbatim. Before the partition, `scanTranscriptInvocations` in `scripts/_usage-data.mjs` counted every instance regardless of session kind, so each interactive posture command use was counted twice: once for the actual interactive session, and once for its observer shadow.

A blanket fix in v0.9.17 attempted to solve this by excluding all non-`interactive_cli` sessions from the command scan. It eliminated the posture double-counting but regressed the `scheduled` Execution score from 75 → 63 by discarding legitimate volume-command invocations emitted by autonomous sessions — `/loop`, `/schedule`, `/babysit`, `/go`, `/batch`. Scheduled workflows fire in non-interactive session kinds by design; filtering them out deletes real signal. That change was reverted.

## The partition

The correct fix is per-command, not a blanket per-session-kind exclusion:

| Set | Commands | Session-kind filter |
| --- | -------- | ------------------- |
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` or `unknown` only |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | all session kinds |

**Posture commands** reflect user-settable behavior — things you configure or invoke during a live Claude Code terminal session. Observer and SDK-orchestrated sessions inherit the platform's defaults and carry no meaningful posture signal. Restricting posture counts to `interactive_cli` or `unknown` (the conservative fallback for sessions that can't be classified) gives an accurate picture of your actual usage.

**Volume commands** are autonomous-workflow signals. `/loop` and `/schedule` fire in sessions that are often not `interactive_cli` by design. Restricting them to interactive sessions only would systematically under-count the exact behavior they measure.

## Boundary enforcement

`assertCommandPartition` runs at module load in `scripts/_usage-data.mjs` and throws synchronously if:

- A command appears in both sets (disjointness violation)
- A command is present in one set but no longer exists in the classified command space (dead classification)
- A new command reaches the scanning layer without being classified into either set (missing classification)

Any of these conditions causes `npm run assess` to exit non-zero before `assessment.json` is written. If the scorer exits without output, check stderr for partition errors before assuming an environmental problem.

## Effect on probe thresholds

After the partition, two probe thresholds crossed downward from their pre-partition baselines:

- `simplifyCommandUses >= 1`
- `rewindCommandUses >= 1`

The design spec identified this as the expected risk path: both commands had low real usage that observer-session echoes were inflating. Post-partition counts reflect actual interactive invocations. If your assessment shows either probe newly unsatisfied, that is accurate signal, not a regression.
