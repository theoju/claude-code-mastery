---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: Per-command partition for observer-session false positives

**PR #110 · shipped v0.9.18 · 2026-06-01**

## Problem

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks `~/.claude/projects/*/*.jsonl` with no session-kind filter. Observer sessions — which monitor a primary session and emit structured observations — replicate the primary session's `<command-name>cmd</command-name>` markup verbatim. Every posture command the user actually typed once appeared twice: once in the interactive session, once echoed in the observer session that was watching it.

The v0.9.17 cycle attempted a blanket fix (exclude `observer`, `sdk_orchestrated`, and `subagent` from the scanner entirely) and regressed the Scheduled Work dimension from 75 to 63. The reason: `/loop` and `/schedule` are autonomous-workflow signals that are legitimate regardless of which session kind emits them. A blanket exclusion wiped genuine volume signal along with the posture noise.

## Decision

Partition the scanned commands into two semantically distinct sets and apply the session-kind gate only to the posture half.

**Posture commands** (counted only in `interactive_cli` or `unknown` sessions):

```
color  voice  focus  btw  clear  compact  simplify  rewind  fewer-permission-prompts
```

These reflect user-posture choices — how you've configured your interactive experience. Observer and SDK-orchestrated sessions don't represent user posture; they run under the SDK's defaults or replay another session's transcript. Counting them here inflates posture coverage metrics for work you may not have actually done.

**Volume commands** (counted across all session kinds):

```
loop  schedule  babysit  go  batch
```

These signal autonomous-workflow adoption. An `/loop` invocation inside an SDK-orchestrated run is real workflow volume regardless of session kind. Suppressing it would undercount actual usage.

## Implementation

Two exported constants live at the bottom of the command-definition block in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

At module load, `assertCommandPartition` runs three invariant checks:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjoint)
2. Every member of `TARGET_COMMANDS` is classified as either posture or volume (no uncategorized scanned command)
3. Every partition member is in `TARGET_COMMANDS` (no dead classification)

If any of the three fails, the module throws before any score is written. If `npm run assess` exits non-zero with no `assessment.json`, check stderr for partition-drift errors before assuming an environmental issue.

Inside `scanTranscriptInvocations`, the per-session loop calls `classifySessionKind(path)` once and derives an `allowPosture` flag:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture = sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`classifySessionKind` reads at most 5 lines looking for an `entrypoint` field. `"cli"` and `"claude-desktop"` map to `"interactive_cli"`. `"sdk-cli"` maps to `"observer"` when the path contains `observer-sessions`, otherwise `"sdk_orchestrated"`. Sessions with no recognizable entrypoint return `"unknown"` — treated as eligible for posture counting on the conservative assumption that they predate entrypoint tracking, not that they are hostile observer transcripts.

Posture counters are gated:

```js
if (found.has("color") && allowPosture) sessionHasColor = true;
// … same pattern for all nine posture commands
```

Volume counters are unconditional:

```js
if (found.has("loop")) sessionHasLoop = true;
if (found.has("go"))   counts.goCommandUses++;
```

Two detectors sit outside the partition: `effortMaxCommandUses` uses `hasEffortMax(uText)` (a regex over prompt text, not `extractSlashCommands`) and `planThenLaunchSessions` is a structural lookahead from `ExitPlanMode` tool_use events. Neither is a slash-command name matched by the extraction path, so neither belongs in either set.

**Subagent sessions:** `classifySessionKind` returns `"subagent"` when the path matches `/subagents/agent-`. The scanner traversal reads `projectsRoot/*/*.jsonl` — exactly two levels deep. Real subagent transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl` (four levels deep), so the `"subagent"` return value is currently unreachable from this scanner. There is no explicit skip added for it. Any future traversal that recurses deeper must add `if (sessionKind === "subagent") continue` explicitly.

## Outcome

Overall scores were unchanged: Platform Setup 95, Execution 77. Terminal & Customization raw dropped from 90 to 85 after removing observer inflation, but that dimension was already capped at 100/100, so the displayed score held. Two posture predicates (`/simplify` and `/rewind` thresholds) dropped to zero — confirmed as inflation removal, not regression: those commands were previously being counted from observer echo, not from actual interactive invocations.

11 new unit tests were added covering: posture commands blocked in observer sessions, posture commands blocked in SDK-orchestrated sessions, volume commands preserved in both, interactive and unknown sessions allowed, and all three `assertCommandPartition` error paths. 633/633 tests pass.

## What to watch for

- **After landing, expect modest count drops** on posture-command metrics in the first assessment run. This is the fix working — observer echo was inflating the pre-partition numbers.
- **`/rewind` has no history MAX-merge floor.** It's a keyboard shortcut, not in `HISTORY_COMMAND_LIST`, so the `max(transcript_count, history_count)` safety net doesn't apply. If your `rewindCommandUses` pre-partition was mostly observer noise, the post-partition value could drop to zero. The `>=1` adoption probe would then fire as a gap. That is the accurate picture; the pre-partition count was wrong.
- **The boundary assertion is fail-loud.** Adding a new command to `TARGET_COMMANDS` without classifying it crashes the module. That's by design — classify it before adding to `TARGET_COMMANDS`, or classify it in the same commit.
