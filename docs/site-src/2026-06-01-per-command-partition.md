---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for observer-session false positives

**Shipped:** PR #110 · v0.9.18  
**Ticket:** CCE-78 follow-up  
**Related:** v0.9.16 (PR #96, `/color` fix via history MAX-merge), v0.9.17 (blanket-fix attempt, reverted)

## What changed

`scripts/_usage-data.mjs::scanTranscriptInvocations` now classifies every slash command it scans into one of two buckets — **posture** or **volume** — and applies a session-kind gate to the posture bucket only.

**Posture commands** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) represent user configuration choices. They are now counted only when `classifySessionKind` returns `"interactive_cli"` or `"unknown"` for the transcript being scanned. Observer and SDK-orchestrated sessions are excluded.

**Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) represent autonomous-workflow signal that is valid regardless of which session kind fires it. They continue to be counted across all session kinds the scanner sees.

The partition is declared as two exported `Set` constants:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

A fail-loud `assertCommandPartition(posture, volume, target)` helper runs at module load and enforces three invariants against the canonical `TARGET_COMMANDS` set:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjointness)
2. Every member of `TARGET_COMMANDS` appears in exactly one partition (no uncategorized command)
3. Every partition member appears in `TARGET_COMMANDS` (no dead classification)

If any invariant fails, the module throws before any scoring can run — `npm run assess` exits non-zero and writes no `assessment.json`. This is intentional. See [Operational note](#operational-note) below.

## Why

Observer sessions monitor a primary interactive session's work and emit structured observations. Because the CLI wraps slash commands in `<command-name>/cmd</command-name>` markup, observer sessions frequently replicate that markup verbatim in their own transcript. The scanner was reading those replicated entries and crediting them as additional user invocations.

The concrete example that surfaced this: `focusCommandUses` was reading 15 across the window; after the fix it read 1. The single real interactive invocation was buried under 14 observer echoes.

This mis-count inflated posture-based Execution scores and produced false-positive probe passes for `/simplify` and `/rewind` — both of which have a `>= 1` threshold that the observer echoes were trivially crossing.

The v0.9.17 cycle tried a blanket fix — excluding `observer`, `sdk_orchestrated`, and `subagent` from all scanning — and regressed the `scheduled` Execution score from 75 to 63 by silently discarding genuine `/loop`/`/schedule` signal from SDK-orchestrated runs. That change was reverted. The per-command partition is the correct shape: filter only where the signal is posture-specific, leave volume signal unconditional.

## How the gate works in practice

At the top of the per-session loop, the scanner calls `classifySessionKind(path)` once — approximately 5 extra lines read per transcript — and computes a boolean:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`"unknown"` is treated as interactive-eligible because a session with no detectable entrypoint is more likely to be a legitimate interactive session predating entrypoint tracking than an observer or SDK session. Observer transcripts consistently carry `entrypoint: "sdk-cli"` in their first line; interactive sessions carry `entrypoint: "cli"` or `entrypoint: "claude-desktop"`.

Every posture-command counter is then gated behind `allowPosture`. Volume-command counters are structurally unchanged.

Note on `effortMax` and `planThenLaunch`: these are not slash-command names matched by `extractSlashCommands`. `effortMax` uses a regex over user prompt text; `planThenLaunch` is a structural pattern detected via lookahead from `ExitPlanMode` tool-use events. Neither is in either partition Set — the assertion doesn't cover them.

Note on subagent transcripts: `classifySessionKind` can return `"subagent"` for paths matching `.../subagents/agent-*.jsonl`. However, the scanner's traversal reads `projectsRoot/*/*.jsonl` (exactly two levels deep). Real subagent transcripts live four levels deep at `projects/<project>/<uuid>/subagents/agent-*.jsonl` — unreachable from the current traversal. A future traversal change that recurses must add an explicit `if (sessionKind === "subagent") continue` at that point.

## Score impact

The fix is non-breaking overall — Platform Setup and Execution totals were unchanged (95 and 77 respectively) in the author's environment after the first run with the partition active.

Two predicate thresholds crossed downward as a spec-predicted consequence of removing observer false positives:

- `simplifyCommandUses >= 1` — the single real invocation remains, but the threshold had been satisfied by echoes before
- `rewindCommandUses >= 1` — `/rewind` has no history MAX-merge floor (it's a keyboard shortcut, not in the history command list), so it relies entirely on transcript counts; post-partition the count dropped below 1

These are correct behavior, not regressions. If your real posture-command usage is above zero, post-partition counts should still satisfy those predicates. If they dropped to zero, that's the accurate picture.

The history MAX-merge (`Math.max(transcript_count, history_count)`) in `run-assessment.mjs` is preserved. For commands like `/color` that also appear in `~/.claude/history.jsonl`, the history floor still acts as a lower bound on the reported count.

## Tests

Eight test cases were added to `scripts/__tests__/_usage-data.test.mjs`, covering the full `assertCommandPartition` helper (four cases: disjointness violation, missing target member, dead classification, happy path) and the per-session-kind behavior of `scanTranscriptInvocations` (observer blocks posture, observer passes volume, SDK-orchestrated blocks posture, SDK-orchestrated passes volume, interactive passes posture, unknown passes posture, regression: existing interactive counts unchanged).

All tests use `mkdtempSync` + `writeFileSync` real-filesystem fixtures, matching the file's existing convention. No mocks.

## Operational note

If `npm run assess` exits non-zero and no `assessment.json` is written, check stderr for a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error from the boundary assertion before assuming an environmental problem. The assertion fires if a dependency update or local edit adds a new command to `TARGET_COMMANDS` without classifying it — or classifies a command that no longer exists in `TARGET_COMMANDS`. Adding any new tracked slash command requires updating both `TARGET_COMMANDS` and the appropriate partition Set in `scripts/_usage-data.mjs`.

## What didn't change

- `buildSignalsSummary` output shape — unchanged; downstream consumers see the same field names
- `run-assessment.mjs` projection layer — byte-identical
- History MAX-merge logic — preserved
- `score.mjs` rules and universe declarations — orthogonal; they operate on session-meta `session_type`, not the transcript scanner's per-session kind classification
- `effortMaxCommandUses` and `planThenLaunchSessions` detection — both use structural patterns (regex, lookahead) rather than the slash-command extraction path; they stay outside the partition
