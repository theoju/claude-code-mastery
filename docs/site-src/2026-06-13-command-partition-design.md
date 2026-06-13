---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command posture-vs-volume partition (PR #110)

**Date:** 2026-06-13  
**Status:** Shipped (v0.9.18)  
**Ticket:** CCE (filed alongside PR #110)  
**File:** `scripts/_usage-data.mjs`

## Problem

`scanTranscriptInvocations` walked `~/.claude/projects/*/*.jsonl` with no session-kind filter. Observer sessions — which monitor a primary interactive session and emit structured observations — replicate the primary session's `<command-name>/cmd</command-name>` markup verbatim. Every command a user types in an interactive session got echoed into the observer transcript with identical markup, and the scanner counted both, doubling (at minimum) every posture-command counter.

The effect was specifically on **posture commands** — commands like `/color`, `/voice`, `/btw`, `/rewind`, `/simplify` that measure whether the user is actively shaping their CLI environment. Volume commands (`/loop`, `/schedule`, `/babysit`) were also echoed but the double-count there represents the same autonomous-workflow event, which is still real signal.

## Three approaches considered

### Approach 1: blanket exclusion (v0.9.17, reverted)

Exclude `observer`, `sdk_orchestrated`, and `subagent` from `scanTranscriptInvocations` entirely. This is the simplest implementation — one `continue` at the top of the per-session loop.

**Why it was reverted:** it deleted genuine `/loop` and `/schedule` signal from SDK-orchestrated sessions, regressing the scheduled-work Execution score from 75 to 63. The semantic point is that `/loop` fired by an SDK automation is still a real autonomous-workflow event regardless of which session kind emitted it. A blanket exclusion conflated "posture signal I want from only the user" with "volume signal that's real from anyone."

### Approach 2: MAX-merge from history.jsonl (v0.9.16 accident)

`colorCommandUses` was already MAX-merged from `~/.claude/history.jsonl` via the `maxProbe` helper in `run-assessment.mjs`. History only records typed interactive prompts, so its count is already clean. The merge masked the false-positive bug for `/color`.

**Why it's not the right fix for the rest:** it's an accident of the history-logging surface, not a principled fix. Commands without a history entry (`/rewind`, `/simplify`, `/fewer-permission-prompts`) had no floor. Extending the MAX-merge to every posture command would require knowing in advance which commands appear in history — the same classification problem, encoded implicitly and invisibly.

### Approach 3: per-command partition (PR #110, shipped)

Two named `Set` constants at module level in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

In `scanTranscriptInvocations`, one `classifySessionKind(path)` call per session produces a kind string (`"interactive_cli"`, `"sdk_orchestrated"`, `"observer"`, `"unknown"`). A boolean gate:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters update only when `allowPosture` is true. Volume-command counters update unconditionally.

**Why this is the right shape:** it makes the semantic distinction explicit in the code and in the constant names. A future contributor adding a new command has to decide which set it belongs to — and the boundary assertion (below) will fail loudly if they forget.

## The boundary assertion

`assertCommandPartition` is exported and called at module load (line 475 in `_usage-data.mjs`):

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

It checks three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` — no command is in both sets.
2. Every member of `TARGET_COMMANDS` (the canonical scanned set) appears in exactly one of the two partition sets — no unclassified scanned command.
3. Every member of the partition is in `TARGET_COMMANDS` — no dead classification.

If any invariant fails, the module throws at load time. `npm run assess` aborts before writing `assessment.json`. If you see the assessment exit non-zero with no output file, check stderr for a partition-drift error before assuming an environmental issue.

## The `unknown` fallback

`classifySessionKind` reads up to the first 5 lines of a transcript looking for an `entrypoint` field:

- `"cli"` or `"claude-desktop"` → `"interactive_cli"`
- `"sdk-cli"` in an `observer-sessions/` path → `"observer"`
- `"sdk-cli"` elsewhere → `"sdk_orchestrated"`
- No recognized entrypoint in the first 5 lines → `"unknown"`

The partition treats `"unknown"` as eligible for posture counting (`allowPosture = true`). The reasoning: a session with no detectable entrypoint is more likely to be a legitimate interactive session predating entrypoint tracking than an observer transcript that happens to have a malformed header. Conservative fallback — err toward counting.

## What `effortMax` and `planThenLaunch` are not in the partition

`effortMax` is detected by `hasEffortMax(uText)` — a regex over the user prompt text — not by `extractSlashCommands`. `planThenLaunch` is a structural pattern: a lookahead from `ExitPlanMode` tool-use events to the next assistant turn. Neither is a slash-command name in `TARGET_COMMANDS`, so the partition assertion doesn't apply to them. Both stay unconditional.

## Observed effects at first run

Two posture-command counters dropped to zero after the partition landed: `simplifyCommandUses` and `rewindCommandUses`. Both were entirely observer-session inflation — no genuine interactive invocations in the lookback window. This matched the spec's predicted risk path for `/rewind` (which has no `history.jsonl` MAX-merge floor). The probes gated on those counters (`rewindCommandUses >= 1`, `simplifyCommandUses >= 1`) now return false, accurately.

Volume-command counters (`loopCommandUses`, `scheduleCommandUses`, `goCommandUses`, `batchCommandUses`, `babysitLoopUses`) were unchanged — the partition correctly preserved all autonomous-workflow signal.

## Tests

Seven partition-specific test cases live in `scripts/__tests__/_usage-data.test.mjs`:

- Posture command in observer session → `colorCommandUses === 0`
- Volume command in observer session → `loopCommandUses === 1`
- Posture command in SDK-orchestrated session → `colorCommandUses === 0`
- Volume command in SDK-orchestrated session → `loopCommandUses === 1`
- Posture command in interactive session → `colorCommandUses === 1`
- Unknown entrypoint falls back to interactive → `colorCommandUses === 1`
- `assertCommandPartition` helper: disjointness violation, missing classification, dead classification, and happy-path — all four branches.

The `<command-name>` markup in test fixtures must include the leading slash: `<command-name>/color</command-name>`. The slash-less form is what `scanTranscriptModes` accepts via its separate `COMMAND_NAME_RE` — a different code path that is easy to confuse.

## CLAUDE.md canonical reference

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the authoritative source. CLAUDE.md's "Command counting honors the posture-vs-volume partition" section is the human-readable statement; the Sets and assertion are the machine-enforced form. If they diverge, the code wins.
