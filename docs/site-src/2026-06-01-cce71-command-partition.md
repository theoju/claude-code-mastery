---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# CCE-71: Posture-vs-volume command partition

**Merged:** PR #110 · **Ticket:** CCE-71

## The problem

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences across every
transcript it finds. Before this change it applied **no session-kind filter**,
which meant observer sessions and SDK-orchestrated sessions were counted alongside
real interactive ones.

Observer sessions monitor a primary interactive session and emit structured
observations. As a side effect they replay the primary session's
`<command-name>/cmd</command-name>` markup verbatim. A single `/color`
invocation in an interactive session would therefore produce two counts: one from
the interactive transcript and one from the observer transcript that shadowed it.
The result was silently inflated posture-command counters — inflated not because
you used the command more, but because the observer's echo looked identical to
a genuine user turn.

An earlier fix (v0.9.16, PR #96) accidentally masked the bug for `/color` by
MAX-merging the transcript count with the `history.jsonl` count (which only
contains typed interactive prompts). The mask was conservative in the right
direction, but the underlying transcript count remained polluted.

A v0.9.17 attempt to fix this with a blanket session exclusion — dropping
`observer`, `sdk_orchestrated`, and `subagent` sessions entirely from the scanner
— regressed the `scheduled` dimension from 75 to 63 by deleting genuine
`/loop` and `/schedule` signal from autonomous-workflow sessions. That PR was
reverted.

## The distinction that matters

Not all commands carry the same semantic weight with respect to session kind:

- **Posture commands** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) reflect
  choices the _user_ makes about how they want to interact. They only mean
  something when a human typed them in an interactive session. An observer
  session echoing `/btw` markup is noise, not signal.

- **Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
  represent autonomous workflow activity. A `/loop` invocation inside an
  SDK-orchestrated session is real — the automation ran. Excluding it from
  the count would hide genuine usage.

The posture/volume distinction had been described in CLAUDE.md as a deferred
constraint. PR #110 turns it into enforced code.

## What changed

Three additions to `scripts/_usage-data.mjs`:

### 1. Two named exports

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

These replace the implicit "count everything" assumption with an explicit,
named classification that is visible to callers and tests.

### 2. Fail-loud boundary assertion

```js
export function assertCommandPartition(posture, volume, target) { … }
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

`assertCommandPartition` runs at module load and checks three invariants:

| Check | Error |
|---|---|
| `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` | "must be disjoint" |
| `TARGET_COMMANDS ⊆ posture ∪ volume` | "not classified as posture or volume" |
| `posture ∪ volume ⊆ TARGET_COMMANDS` | "dead classification" |

If the assertion fires, `npm run assess` aborts before writing
`assessment.json`. No partial output, no silently wrong score. If you see the
process exit non-zero with no `assessment.json`, check stderr for
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` errors before assuming an environmental
issue.

The function is exported so vitest can test it against forged Sets without
import-cache tricks. The live assertion calls the exported helper against the
live module-level Sets.

### 3. Per-session gate inside `scanTranscriptInvocations`

At the top of the per-session loop, the session kind is classified once:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Volume-command counters are structurally unchanged — they increment on every
session the scanner reaches. Posture-command flags are gated behind
`allowPosture`:

```js
if (found.has("color") && allowPosture) sessionHasColor = true;
if (found.has("loop")) sessionHasLoop = true;      // volume — unconditional
```

`classifySessionKind` reads up to the first 5 lines of a transcript looking for
an `entrypoint` field. The recognized values and their kinds:

| `entrypoint` value | Path condition | Kind |
|---|---|---|
| `"cli"` | any | `interactive_cli` |
| `"claude-desktop"` | any | `interactive_cli` |
| `"sdk-cli"` | path contains `observer-sessions` | `observer` |
| `"sdk-cli"` | other | `sdk_orchestrated` |
| absent in first 5 lines | any | `unknown` |
| path matches `.../subagents/agent-*.jsonl` | any | `subagent` |

