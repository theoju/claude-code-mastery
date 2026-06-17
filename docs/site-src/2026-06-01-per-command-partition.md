---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Per-command partition: posture vs. volume

**PR #110 · shipped v0.9.18**

The transcript scanner in `scripts/_usage-data.mjs` counts slash-command
occurrences across `~/.claude/projects/*/*.jsonl`. Before PR #110, it applied
no session-kind filter. Observer sessions — which monitor a primary session and
emit structured observations — replicate the primary session's
`<command-name>cmd</command-name>` markup verbatim. Every `/color`, `/focus`,
or `/rewind` the user typed once was being counted twice: once from the
interactive transcript and once from the observer echo. `/focus` dropped from
15 to 1, `/rewind` from 7 to 0, and `/simplify` from 1 to 0 after the fix —
those weren't regressions, they were false-positive removals.

The fix is a **per-command partition** that applies the session-kind filter
selectively, not uniformly.

## The partition

Every command tracked by `scanTranscriptInvocations` belongs to exactly one
of two sets defined in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);

export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

| Class | Commands | Counted from |
|-------|----------|--------------|
| **Posture** | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` and `unknown` sessions only |
| **Volume** | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | All session kinds (unconditional) |

**Posture commands** reflect deliberate user habit — things the engineer typed
at a prompt. Observer and SDK-orchestrated sessions don't represent independent
user invocations, so echoes from those transcripts are excluded.

**Volume commands** represent autonomous-workflow signal. `/loop` firing inside
an SDK-orchestrated session is real: a subagent genuinely ran it. Filtering
those would delete accurate data. The v0.9.17 cycle proved this the hard way —
a blanket "exclude non-interactive sessions" fix dropped the Scheduled Work
score from 75 to 63 by deleting genuine `/loop` signal.

## Session-kind classification

At the top of each session's scan loop, the scanner calls
`classifySessionKind(path)`, which reads up to the first five transcript lines
looking for an `entrypoint` field:

| `entrypoint` value | Path contains | Kind |
|--------------------|---------------|------|
| `"cli"` or `"claude-desktop"` | — | `interactive_cli` |
| `"sdk-cli"` | `observer-sessions` | `observer` |
| `"sdk-cli"` | anything else | `sdk_orchestrated` |
| (no entrypoint in first 5 lines) | — | `unknown` |
| (path matches `/subagents/agent-`) | — | `subagent` |

`unknown` is treated as `interactive_cli` for posture counting — a conservative
fallback. A session with no detectable entrypoint is more likely to be a
legitimate interactive session predating entrypoint tracking than an observer
echo. Both interactive and unknown sessions set `allowPosture = true`:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters then gate on `allowPosture`; volume-command counters
stay structurally unchanged.

Note: `classifySessionKind` can return `"subagent"` for paths matching
`/subagents/agent-*.jsonl`, but the scanner's traversal reads
`projectsRoot/*/*.jsonl` — exactly two levels deep. Real subagent transcripts
live four levels deep (`projects/<project>/<uuid>/subagents/agent-*.jsonl`) and
are never reached by the current walk.

## Boundary assertion

`assertCommandPartition` runs at module load and fails loud if the partition
drifts:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

Three invariants are checked:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (no overlap)
2. Every member of `TARGET_COMMANDS` appears in one of the two sets (no
   uncategorized command)
3. Every member of the two sets appears in `TARGET_COMMANDS` (no dead
   classification)

If any invariant breaks — because a contributor added a command to
`TARGET_COMMANDS` without classifying it, or left a removed command in the
partition — the entire `npm run assess` invocation aborts before writing
`assessment.json`. A missing output file after a dependency bump means check
stderr for a partition-drift error before assuming an environmental issue.

## What sits outside the partition

Two detection paths in `scanTranscriptInvocations` are intentionally outside
the partition:

- **`effortMaxCommandUses`** — detected by a regex over user prompt text
  (`hasEffortMax(uText)`) rather than by slash-command name extraction. The
  partition asserts only over `TARGET_COMMANDS` names; argument-aware detection
  is a different code path.
- **`planThenLaunchSessions`** — a structural pattern detected via lookahead
  from `ExitPlanMode` tool-use events, not a slash-command name at all.

Both stay unconditional.

## Tests

Eleven tests cover the partition in `scripts/__tests__/_usage-data.test.mjs`:

- **Tests 1–6**: real-filesystem fixtures (no mocks) verify that posture
  commands don't count from observer and SDK-orchestrated sessions, that volume
  commands do, that interactive sessions count normally, and that the `unknown`
  fallback allows posture counting.
- **Test 7** (four sub-cases): `assertCommandPartition` is exported and tested
  directly against forged Sets — disjointness violation, uncategorized
  TARGET member, dead classification, and the live happy path.
- **Test 8**: regression fixture confirms existing interactive-only baselines
  (`color=1`, `loop=1`, `focus=1`) are unchanged post-partition.
