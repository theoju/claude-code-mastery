---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command partition for transcript-based command counting

**Date:** 2026-05-31  
**Closes:** CCE-71  
**PR:** [#110](https://github.com/theoju/claude-code-self-assessment/pull/110)

## Problem

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session. Before PR #110 it applied no session-kind filter: observer sessions
(which monitor a primary session and emit structured observations) and
SDK-orchestrated sessions were scanned on equal footing with interactive ones.

Observer sessions re-emit the primary session's
`<command-name>/cmd</command-name>` markup verbatim. Every interactive command
the user typed therefore appeared twice — once in the real session, once in the
observer — inflating posture counters. The documented case: `focusCommandUses`
read **15** before the fix and **1** after.

This is a posture-signal accuracy problem, not a volume-signal problem. A
`/loop` invocation inside an SDK-orchestrated session represents genuine
autonomous-workflow activity and should count regardless of who triggered it.

## Prior attempt and why it was reverted

v0.9.17 attempted a blanket fix: exclude `observer`, `sdk_orchestrated`, and
`subagent` sessions from `scanTranscriptInvocations` entirely. This regressed
the `scheduled` dimension score from **75 → 63** by deleting genuine
`/loop` / `/schedule` signal from autonomous-workflow sessions. It was reverted
before release.

The blanket exclusion collapsed two independent questions — _"is this a user
posture signal?"_ and _"is this autonomous-workflow volume?"_ — into a single
filter that couldn't answer both correctly at once.

## Decision

Introduce a **per-command partition** directly in `scanTranscriptInvocations`.
Two named module-level Sets encode the classification:

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

At the top of the per-session loop the scanner calls `classifySessionKind(path)`
(reads up to the first 5 lines, inspects the `entrypoint` field) and derives a
boolean gate:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters are incremented only when `allowPosture` is true.
Volume-command counters are incremented unconditionally — exactly as before.

### Why `"unknown"` is allowed

`classifySessionKind` returns `"unknown"` when no recognized `entrypoint` value
appears in the first 5 lines. That outcome is more likely a legitimate
interactive session predating entrypoint tracking than an observer transcript.
The conservative choice is to count it.

### What sits outside the partition

Two signals in `scanTranscriptInvocations` are detected by structural patterns
rather than slash-command extraction and stay unconditional:

- `effortMaxCommandUses` — detected by `hasEffortMax(uText)`, a regex that
  requires both a `<command-name>/effort</command-name>` tag and a
  `<command-args>max</command-args>` tag (or a bare `^/effort max` line). An
  observer session can echo the tag pair, but the `effort max` reflex is a
  user-driven invocation pattern distinct from the posture-command set.
- `planThenLaunchSessions` — detected via structural lookahead from an
  `ExitPlanMode` tool_use event, not from user message text at all.

## Boundary assertion

A fail-loud `assertCommandPartition` function runs at module load time,
checking three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjoint)
2. Every member of `TARGET_COMMANDS` appears in exactly one partition set
3. Every partition member appears in `TARGET_COMMANDS` (no dead classification)

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

If any invariant is violated, `_usage-data.mjs` throws at import time — before
any score is written and before any Slack post is sent. The assessment exits
non-zero with a descriptive error. If `npm run assess` exits non-zero with no
`assessment.json` written, check stderr for a partition-drift error before
assuming an environmental issue.

The helper is exported (`assertCommandPartition`) so tests can exercise it
against forged Sets without import-cache games.

## Score impact

Posture command counts drop wherever observer markup was inflating them. Volume
command counts are unchanged. The history MAX-merge in `run-assessment.mjs`
(which takes `Math.max(transcript_count, ~/.claude/history.jsonl count)`) keeps
a conservative floor for most posture scorers.

`rewindCommandUses` is the posture command with no history floor — the command
is a keyboard shortcut, not logged by `history.jsonl`. Pre-partition: ~7;
post-partition: ~3 (four observer false-positives removed). Still above the
`>= 1` adoption threshold. Two probes that now correctly read zero:
`simplifyCommandUses >= 1` and `rewindCommandUses >= 1` in sessions where
observer inflation was the only source — this is the partition working
correctly, not a regression.

## Test coverage

Eleven net-new unit tests in `scripts/__tests__/_usage-data.test.mjs` cover:

| Test | Scenario |
| ---- | -------- |
| 1 | Posture command in observer session → does **not** count |
| 2 | Volume command in observer session → **does** count |
| 3 | Posture command in SDK-orchestrated session → does **not** count |
| 4 | Volume command in SDK-orchestrated session → **does** count |
| 5 | Posture command in interactive (`entrypoint: "cli"`) session → **does** count |
| 6 | Unknown entrypoint falls back to interactive → posture command **counts** |
| 7a | `assertCommandPartition` catches disjointness violation |
| 7b | `assertCommandPartition` catches uncategorized `TARGET_COMMANDS` member |
| 7c | `assertCommandPartition` catches dead partition member |
| 7d | `assertCommandPartition` happy path (live Sets) → no throw |
| 8 | Pre-existing interactive-only fixtures are unaffected |

## Where to find the canonical source

- Sets and assertion: `scripts/_usage-data.mjs` (exported as
  `POSTURE_COMMANDS`, `VOLUME_COMMANDS`, `assertCommandPartition`)
- Partition gate in the scanner: `scanTranscriptInvocations` — look for the
  `allowPosture` flag at the top of the `for (const path of sessionFiles)`
  loop
- Design rationale: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- CLAUDE.md hard-rule: "Command counting honors the posture-vs-volume
  partition" section
