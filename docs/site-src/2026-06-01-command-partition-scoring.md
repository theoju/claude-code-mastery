---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Command partition: posture vs. volume (PR #110)

**Decision date:** 2026-05-31  
**Ticket:** CCE (PR #110)  
**Affected file:** `scripts/_usage-data.mjs`

## The problem: observer sessions inflating posture counters

`scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl` and counts
slash-command occurrences per session. Before PR #110 it applied **no
session-kind filter** — every transcript counted, including observer sessions
(which mirror the primary session's `<command-name>/cmd</command-name>` markup)
and SDK-orchestrated sessions. A single `/color` invocation in an interactive
session could be double-counted once more for every observer session watching
it.

### The failed blanket fix (v0.9.17)

An earlier attempt excluded `observer`, `sdk_orchestrated`, and `subagent`
sessions from the scanner entirely. That blanket filter regressed the
`scheduled` dimension score from 75 → 63 by deleting genuine autonomous-workflow
signal: `/loop`, `/schedule`, and `/babysit` invocations fired from SDK-run or
observer contexts represent real orchestration activity — dropping them
understated how much automation the user actually ran.

## The correct fix: a per-command partition

The right boundary is semantic, not session-based. Two classes of command exist:

| Class | Commands | Counted when |
|---|---|---|
| **Posture** | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | Session kind is `interactive_cli` or `unknown` only |
| **Volume** | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | All session kinds — unconditional |

Posture commands reflect user-settable interaction style. An observer session
echoing them in its structured markup did not invoke them; they shouldn't count.
Volume commands reflect autonomous-workflow invocations. Those signals are valid
regardless of which session kind fired them.

The two Sets are defined at module level in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside the per-session loop, the gate is:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Posture-command counters (`colorCommandUses`, `btwCommandUses`, etc.) are gated
behind `if (found.has("…") && allowPosture)`. Volume-command counters remain
structurally unchanged.

### Why `unknown` counts as posture-eligible

`classifySessionKind` returns `"unknown"` when no recognized `entrypoint` field
appears in the first five lines of a transcript. The conservative choice is to
treat this as potentially interactive rather than silently suppress it — a
session with no detectable entrypoint is more likely a legitimate CLI session
predating entrypoint tracking than a hostile observer replay.

### Why subagent is not explicitly skipped

`classifySessionKind` returns `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`. However, the scanner traverses
`projectsRoot/*/*.jsonl` (exactly two path levels). Real subagent transcripts
live at `projects/<project>/<uuid>/subagents/agent-*.jsonl` — four levels deep.
The scanner never reaches them under the current traversal. An explicit subagent
skip would be dead code today; the code comments this inline so a future
traversal change can add the guard explicitly rather than inherit a silent
assumption.

## The `assertCommandPartition` invariant

The partition is enforced at module load by an exported helper:

```js
export function assertCommandPartition(posture, volume, target) {
  const union = new Set([...posture, ...volume]);
  if (posture.size + volume.size !== union.size) {
    throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
  }
  for (const cmd of target) {
    if (!union.has(cmd)) {
      throw new Error(
        `TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`,
      );
    }
  }
  for (const cmd of union) {
    if (!target.has(cmd)) {
      throw new Error(
        `Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`,
      );
    }
  }
}

assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

The assertion catches three drift cases at startup:

1. **Overlap** — a command in both Sets (`posture ∩ volume ≠ ∅`)
2. **Uncategorized** — a command in `TARGET_COMMANDS` that belongs to neither Set
3. **Dead classification** — a command in a Set that is no longer in `TARGET_COMMANDS`

If any invariant is violated, the entire `npm run assess` invocation aborts with
a stack trace before any score is written — no `assessment.json`, no Slack post.
This is intentional: silent miscounting is worse than a loud failure. If your
assessment exits non-zero with no `assessment.json` written after a dependency
bump, check stderr for partition-drift errors before assuming an environmental
issue.

## Test coverage

PR #110 added eight test cases to
`scripts/__tests__/_usage-data.test.mjs`:

| Test | Scenario | Assertion |
|---|---|---|
| 1 | Posture command (`/color`) in observer session | `colorCommandUses === 0` |
| 2 | Volume command (`/loop`) in observer session | `loopCommandUses === 1` |
| 3 | Posture command in SDK-orchestrated session | `colorCommandUses === 0` |
| 4 | Volume command in SDK-orchestrated session | `loopCommandUses === 1` |
| 5 | Posture command in interactive (`entrypoint: "cli"`) session | `colorCommandUses === 1` |
| 6 | Session with unknown entrypoint falls back to interactive | `colorCommandUses === 1` |
| 7a–d | `assertCommandPartition` against forged Sets | Throws on each violation; no throw on happy path |
| 8 | Interactive-only fixtures retain pre-partition baseline counts | Regression guard |

All fixtures use `<command-name>/cmd</command-name>` markup (with the leading
`/` inside the tag) to match the `COMMAND_NAME_TAG_RE` regex in
`extractSlashCommands`. The slash-less form `<command-name>cmd</command-name>`
is a different code path used by `scanTranscriptModes` — easy to confuse.

## Score impact

Posture-command counts (`color`, `btw`, `voice`, `clear`, `compact`, `simplify`,
`fewer-perms`, `focus`, `rewind`) may drop slightly on the first run after the
partition deploys, wherever observer markup was inflating them. The history
`maxProbe` merge at `run-assessment.mjs` preserves a floor derived from
`~/.claude/history.jsonl` for most commands, keeping scores stable in practice.
Volume-command counts (`schedule`, `/go`, `/batch`, `/loop`, `/babysit`) are
unchanged — the regression from the v0.9.17 blanket fix does not recur.

`/rewind` is the one posture command with no history floor. Pre-partition counts
were approximately 7; observer false-positives accounted for ~4, leaving ~3
after the fix — still above the `>= 1` adoption threshold.

## Relation to CLAUDE.md

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the
**canonical partition source**. The CLAUDE.md "Command counting honors the
posture-vs-volume partition" section points to these Sets as the single source of
truth. The boundary assertion converts a latent convention (previously documented
only in CLAUDE.md as a deferred follow-up) into a module-load invariant that
fails loudly if the partition drifts.
