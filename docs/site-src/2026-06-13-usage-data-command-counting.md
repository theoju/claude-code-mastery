---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Command counting in `_usage-data.mjs`

`scripts/_usage-data.mjs` is the module that walks `~/.claude/projects/*/*.jsonl`
and turns raw transcript events into the slash-command counters that
`scripts/insights-signals.mjs` surfaces as Execution signals. This page
describes the permanent design decisions that govern how commands are counted:
the posture/volume partition, the session-kind classifier, the fail-loud
boundary assertion, and the two signals that sit outside the partition entirely.

## The core problem: observer-session echoes

Observer sessions (entrypoint `sdk-cli` under a path containing
`observer-sessions`) monitor a primary interactive session's work and emit
structured observations. They replicate the primary session's
`<command-name>/cmd</command-name>` markup verbatim. Without a filter, every
command the user types in an interactive session is counted _twice_ — once from
the interactive transcript and once from the observer's echo — inflating posture
counters without representing any additional user action.

SDK-orchestrated sessions (`entrypoint: sdk-cli` outside an observer path) have
the same issue: they can re-emit markup from the prompts they were given,
producing false command sightings that have nothing to do with the user's
day-to-day CLI behaviour.

## The two command sets

Every command that `scanTranscriptInvocations` tracks belongs to exactly one of
two named sets:

```js
// scripts/_usage-data.mjs

export const POSTURE_COMMANDS = new Set([
  "color",
  "voice",
  "focus",
  "btw",
  "clear",
  "compact",
  "simplify",
  "rewind",
  "fewer-permission-prompts",
]);

export const VOLUME_COMMANDS = new Set([
  "loop",
  "schedule",
  "babysit",
  "go",
  "batch",
]);
```

| Class | Semantics | Counting rule |
|---|---|---|
| **Posture** | User-facing CLI commands that shape interaction style (output format, context management, permission prompts). Observer and SDK sessions echo these but did not invoke them. | Counted only from `interactive_cli` and `unknown` sessions |
| **Volume** | Autonomous-workflow triggers that represent real work happening regardless of who dispatched the session. | Counted from every session kind the scanner sees |

`TARGET_COMMANDS` is the union of both sets — the full list of commands
`scanTranscriptInvocations` looks for. It stays as the single declaration of
"what we scan for"; the two partition sets derive from it.

## Session-kind classification

`classifySessionKind(path)` reads up to the first five lines of a transcript,
looking for an `entrypoint` field:

| `entrypoint` value | Path condition | Returned kind |
|---|---|---|
| path matches `/subagents/agent-` | (path-based, immediate) | `"subagent"` |
| `"cli"` or `"claude-desktop"` | any | `"interactive_cli"` |
| `"sdk-cli"` | path includes `observer-sessions` | `"observer"` |
| `"sdk-cli"` | anywhere else | `"sdk_orchestrated"` |
| (none found in first 5 lines) | any | `"unknown"` |

The `"unknown"` fallback is treated as `interactive_cli` for posture purposes —
a session with no detectable entrypoint is more likely a legitimate interactive
session predating entrypoint tracking than a hostile observer echo.

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

**Note on subagent traversal:** `classifySessionKind` returns `"subagent"` for
paths matching `/subagents/agent-`, but the scanner's traversal reads
`projectsRoot/*/*.jsonl` — exactly two path levels deep. Real subagent
transcripts live at
`projects/<project>/<uuid>/subagents/agent-*.jsonl` (four levels deep), so
they are unreachable from the current traversal. The classifier handles them
correctly for the day when the traversal gains recursion; until then the
`subagent` return value is never seen by `scanTranscriptInvocations`. This
mismatch is documented inline so a future recursive-traversal change adds the
skip guard explicitly.

## The `allowPosture` gate in `scanTranscriptInvocations`

Inside the per-session loop, every posture command is gated behind
`allowPosture`. Volume commands are unconditional:

```js
const found = extractSlashCommands(uText);

// Volume — counted across every session kind
if (found.has("go"))       counts.goCommandUses++;
if (found.has("batch"))    counts.batchCommandUses++;
if (found.has("schedule")) counts.scheduleCommandUses++;
if (found.has("loop"))     sessionHasLoop = true;
if (found.has("babysit"))  sessionHasBabysit = true;

// Posture — only when the session is interactive_cli or unknown
if (found.has("focus")   && allowPosture) sessionHasFocus = true;
if (found.has("rewind")  && allowPosture) sessionHasRewind = true;
if (found.has("simplify")&& allowPosture) sessionHasSimplify = true;
if (found.has("btw")     && allowPosture) sessionHasBtw = true;
if (found.has("voice")   && allowPosture) sessionHasVoice = true;
if (found.has("clear")   && allowPosture) sessionHasClear = true;
if (found.has("compact") && allowPosture) sessionHasCompact = true;
if (found.has("color")   && allowPosture) sessionHasColor = true;
if (found.has("fewer-permission-prompts") && allowPosture)
  sessionHasFewerPerms = true;
```

