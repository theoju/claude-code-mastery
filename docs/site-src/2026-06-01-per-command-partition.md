---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: partition slash commands into posture vs. volume before counting

PR #110 changes how `scripts/_usage-data.mjs::scanTranscriptInvocations` counts
slash-command usage from `~/.claude/projects/*/*.jsonl` transcripts. Commands
are now split into two classes, and only one of them is filtered by session
kind.

## The problem

Observer sessions (transcripts that watch a primary session and emit
structured observations) and SDK-orchestrated sessions echo the primary
session's `<command-name>cmd</command-name>` markup in their own transcript
file. Before this PR, `scanTranscriptInvocations` counted every scanned
session unconditionally, so a single real `/color` invocation in an
interactive session could get counted again from the observer session
watching it — inflating posture-command counters that feed user-posture
ratios like Memory & Context Management.

An earlier attempt (v0.9.17) fixed this by excluding `observer`,
`sdk_orchestrated`, and `subagent` sessions from the scanner entirely. That
regressed the `scheduled` dimension from 75 to 63: `/loop` and `/schedule`
invocations fired from SDK-orchestrated sessions are real autonomous-workflow
signal, not noise, and the blanket exclusion deleted it along with the
observer false positives. That fix was reverted.

## The fix: a per-command partition, not a per-session exclusion

`scripts/_usage-data.mjs` now declares two disjoint, module-level command
sets:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear", "compact",
  "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside the per-session scan loop, each transcript is classified once via
`classifySessionKind(path)` (`interactive_cli`, `sdk_orchestrated`,
`observer`, `subagent`, or `unknown`, based on the `entrypoint` field found
in the first five lines). Posture-command counters — the ones that measure
what the user chose to do, like toggling `/focus` or running `/rewind` — are
only incremented when:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`"unknown"` is included deliberately as the conservative fallback: a
transcript with no detectable `entrypoint` in its first five lines is judged
more likely to be a legitimate pre-entrypoint-tracking interactive session
than a hostile observer echo. Volume-command counters (`/loop`, `/schedule`,
`/babysit`, `/go`, `/batch`) stay unconditional — they're counted across
every session kind the scanner sees, because autonomous-workflow volume is
real regardless of which session fired it.

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside the partition
entirely: they're detected by regex-over-prompt-text and structural
ExitPlanMode lookahead, not by `extractSlashCommands`, so they were never
part of the drift risk this partition addresses.

## Guardrail: a fail-loud assertion at module load

`assertCommandPartition(posture, volume, target)` runs once when
`_usage-data.mjs` loads and checks three invariants against the canonical
`TARGET_COMMANDS` set:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint.
2. Every member of `TARGET_COMMANDS` is classified as posture or volume.
3. No partition member exists outside `TARGET_COMMANDS` (dead classification).

If any check fails, it throws — which aborts the entire `npm run assess`
invocation before `assessment.json` is written. This is intentional: silent
miscounting is worse than a loud crash. It also means a missing
`assessment.json` after touching `_usage-data.mjs` should first be diagnosed
by checking stderr for a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` error, not
assumed to be an environmental problem.

## Why this shape survives future changes

The `subagent` session kind exists in `classifySessionKind` but is currently
unreachable from `scanTranscriptInvocations`'s traversal — the scanner reads
`projectsRoot/*/*.jsonl` (two levels deep), while subagent transcripts live
three levels deeper at `projects/<project>/<uuid>/subagents/agent-*.jsonl`.
There's no `subagent` skip in the loop today because it would be dead code.
If a future change makes the traversal recursive, it needs to add
`if (sessionKind === "subagent") continue` explicitly rather than assume the
existing partition logic covers it.

`POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are now
the canonical source of truth for this split — CLAUDE.md's Hard Rules section
points here rather than re-stating the list.
