---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command posture/volume partition (PR \#110)

Observer and SDK-orchestrated sessions echo the primary session's
`<command-name>/cmd</command-name>` markup into their own transcripts.
Before this change, `scanTranscriptInvocations` counted those echoes as
real invocations — `/focus` went from 15 to 1 once the partition landed.
The fix splits the scanned command set into two named partitions enforced
by a fail-loud module-load assertion, and gates the posture half behind a
per-session kind check.

## The two partitions

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` are module-level `Set` constants
exported from `scripts/_usage-data.mjs`.

| Partition | Members | Rule |
|-----------|---------|------|
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | Counted **only** when the session kind is `interactive_cli` or `unknown` |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | Counted across **all** session kinds the scanner sees |

The posture/volume distinction maps to semantic intent: posture commands
reflect user-level settings choices that observer and SDK sessions don't
actually make. Volume commands represent autonomous-workflow signal that is
real regardless of which session kind fired it — an SDK-orchestrated agent
that uses `/loop` is still evidence of that workflow pattern.

`/effort max` and `plan-then-launch` (`ExitPlanMode` lookahead) are not
in either partition. Both are detected by structural patterns — a
regex over prompt text and an assistant-turn lookahead respectively — not
by slash-command extraction. The partition's assertion doesn't apply to
them.

## Session kind classification

`classifySessionKind(path)` reads up to the first 5 lines of a transcript
looking for an `entrypoint` field, then returns one of four strings:

| Return value | Trigger |
|---|---|
| `"subagent"` | Path contains `/subagents/agent-` |
| `"interactive_cli"` | `entrypoint === "cli"` or `"claude-desktop"` |
| `"observer"` | `entrypoint === "sdk-cli"` **and** path contains `observer-sessions` |
| `"sdk_orchestrated"` | `entrypoint === "sdk-cli"` otherwise |
| `"unknown"` | No recognized `entrypoint` in first 5 lines |

`unknown` is treated as eligible for posture counting — the same as
`interactive_cli`. A session with no detectable entrypoint is more likely
a legitimate interactive session predating entrypoint tracking than a
hostile observer transcript. This is the conservative fallback.

The `subagent` classification exists in the function but is unreachable
from the scanner: `scanTranscriptInvocations` walks
`projectsRoot/*/*.jsonl` at exactly two levels deep, and real subagent
transcripts live at `projects/<project>/<uuid>/subagents/agent-*.jsonl`
(four levels deep). A future recursive traversal must add an explicit
`subagent` skip at the per-session loop.

## Boundary assertion

`assertCommandPartition(posture, volume, target)` runs at module load
against the live Sets. It enforces three invariants:

1. `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅` (disjoint)
2. Every member of `TARGET_COMMANDS` appears in posture or volume (no uncategorized command)
3. Every member of posture or volume appears in `TARGET_COMMANDS` (no dead classification)

Any violation throws immediately — `npm run assess` aborts before writing
`assessment.json` or posting to Slack. If the LaunchAgent exits non-zero
with no output file, check stderr for partition-drift errors before
assuming an environmental problem.

The function is exported so unit tests can exercise it directly against
forged Sets without import-cache games. The module-load call at the bottom
of the constant block then exercises it against the live Sets on every
import.

## Data flow

```
~/.claude/projects/*/*.jsonl
   (depth 2 only — subagent files at depth 4 are not reached)
        │
        ▼
classifySessionKind(path)
   "interactive_cli" | "sdk_orchestrated" | "observer" | "unknown"
        │
        ▼ allowPosture = kind === "interactive_cli" || kind === "unknown"
        │
scanTranscriptInvocations
   posture counters: gated behind allowPosture
   volume counters: unconditional
        │
        ▼
buildSignalsSummary
   history.jsonl MAX-merge preserved — clean interactive count
   becomes the LHS of Math.max(transcript_count, history_count)
        │
        ▼
score.mjs rubric predicates (unchanged)
```

The projection layer in `scripts/run-assessment.mjs` is byte-identical
after this change. The existing history MAX-merge (`maxProbe`) keeps its
conservative semantics; for most posture commands the history-derived
floor prevents score drops. `/rewind` has no history floor and was the
one at-risk counter — pre-partition the author recorded ~7 uses, of which
~4 were observer false-positives, leaving ~3 genuine interactive
invocations (still above the `>= 1` predicate threshold).

## Tests added (PR \#110)

Eleven new tests in `scripts/__tests__/_usage-data.test.mjs`, organized
into two `describe` blocks:

**`assertCommandPartition` (Test 7 — four cases)**

- Disjointness violation → throws `"must be disjoint"`
- `TARGET_COMMANDS` member missing from partition → throws `"not classified"`
- Partition member missing from `TARGET_COMMANDS` → throws `"dead classification"`
- Happy path against live Sets → no throw

**`scanTranscriptInvocations — per-command partition` (Tests 1–6, 8)**

| Test | Fixture | Assertion |
|---|---|---|
| 1 | Observer session (`sdk-cli` + `observer-sessions` path) with `<command-name>/color</command-name>` | `colorCommandUses === 0` |
| 2 | Same observer session with `<command-name>/loop</command-name>` | `loopCommandUses === 1` |
| 3 | SDK-orchestrated session (`sdk-cli`, non-observer path) with `/color` markup | `colorCommandUses === 0` |
| 4 | Same SDK-orchestrated session with `/loop` markup | `loopCommandUses === 1` |
| 5 | Interactive session (`entrypoint: "cli"`) with `/color` markup | `colorCommandUses === 1` |
| 6 | Unknown entrypoint (no entrypoint in first 5 lines) with `/color` markup | `colorCommandUses === 1` (conservative fallback) |
| 8 | Two interactive sessions with `/color` + `/loop` and `/focus` | counts unchanged from pre-partition baseline |

All fixtures use `mkdtempSync` real-filesystem files with `<command-name>/cmd</command-name>` markup (the slash inside the tag is required by `COMMAND_NAME_TAG_RE`; the slash-less form is a different code path in `scanTranscriptModes`).

## What changed in practice

Five volume counters (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
showed zero diff — autonomous-workflow signal was already clean. Posture
counters dropped where observer echoes had inflated them; the documented
worst case was `/focus` (15 → 1). `/simplify` and `/rewind` dropped to
zero at the author's snapshot, both entirely sourced from observer-session
echoes, which the spec predicted as a risk path.