Per-session deduplication applies to both classes: posture flags (`sessionHasSimplify`,
`sessionHasClear`, etc.) flip once and increment their counter after the
full session drains, so the resulting `clearCommandUses` value is a count of
_sessions_ that used `/clear`, not raw invocations.

## The boundary assertion

`assertCommandPartition` is exported and called once at module load:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

It enforces three invariants:

1. **Disjointness** — `POSTURE_COMMANDS ∩ VOLUME_COMMANDS = ∅`
2. **Complete coverage** — every `TARGET_COMMANDS` member is classified as
   posture or volume (catches uncategorized new commands)
3. **No dead classifications** — every partition member exists in
   `TARGET_COMMANDS` (catches commands removed from scanning but left in a set)

If any invariant fails, `assertCommandPartition` throws a descriptive error
(`"must be disjoint"`, `"not classified as posture or volume"`,
`"dead classification"`). The throw happens at module load — before any
transcript is read and before `assessment.json` is written. If `npm run assess`
exits non-zero with no `assessment.json` produced and no obvious
environment error, check stderr for a partition-drift message from this assertion.

The assertion body is an exported function (not inlined) so tests can exercise
it directly against forged `Set` arguments without import-cache gymnastics.

## Signals outside the partition

Two signals in `scanTranscriptInvocations` sit outside the `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` partition:

- **`effortMaxCommandUses`** — detected by `hasEffortMax(uText)`, a regex that
  matches the argument-aware form `/effort max` (the argument `max` is what
  matters; a bare `/effort` must not count). Because this is argument-aware
  regex detection rather than slash-command-name extraction, it is not a
  `TARGET_COMMANDS` member and the partition assertion does not apply. It stays
  unconditional.

- **`planThenLaunchSessions`** — a structural pattern: a session where
  `ExitPlanMode` is an assistant tool-use and the next real assistant turn (past
  any non-semantic rows like `type=attachment` or `type=last-prompt`) contains
  any further tool-use. Detected via a 12-entry rolling lookahead window, not by
  extracting slash-command names. Also sits outside the partition.

## Data flow summary

```
~/.claude/projects/*/*.jsonl   (depth-2 traversal only)
         │
         ▼
classifySessionKind(path)
  → "interactive_cli" | "sdk_orchestrated" | "observer" | "unknown"
  (note: "subagent" is returned by the classifier but unreachable
   from the current depth-2 traversal)
         │
         ▼
scanTranscriptInvocations
  interactive_cli | unknown  →  posture counters + volume counters
  sdk_orchestrated | observer →  volume counters only
         │
         ▼
buildSignalsSummary / insights-signals.mjs  (unchanged interface)
         │
         ▼
score.mjs rubric predicates  (unchanged)
```

## Tests

The partition is covered in `scripts/__tests__/_usage-data.test.mjs` under two
`describe` blocks:

**`assertCommandPartition` (Test 7)** — pure-function tests against forged
`Set` arguments:
- Overlap between posture and volume → throws `"must be disjoint"`
- `TARGET_COMMANDS` member missing from partition → throws `"not classified"`
- Partition member missing from `TARGET_COMMANDS` → throws `"dead classification"`
- Happy path against the live `POSTURE_COMMANDS` / `VOLUME_COMMANDS` /
  `TARGET_COMMANDS` sets → no throw

**`scanTranscriptInvocations — per-command partition`** — real-filesystem
fixtures via `mkdtempSync` / `writeFileSync`:
- Test 1: posture command (`/color`) in an observer session — `colorCommandUses === 0`
- Test 2: volume command (`/loop`) in an observer session — `loopCommandUses === 1`
- Test 3: posture command in an SDK-orchestrated session — `colorCommandUses === 0`
- Test 4: volume command in an SDK-orchestrated session — `loopCommandUses === 1`
- Test 5: posture command in an interactive session (`entrypoint: "cli"`) — `colorCommandUses === 1`
- Test 6: unknown entrypoint falls back to interactive — `colorCommandUses === 1`
- Test 8: existing interactive-only fixtures retain baseline counts (regression check)

**Fixture markup note:** `extractSlashCommands` uses
`/<command-name>\/([\w:-]+)/g`, which requires a literal `/` inside the tag.
Test fixtures must use `<command-name>/color</command-name>` (with slash),
not `<command-name>color</command-name>` (no slash). The slash-less form is
what `scanTranscriptModes` reads via a separate regex — a different code path
for a different purpose.
