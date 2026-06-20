---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Per-command partition for transcript scanning

PR #110 introduces a hard split inside `scripts/_usage-data.mjs::scanTranscriptInvocations` that separates the 14 tracked slash commands into two disjoint categories. The split fixes a class of false-positive inflation where observer sessions echoed a primary session's `<command-name>` markup and caused posture counters to double-count a single user invocation.

## The problem

`scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per session. Before PR #110 it applied no session-kind filter. Observer sessions — which monitor a primary session's work and emit structured observations — replicate the primary session's `<command-name>/cmd</command-name>` markup verbatim. A single user invocation of `/focus` in an interactive session would produce a count of 2 or more once observer transcripts were included.

A prior blanket fix in v0.9.17 excluded all non-interactive sessions from the scanner entirely. That regressed the `scheduled` Execution score from 75 to 63 by deleting genuine `/loop`, `/schedule`, and `/babysit` signal: those commands represent autonomous-workflow intent that is real regardless of which session emitted them.

The correct shape is a per-command partition, not a blanket exclude.

## The two categories

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` are the exported module-level Sets that encode the partition (defined at `scripts/_usage-data.mjs`, lines 429–446):

| Category | Commands | Session filter |
|---|---|---|
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | Counted only from `interactive_cli` or `unknown` sessions |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | Counted from every session kind the scanner reaches |

**Posture** commands measure the user's interactive workflow preferences. They are meaningless when echoed by an observer process that never typed them. **Volume** commands measure autonomous-workflow throughput — a `/loop` or `/schedule` invocation from an SDK-orchestrated session is real signal.

`effortMax` and `planThenLaunch` are not in either set. `effortMax` is detected by `hasEffortMax(uText)` — a regex over prompt text, not a slash-command name — and `planThenLaunch` is a structural lookahead from `ExitPlanMode` tool-use events. Both sit outside the partition by design.

## How it works in the scanner

At the top of the per-session loop, `scanTranscriptInvocations` now calls `classifySessionKind(path)` once and derives an `allowPosture` flag:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`classifySessionKind` reads up to the first 5 lines of the transcript looking for an `entrypoint` field. `"cli"` or `"claude-desktop"` → `interactive_cli`; `"sdk-cli"` under `observer-sessions/` → `observer`; `"sdk-cli"` elsewhere → `sdk_orchestrated`. No recognized entrypoint in the first 5 lines → `"unknown"`.

`"unknown"` is treated as eligible for posture counting. The reasoning: a transcript with no detectable entrypoint is more likely a legitimate interactive session predating entrypoint tracking than a hostile observer transcript. This is the conservative fallback.

Posture-command counters then gate on `allowPosture`:

```js
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("color") && allowPosture) sessionHasColor = true;
// … same pattern for all nine posture commands
```

Volume-command counters are structurally unchanged — no `allowPosture` check.

### Note on subagent sessions

`classifySessionKind` returns `"subagent"` when the path matches `/subagents/agent-`. However, the scanner traversal reads `projectsRoot/*/*.jsonl` (exactly two levels deep). Real subagent transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl` — four levels deep — and are unreachable from the current traversal. A future traversal that recurses must add an explicit `if (sessionKind === "subagent") continue` guard; the inline comment at `scripts/_usage-data.mjs:298` flags this for the future implementer.

## Fail-loud boundary assertion

`assertCommandPartition(posture, volume, target)` is an exported helper that runs at module load (line 475). It enforces three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` — the sets are disjoint.
2. `TARGET_COMMANDS ⊆ POSTURE_COMMANDS ∪ VOLUME_COMMANDS` — every scanned command is classified.
3. `POSTURE_COMMANDS ∪ VOLUME_COMMANDS ⊆ TARGET_COMMANDS` — no dead classification (a command in the partition that is no longer scanned).

Adding a new command to `TARGET_COMMANDS` without classifying it in one of the two sets causes the entire `npm run assess` invocation to abort before any score is written — no `assessment.json`, no Slack post, no dashboard update. The operational note in CLAUDE.md (`## Hard rules`) captures this: if the assessment exits non-zero with no `assessment.json`, check stderr for partition-drift errors before assuming an environmental issue.

## Test coverage

PR #110 adds 11 new unit tests in `scripts/__tests__/_usage-data.test.mjs`. The tests use real-filesystem fixtures via `mkdtempSync` + `writeFileSync` — no mocks — consistent with the existing test convention. Key cases:

| Test | Fixture | Assertion |
|---|---|---|
| Posture in observer session | `sdk-cli` entrypoint under `observer-sessions/`, `/color` markup | `colorCommandUses === 0` |
| Volume in observer session | Same shape, `/loop` markup | `loopCommandUses === 1` |
| Posture in SDK-orchestrated session | `sdk-cli` outside `observer-sessions/`, `/color` markup | `colorCommandUses === 0` |
| Volume in SDK-orchestrated session | Same SDK shape, `/loop` markup | `loopCommandUses === 1` |
| Posture in interactive session | `cli` entrypoint, `/color` markup | `colorCommandUses === 1` |
| Unknown entrypoint → interactive fallback | No entrypoint field, `/color` markup | `colorCommandUses === 1` |
| `assertCommandPartition` disjointness violation | Forged overlapping sets | throws `"must be disjoint"` |
| `assertCommandPartition` uncategorized command | `TARGET_COMMANDS` member not in either set | throws `"not classified"` |
| `assertCommandPartition` dead classification | Partition member not in `TARGET_COMMANDS` | throws `"dead classification"` |
| `assertCommandPartition` happy path | Live sets | no throw |

The existing interactive-only fixtures are unaffected — they all use `entrypoint: "cli"` or no entrypoint (→ `"unknown"`), both of which fall into `allowPosture = true`.

## Observed impact

After the fix, posture-command counts drop wherever observer markup was inflating them. The example from the PR: `focusCommandUses` fell from 15 to 1. The MAX-merge at `run-assessment.mjs` (which takes `max(transcript_count, history.jsonl_count)` for most posture commands) provides a floor from `~/.claude/history.jsonl` for commands that also appear there, so most posture scorers are insulated from dramatic swings.

`/rewind` has no history MAX-merge floor — it is a keyboard shortcut, not a typed slash command — and its counter dropped as a spec-predicted false-positive removal. Two other probes (`simplifyCommandUses`, `rewindCommandUses`) crossed their thresholds downward; these are correctly identified in the PR as spec-predicted corrections, not regressions.

Volume commands (`/schedule`, `/loop`, `/go`, `/batch`, `/babysit`) were unchanged by the fix, consistent with the intent.

## Data flow

```
~/.claude/projects/*/*.jsonl          (depth-2 traversal only)
         │
         ▼
classifySessionKind(path)
  → interactive_cli | sdk_orchestrated | observer | unknown
         │
         ▼
scanTranscriptInvocations
  interactive_cli | unknown  →  posture + volume counters
  sdk_orchestrated | observer  →  volume counters only
         │
         ▼
buildSignalsSummary   (Math.max merge with history.jsonl unchanged)
         │
         ▼
score.mjs rubric predicates   (unchanged)
```

## Related

- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- Probe tracker: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` (Transcripts layer — posture-command rows carry a partition footnote as of PR #110)
- CLAUDE.md `## Hard rules` → "Command counting honors the posture-vs-volume partition"
