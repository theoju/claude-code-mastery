---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command partition for transcript slash-command counting

**Date:** 2026-05-31  
**PR:** [#110](https://github.com/theoju/claude-code-self-assessment/pull/110)

## Problem

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl` and counts slash-command occurrences to score things like memory context management (`/clear`, `/compact`) and terminal customization (`/color`, `/voice`). Before this change, it applied **no session-kind filter** — it counted every transcript, including observer sessions.

Observer sessions monitor a primary session's work and emit structured observations. In doing so, they replicate the primary session's `<command-name>cmd</command-name>` markup verbatim. A single `/color` invocation in an interactive session could appear in both the primary transcript and one or more observer transcripts, inflating the posture counter by 2× or more.

## Failed approach: blanket exclusion (v0.9.17)

The v0.9.17 cycle attempted to fix this by excluding `observer`, `sdk_orchestrated`, and `subagent` sessions from `scanTranscriptInvocations` entirely. That blanket filter solved the posture inflation — and regressed the `scheduled` dimension score from 75 to 63 by deleting genuine `/loop` and `/schedule` signal.

The regression happened because `/loop` and `/schedule` are legitimately invoked from SDK-orchestrated and automation contexts. Dropping all non-interactive sessions from the scan deleted real autonomous-workflow evidence. v0.9.17 was reverted.

## Decision: a per-command partition

The correct shape is not a session-level filter but a **per-command filter**. Two semantically distinct classes of slash command exist in the scanner:

**Posture commands** — signals that are meaningful only when a human typed them into an interactive CLI session. An observer session echoing `/color` says nothing about user preference; only the interactive session does.

```
POSTURE_COMMANDS = {
  color, voice, focus, btw, clear, compact,
  simplify, rewind, fewer-permission-prompts
}
```

**Volume commands** — signals whose presence is meaningful regardless of which session kind fired them. `/loop` in an SDK-orchestrated session is real autonomous-workflow activity; the source session kind doesn't change what it means.

```
VOLUME_COMMANDS = {
  loop, schedule, babysit, go, batch
}
```

These two sets are defined as exported module-level constants in `scripts/_usage-data.mjs` (lines 429–446). Their union must equal `TARGET_COMMANDS` exactly.

## Enforcement: fail-loud boundary assertion

A module-load guard runs `assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS)` every time `_usage-data.mjs` is imported. It checks three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjoint)
2. Every member of `TARGET_COMMANDS` appears in exactly one partition set (no uncategorized command)
3. Every partition member appears in `TARGET_COMMANDS` (no dead classification)

Any violation throws at module load before a single transcript is read, and before `assessment.json` is written. If `npm run assess` exits non-zero with no `assessment.json`, check stderr for partition-drift errors from this assertion before assuming an environmental issue.

The assertion is factored into an exported function (`assertCommandPartition`) so unit tests can forge Sets and verify all three failure modes without import-cache manipulation.

## Scanner implementation

At the top of the per-session loop in `scanTranscriptInvocations`, the scanner classifies each transcript once:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`classifySessionKind` reads at most the first 5 lines of a transcript looking for the `entrypoint` field: `"cli"` or `"claude-desktop"` → `interactive_cli`; `"sdk-cli"` → `observer` (under `observer-sessions/` paths) or `sdk_orchestrated`; no recognizable entrypoint → `"unknown"`.

The `unknown` fallback is intentionally treated as `interactive_cli`-equivalent. A session with no detectable entrypoint is more likely a legitimate interactive session predating entrypoint tracking than a hostile observer transcript. Conservative fallback.

Posture-command counters are then gated:

```js
if (found.has("color") && allowPosture) sessionHasColor = true;
if (found.has("clear") && allowPosture) sessionHasClear = true;
// …etc for all POSTURE_COMMANDS
```

Volume-command counters have no gate:

```js
if (found.has("loop")) sessionHasLoop = true;
if (found.has("schedule")) counts.scheduleCommandUses++;
// …etc for all VOLUME_COMMANDS
```

## What falls outside the partition

Two signals in `scanTranscriptInvocations` are detected by structural patterns rather than slash-command names, so they don't participate in the partition:

- **`effortMaxCommandUses`** — detected via `hasEffortMax(uText)`, a regex that looks for the specific `/effort max` argument form. It stays unconditional because the partition asserts only over `TARGET_COMMANDS` members.
- **`planThenLaunchSessions`** — a lookahead pattern from `ExitPlanMode` tool_use events. Not a slash command at all; also stays unconditional.

## What did not change

- The projection layer in `run-assessment.mjs` is byte-identical.
- The history MAX-merge (`maxProbe(signals, field)`) that produces a conservative floor from `~/.claude/history.jsonl` is unchanged. For `/color` and similar commands that were already history-backed, this floor suppresses the observer-inflation effect independently — the partition makes the transcript count honest so the MAX picks the right value.
- `VOLUME_COMMANDS` counts are unchanged. `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` all count across every session kind the scanner visits.

## Subagent traversal note

`classifySessionKind` returns `"subagent"` when the path matches `/subagents/agent-`. However, the scanner's traversal reads `projectsRoot/*/*.jsonl` — exactly two levels deep. Real subagent transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl` (four levels deep), so they are currently unreachable from this traversal. There is no explicit `subagent` skip in the scanner because it would be dead code. A future change that adds recursive traversal must add that skip explicitly.

## Tests

`scripts/__tests__/_usage-data.test.mjs` covers:

- Posture command in observer session → `colorCommandUses === 0`
- Volume command in observer session → `loopCommandUses === 1`
- Posture command in `sdk_orchestrated` session → `colorCommandUses === 0`
- Volume command in `sdk_orchestrated` session → `loopCommandUses === 1`
- Posture command in interactive (`entrypoint: "cli"`) session → `colorCommandUses === 1`
- Unknown entrypoint falls back to interactive → `colorCommandUses === 1`
- `assertCommandPartition` helper: disjointness violation, uncategorized TARGET member, dead partition member, and happy path

All fixtures use real-filesystem `mkdtempSync` + `writeFileSync` — no mocks, matching existing convention.
