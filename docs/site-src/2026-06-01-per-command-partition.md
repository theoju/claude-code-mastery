---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for observer-session false positives

**PR #110 · v0.9.18**

## What changed

`scripts/_usage-data.mjs::scanTranscriptInvocations` now classifies every scanned session before counting slash commands, and gates posture-command counters on whether the session is genuinely interactive.

Two named sets define the partition:

```js
// scripts/_usage-data.mjs
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear", "compact",
  "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

At the top of the per-session loop, `classifySessionKind(path)` reads up to the first five lines of the transcript looking for an `entrypoint` field. The result gates posture counting:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture counters (`colorCommandUses`, `btwCommandUses`, `voiceCommandUses`, etc.) only increment when `allowPosture` is true. Volume counters (`loopCommandUses`, `scheduleCommandUses`, `goCommandUses`, etc.) increment unconditionally, as before.

A fail-loud `assertCommandPartition` guard runs at module load and enforces three invariants: the two sets are disjoint, their union equals `TARGET_COMMANDS`, and no member of either set is absent from `TARGET_COMMANDS`. Any violation aborts `npm run assess` before writing `assessment.json`.

## Why

Observer sessions monitor a primary session's work and echo its `<command-name>/cmd</command-name>` markup verbatim. Before this change, every posture command a user typed in an interactive session was counted again each time an observer session replayed the markup — inflating counters by roughly one count per observer per command. The Terminal & Customization and Memory & Context Execution scorers both derive from posture-command coverage ratios, so the inflation overstated scores.

The v0.9.17 cycle attempted a blanket fix (exclude `observer`, `sdk_orchestrated`, and `subagent` from the scanner entirely) and regressed the scheduled-work Execution score from 75 to 63 by deleting genuine `/loop` and `/schedule` signal from SDK-orchestrated autonomous runs. That blanket fix was reverted. The correct shape is a per-command partition: suppress observer noise only where the semantic claim is "the user typed this command" (posture), and preserve broad counting where the semantic claim is "this workflow happened" (volume).

## Session kind classification

`classifySessionKind` inspects the transcript `entrypoint` field:

| `entrypoint` value | path contains `observer-sessions` | Result             |
|--------------------|-----------------------------------|--------------------|
| `"cli"` or `"claude-desktop"` | —                   | `interactive_cli`  |
| `"sdk-cli"`        | yes                               | `observer`         |
| `"sdk-cli"`        | no                                | `sdk_orchestrated` |
| (none found in first 5 lines) | —                    | `unknown`          |
| path matches `/subagents/agent-` | —               | `subagent`         |

`"unknown"` is treated as eligible for posture counting (same as `interactive_cli`). The reasoning: a session with no detectable entrypoint is more likely a legitimate interactive session predating entrypoint tracking than a hostile observer transcript.

**Note on subagents:** `classifySessionKind` can return `"subagent"`, but the scanner traverses `projectsRoot/*/*.jsonl` (exactly two levels deep). Real subagent transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl` — depth four, unreachable from the current traversal. A future change that adds recursive traversal must add an explicit `subagent` skip before it can reach those files.

## What is and is not in the partition

`effortMax` and `planThenLaunch` are **not** in either set and are not affected by `allowPosture`. `effortMax` uses `hasEffortMax(uText)` — a regex over the prompt text — not slash-command extraction, and remains unconditional. `planThenLaunch` is a structural pattern detected via lookahead from `ExitPlanMode` tool_use events, entirely separate from the user-text scanning path.

## Score deltas to expect

Posture counters that had observer-session inflation will drop on the first run after the partition lands. Volume counters stay flat. The MAX-merge that `buildSignalsSummary` performs between transcript counts and `history.jsonl` counts provides a floor for commands that appear in the interactive command history (`/color` is the documented case from PR #96), so most posture scorers stay numerically stable despite the lower transcript count.

`/rewind` is the one posture command with no history floor — it is invoked via keyboard shortcut rather than typed text and is not in the history list. If an operator's pre-partition `/rewind` count was driven entirely by observer echoes, the first post-partition run will show a measurable drop. The spec predicted this outcome and explicitly confirmed it via live verification before shipping; it is a false-positive removal, not a scoring regression.

## Operational note

If `npm run assess` exits non-zero and no `assessment.json` is written, check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition errors from `assertCommandPartition` before assuming an environmental issue. The assertion fires at module load, which means a classification drift (e.g., a new command added to `TARGET_COMMANDS` without placing it in either partition set) causes a hard abort rather than a silent miscount.

## Changing the partition

To add a new slash command to the scanner:

1. Add it to `TARGET_COMMANDS` in `scripts/_usage-data.mjs`.
2. Classify it as either `POSTURE_COMMANDS` or `VOLUME_COMMANDS`. Ask: does the semantic claim depend on the user having typed the command interactively, or is the signal meaningful regardless of which session kind fired it?
3. Add a counter to the `counts` object in `scanTranscriptInvocations` and wire it into `processCurrent`.
4. Add tests — at minimum: posture commands need an observer-suppression case and an interactive-pass-through case; volume commands need a volume-preserved-in-observer case.

The `assertCommandPartition` guard will throw at module load if step 2 is skipped, so the partition stays consistent without relying on contributor discipline alone.