The `"unknown"` fallback is treated as eligible for posture counting alongside
`interactive_cli`. A session that predates entrypoint tracking (or uses an
alternate UI) is more likely a legitimate interactive session than a hostile
observer transcript. `"subagent"` exists in the classifier but is unreachable
from this scanner because the traversal reads exactly two levels deep
(`projectsRoot/*/*.jsonl`) and real subagent transcripts live four levels deep.

## Design choices

**Why not exclude unknown sessions from posture?** The conservative choice is
to include rather than exclude when evidence is missing. Excluding `"unknown"`
would silently drop older transcripts that predate the `entrypoint` field,
understating real usage. If a specific transcript kind needs exclusion, update
`classifySessionKind` to return a named kind and add an explicit guard —
don't change the fallback semantics.

**Why one `classifySessionKind` call per session, not per line?** The session
kind is a property of the whole session, not individual lines. Classifying once
at loop entry is cheaper and semantically correct.

**Why does `effortMax` stay outside the partition?** `effortMaxCommandUses` is
detected by regex over user prompt text (`hasEffortMax(uText)`), not via the
`<command-name>` markup that observer sessions echo. Observer replay of
`/effort max` through the markup path would need a `<command-name>/effort` tag
plus a `<command-args>max</command-args>` tag in a single user turn — a pattern
that hasn't been observed in practice. The partition assertion only covers
commands in `TARGET_COMMANDS`; `effortMax` is not in that set.

## Score impact

The fix narrows posture-command counters to sessions where the signal is
genuine. In practice, wherever observer noise was inflating a posture counter,
the count drops. The history MAX-merge for `/color` and similar
history-backed commands preserves a floor, so most posture scorers stay stable.

`/rewind` is the highest-risk posture command: it has no history floor (it's a
keyboard shortcut, not in `history.jsonl`). At the time of merge, pre-partition
`rewindCommandUses` ≈ 7; post-partition ≈ 3 (four observer false-positives
removed). The `>= 1` threshold remained satisfied. If you run `npm run assess`
immediately after this lands and see a modest drop in posture-command counts,
that's the partition correcting inflated numbers — not a regression.

Volume-command counts (`scheduleCommandUses`, `loopCommandUses`, etc.) are
unaffected.

## Tests

Eleven new tests cover the partition. Seven are in the
`scanTranscriptInvocations — per-command partition` describe block in
`scripts/__tests__/_usage-data.test.mjs`:

- **Test 1:** posture command (`/color`) in observer session → `colorCommandUses === 0`
- **Test 2:** volume command (`/loop`) in observer session → `loopCommandUses === 1`
- **Test 3:** posture command in SDK-orchestrated session → `colorCommandUses === 0`
- **Test 4:** volume command in SDK-orchestrated session → `loopCommandUses === 1`
- **Test 5:** posture command in interactive (`entrypoint: "cli"`) session → `colorCommandUses === 1`
- **Test 6:** unknown entrypoint (no `entrypoint` in first 5 lines) → `colorCommandUses === 1`
- **Test 8:** pre-existing interactive fixtures produce identical counts before and after the partition

Four more test the exported `assertCommandPartition` helper directly against
forged Sets (`disjointness violation`, `uncategorized TARGET member`,
`dead partition member`, `happy path`).

All pre-existing tests continue to pass: existing transcript fixtures use
`entrypoint: "cli"` or no entrypoint, both of which map to `allowPosture = true`.

## Related

- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- `scripts/_usage-data.mjs` — `POSTURE_COMMANDS`, `VOLUME_COMMANDS`,
  `assertCommandPartition`, `scanTranscriptInvocations`
- CLAUDE.md — "Command counting honors the posture-vs-volume partition" (the
  deferred note this PR resolved and rewrote)
- v0.9.17 blanket-fix revert — the precursor that regressed `scheduled` 75→63
  and established that per-command partitioning is the correct shape
