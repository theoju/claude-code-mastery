---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: partition transcript slash commands into posture vs. volume

**PR:** [#110](https://github.com/theoju/claude-code-self-assessment/pull/110)
**Area:** `scripts/_usage-data.mjs::scanTranscriptInvocations`
**Ticket:** CCE (per-command partition; supersedes the reverted v0.9.17 blanket fix)

## The problem

`scanTranscriptInvocations` walks `~/.claude/projects/*/*.jsonl` and counts
slash-command occurrences by matching the CLI's `<command-name>/cmd</command-name>`
markup. It had no session-kind filter, so it counted every transcript the
scanner reached — including **observer** sessions (which monitor a primary
session and echo structured observations back, including that primary
session's own `<command-name>` markup) and **SDK-orchestrated** sessions. An
observer session quoting the primary session's `/color` invocation looked,
to the scanner, like a second independent `/color` invocation. That silently
inflated posture-command counters — the ones this project's Memory &
Context Management and Terminal & Customization Execution scorers turn into
per-session-coverage ratios.

This isn't a new discovery. CLAUDE.md already carried it as a known
limitation, and there'd been one earlier attempt at a fix: v0.9.17 tried
excluding `observer` / `sdk_orchestrated` / `subagent` sessions from the
scanner entirely. That regressed the `scheduled` dimension 75→63, because
`/loop` and `/schedule` invocations legitimately *do* fire from
SDK-orchestrated and autonomous-workflow sessions — that blanket exclusion
deleted real signal along with the noise, and was reverted.

## The decision

Partition the scanned commands into two disjoint sets and gate them
differently, rather than gating by session kind uniformly:

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

**Posture commands** answer "how does this user configure their own
working style?" — they're only meaningful when tied to a session the user
actually drove. They're counted only when the enclosing session classifies
as `interactive_cli` or `unknown` (the classifier's conservative fallback
for transcripts with no recognizable `entrypoint` in their first five
lines — see `classifySessionKind`).

**Volume commands** answer "is autonomous-workflow tooling getting used at
all?" — that signal is real no matter which session kind fired it, so they
stay counted across every session kind the scanner reaches, unconditionally.

The gate is applied per-command inside the existing per-session loop:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
...
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("loop")) sessionHasLoop = true; // unconditional
```

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside the
partition entirely — they're detected by regex-over-prompt-text and a
structural `ExitPlanMode` lookahead, respectively, not by
`extractSlashCommands`, so neither `POSTURE_COMMANDS` nor
`VOLUME_COMMANDS` needs to (or should) include them.

## The guardrail: `assertCommandPartition`

A command that's scanned (present in `TARGET_COMMANDS`) but forgotten in
the partition would silently stop contributing to any counter — worse,
a command added to both `POSTURE_COMMANDS` and `VOLUME_COMMANDS` by
accident would double-classify. Both are the kind of drift that's easy to
introduce months later when someone adds a 15th tracked command and
doesn't remember this file exists. So the partition is checked at module
load, not just documented:

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

It's exported specifically so `scripts/__tests__/_usage-data.test.mjs` can
exercise all three failure modes against forged Sets, rather than relying
on module-cache tricks to mutate the real top-level constants. If this
assertion fires in production, `npm run assess` aborts before writing
`assessment.json` — no partial or silently-wrong score gets written. Per
CLAUDE.md's operational note, a missing `assessment.json` after a
dependency or command-list change is the first thing to check stderr for.

## Why "unknown" counts as posture-eligible

`classifySessionKind` returns `"unknown"` when a transcript has no
recognizable `entrypoint` field in its first five lines — not a fourth
distinct session kind, just "couldn't tell." Treating `unknown` as
observer-like (i.e. excluding it from posture counting) would have been
the more conservative reading, but the design choice here goes the other
way: a transcript with no entrypoint metadata is judged more likely to be
a legitimate interactive session that predates entrypoint tracking than a
hostile observer echo. So `allowPosture` is
`sessionKind === "interactive_cli" || sessionKind === "unknown"` — the
same `interactive_cli ∪ unknown` universe CLAUDE.md now documents as
feeding the Memory & Context Management and Terminal & Customization
Execution scorers.

## What this doesn't touch

- **Subagent transcripts.** `classifySessionKind` can return `"subagent"`
  for paths matching `.../subagents/agent-*`, but the scanner's traversal
  only reads `projectsRoot/*/*.jsonl` (two levels deep) — real subagent
  transcripts live four levels deep and are unreachable from this scanner
  today. There's no `if (sessionKind === "subagent") continue` because it
  would be dead code. It's called out inline in `_usage-data.mjs` so a
  future contributor who adds recursive traversal doesn't reintroduce
  inheritance noise silently.
- **`score.mjs` universe gates.** The posture/volume partition operates at
  the transcript-scanning layer. It's orthogonal to `withGates({ universe })`
  in `score.mjs`, which filters by `session_type` from session-meta, not by
  the scanner's per-command session-kind classification.
- **History-file MAX-merge.** `run-assessment.mjs` still `Math.max()`s
  several posture counters against `~/.claude/history.jsonl`-derived
  values (the mechanism that already made `/color` resilient to this bug
  by accident, per the v0.9.16 cycle). That merge is unchanged; this PR
  fixes the transcript-side count it's merged against.

## Net effect

Posture-command counts (`color`, `btw`, `voice`, `clear`, `compact`,
`simplify`, `fewer-permission-prompts`, `focus`, `rewind`) trend down or
flat wherever observer/SDK echo noise was present — most are cushioned by
the history-file floor described above. `/rewind` is the one posture
command with no such floor (it's a keyboard shortcut, not something
`history.jsonl` records), so it's the counter most worth watching after
this change lands in a given environment. Volume-command counts (`loop`,
`schedule`, `babysit`, `go`, `batch`) are unaffected by design — this PR
adds zero new scored dimensions, next-actions, or catalog probes, so it
doesn't change any of the five machine-enforced tracker header counts in
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`.
