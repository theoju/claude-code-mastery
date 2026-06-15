---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command partition for transcript scanning (PR #110)

**Landed:** v0.9.18 · **Ticket:** CCE-78

## Problem

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walked
`~/.claude/projects/*/*.jsonl` with **no session-kind filter**. Observer
sessions monitor a primary session's work and faithfully echo its
`<command-name>/cmd</command-name>` markup into their own transcript — so
every posture command typed once by the user appeared twice in the counter:
once from the interactive session that actually ran it, once from the observer
session that watched it.

A v0.9.17 blanket fix excluded `observer`, `sdk_orchestrated`, and `subagent`
from the scanner entirely. That regressed the `scheduled` Execution scorer
from 75 → 63 by deleting genuine `/loop` and `/schedule` autonomous-workflow
signal. The regression was reverted. The correct fix is a per-command
partition, not a per-session-kind blanket.

## Design

Two named sets at module level in `scripts/_usage-data.mjs` replace the
implicit "count everything" behavior:

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

The partition reflects two different scoring semantics:

| Class | Commands | Counted from |
|-------|----------|--------------|
| **Posture** | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` and `unknown` sessions only |
| **Volume** | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | Every session kind the scanner visits |

Posture commands measure user behavior — how you personally configured your
Claude Code session. Observer noise here is a false positive. Volume commands
measure autonomous-workflow activity — `/loop` and `/schedule` are real
regardless of which session kind emitted them, including SDK-orchestrated
sessions running background pipelines.

### Session kind gate

At the top of each iteration over session files, `scanTranscriptInvocations`
now calls `classifySessionKind(path)` once and derives a boolean:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`unknown` is included deliberately. When a transcript has no recognizable
`entrypoint` field in its first five lines, `classifySessionKind` returns
`"unknown"` rather than failing. Treating that as posture-eligible is the
conservative choice: sessions predating entrypoint tracking are more likely
legitimate interactive sessions than hostile observers.

Subagent transcripts (`sdk_orchestrated`, `subagent`) have posture commands
suppressed. Note that the current scanner traversal reads exactly
`projects/*/*.jsonl` (two levels deep); real subagent files sit at
`projects/<project>/<uuid>/subagents/agent-*.jsonl` (four levels deep) and are
never visited. The classifier's `subagent` return value exists but is
unreachable via this traversal — documented inline so a future recursive-walk
PR can add the skip explicitly without inheriting silent assumptions.

### Boundary assertion

A fail-loud guard runs at module load via an exported helper:

```js
export function assertCommandPartition(posture, volume, target) { … }
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

The helper enforces three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjointness)
2. Every member of `TARGET_COMMANDS` appears in exactly one partition
3. Every partition member exists in `TARGET_COMMANDS` (no dead classification)

If any invariant fails, the entire `npm run assess` invocation aborts with a
stack trace — no `assessment.json` is written, no Slack post fires. This is
intentional: silent miscounting is worse than a loud failure. If the assessment
exits non-zero with no output file, check stderr for `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` errors before assuming an environmental issue.

## What changes at runtime

Expected after the partition lands:

- **Posture counters** (`colorCommandUses`, `btwCommandUses`, `voiceCommandUses`,
  `clearCommandUses`, `compactCommandUses`, `simplifyCommandUses`,
  `fewerPermsCommandUses`, `focusCommandUses`, `rewindCommandUses`) may drop
  modestly wherever observer markup was inflating. Most posture scorers have a
  history-floor via `Math.max(transcript_count, history_count)` in
  `run-assessment.mjs`, which absorbs small drops.
- **Volume counters** (`loopCommandUses`, `scheduleCommandUses`,
  `babysitLoopUses`, `goCommandUses`, `batchCommandUses`) are structurally
  unchanged.
- `/rewind` is the one posture command with no history-floor. Pre-partition
  author snapshot: ~7 raw, ~4 of which were observer false-positives → post
  ~3, still above the `>=1` threshold.

## What is not covered

- `effortMax` and `planThenLaunch` are outside the partition by design. Both
  are detected by structural patterns (a regex over user prompt text and a
  lookahead from `ExitPlanMode` tool_use events respectively), not by
  `extractSlashCommands`. The boundary assertion does not apply to them.
- Per-kind counter bucketing in the scanner output (deferred — only adds value
  if a future dashboard surface needs per-kind debugging breakdown).
- `classifySessionKind` fallback semantics are unchanged by this PR.

## Tests

Seven new `it` blocks in `scripts/__tests__/_usage-data.test.mjs` cover:

1. Posture command in an observer session does **not** count
2. Volume command in an observer session **does** count
3. Posture command in an SDK-orchestrated session does **not** count
4. Volume command in an SDK-orchestrated session **does** count
5. Posture command in an interactive session **does** count
6. Unknown entrypoint falls back to interactive (posture counts)
7. `assertCommandPartition` unit tests: disjointness violation, uncategorized
   TARGET member, dead classification, happy path

All fixtures use real-filesystem `mkdtempSync` + `writeFileSync` — no mocks,
matching the existing convention in the file.

**Markup note for fixture authors:** `extractSlashCommands` requires a literal
`/` inside the markup tag: `<command-name>/color</command-name>`. The
slash-less form `<command-name>color</command-name>` is what `scanTranscriptModes`
accepts — a different code path for a different purpose.

## Related

- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- Probe-tracker annotation: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  (Part 1 Transcripts layer, posture-command rows carry a partition footnote)
- CLAUDE.md "Command counting honors the posture-vs-volume partition" — the
  authoritative statement of this constraint for contributors
