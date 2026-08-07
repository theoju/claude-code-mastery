---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: partition slash-command counting into posture vs. volume

## Context

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session, feeding the Execution-axis command counters (`/color`, `/btw`,
`/loop`, `/schedule`, and friends) that several posture and volume scorers
divide into their ratios. Until PR #110 the scan applied no session-kind
filter — every transcript the scanner reached was counted equally, including
**observer** sessions (which watch a primary session and emit structured
observations) and **SDK-orchestrated** sessions. Both of those session kinds
routinely echo the primary session's `<command-name>cmd</command-name>`
markup into their own transcript, so a single real `/color` invocation by the
user could get counted a second time from an observer transcript that never
actually ran the command.

This wasn't a new problem so much as a documented and deferred one. CLAUDE.md
already carried the posture-vs-volume distinction as a named convention
before this PR, along with a cautionary tale: a v0.9.17 attempt to fix the
same class of bug applied a blanket exclusion (drop `observer`,
`sdk_orchestrated`, and `subagent` sessions from the scan entirely) and
regressed the `scheduled` dimension 75→63 by deleting genuine `/loop` /
`/schedule` autonomous-workflow signal along with the noise. That fix was
reverted. The lesson it left behind — preserved directly in the CLAUDE.md
hard-rules list — was that the exclusion has to be scoped **per command**,
not per session.

## Decision

CCE-71 (PR #110) codifies that per-command scope as two disjoint, named sets
in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside the per-session loop, `scanTranscriptInvocations` now calls
`classifySessionKind(path)` once per transcript and derives an
`allowPosture` flag:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Every posture-command counter (the `sessionHasColor`, `sessionHasBtw`,
`sessionHasFocus`, `sessionHasRewind`, and similar per-session flags) is now
gated behind `allowPosture`. Volume-command counters (`goCommandUses`,
`batchCommandUses`, `scheduleCommandUses`, `sessionHasLoop`,
`sessionHasBabysit`) stay unconditional, counted across every session kind
the scanner reaches — `sdk_orchestrated` and `observer` included.

`classifySessionKind` treats `"unknown"` (no recognized `entrypoint` in the
first five lines of the transcript) as eligible for posture counting,
alongside `"interactive_cli"`. That's a deliberate conservative default: a
transcript with no detectable entrypoint reads as more likely a legitimate
session predating entrypoint tracking than a hostile observer echo.

The two rationales sit right next to each other in the code as inline
comments: posture commands are gated because observer/SDK sessions "echo the
primary session's `<command-name>` markup, falsely inflating posture
counters," while volume commands stay unconditional because
"autonomous-workflow signal is real regardless of who fired it."

## Guarding against drift

Because the correctness of this fix depends on `POSTURE_COMMANDS`,
`VOLUME_COMMANDS`, and the scanner's canonical `TARGET_COMMANDS` set staying
in sync, PR #110 also adds a fail-loud invariant check,
`assertCommandPartition`, run once at module load against the live sets:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

The check enforces three things: the posture and volume sets are disjoint;
every member of `TARGET_COMMANDS` (the scanner's full list of commands it
extracts from transcript text) is classified into one or the other; and
every classified command actually appears in `TARGET_COMMANDS` (catching
dead classification — a command listed in the partition but never scanned
for). Because this runs at import time, a future contributor who adds a new
command to `TARGET_COMMANDS` without classifying it — or misclassifies an
existing one — breaks `npm run assess` immediately with a thrown error,
before any score is computed or `assessment.json` is written, rather than
silently miscounting. `assertCommandPartition` is exported specifically so
`scripts/__tests__/_usage-data.test.mjs` can exercise the three failure
modes against forged sets, independent of the live module-level constants.

Two commands sit outside the partition by design and aren't covered by the
assertion at all: `effortMaxCommandUses` (detected by `hasEffortMax`, a regex
over prompt text rather than `<command-name>` markup) and
`planThenLaunchSessions` (a structural pattern keyed off an `ExitPlanMode`
tool_use, not a slash-command name).

## Consequences

Posture-command counters — `/color`, `/btw`, `/voice`, `/clear`, `/compact`,
`/simplify`, `/rewind`, `/focus`, `/fewer-permission-prompts` — can now only
be incremented by sessions the scanner classifies as `interactive_cli` or
`unknown`. Where observer/SDK echo was previously inflating a posture ratio's
numerator, that count now drops toward the true interactive figure. Several
of these commands (e.g. `/color`) already had a MAX-merge against
`~/.claude/history.jsonl` as a conservative floor, so their scored value was
partly protected before this change; `/rewind` has no such floor, since it's
a keyboard shortcut and isn't in the CLI's history command list, so it was
the counter most exposed to the fix.

Volume-command counters are unchanged in shape and behavior — `/loop`,
`/schedule`, `/babysit`, `/go`, `/batch` still count across every session
kind the scanner walks, including `sdk_orchestrated` and `observer`, so
autonomous-workflow signal fired by those session kinds keeps contributing
to the `scheduled` and related dimensions.

This adds one extra async call (`classifySessionKind`) per transcript file
in the scan — a bounded read of up to five lines per file — which is
negligible next to the full line-by-line scan the function already performs.

No probe-catalog entries, `satisfiedWhen` predicates, or `signalsSummary`
keys changed as part of this PR: the partition refines the accuracy of
existing posture-command signals rather than adding new ones, so the tracked
counts in `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
stay the same.
