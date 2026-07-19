---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Command partition scoring: posture vs. volume commands

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` counts slash-command
usage from `~/.claude/projects/*/*.jsonl` transcripts. Until PR #110, it
counted every transcript the scanner could see, with no filter on session
kind. That was wrong for a specific class of command, and PR #110 (CCE-71)
fixes it with a fail-loud partition rather than another one-off patch.

## The bug

Observer sessions — transcripts that monitor a primary session and emit
structured observations — echo the primary session's `<command-name>` markup.
So does an `sdk_orchestrated` session in some shapes. Neither is a real user
invocation; it's the scanner reading the same `/color` or `/focus` twice
because two transcripts describe the same moment.

This inflated the **posture** commands specifically: `/color`, `/voice`,
`/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`,
`/fewer-permission-prompts`. Those are commands that represent something
about how *you* run a session — they only mean what they mean when a real
interactive user typed them. Once the false positives were stripped out in
testing, `focusCommandUses` dropped 15→1, and `simplifyCommandUses` /
`rewindCommandUses` both crossed to 0.

## Why not exclude non-interactive sessions entirely

That's the fix a previous cycle (v0.9.17) tried, and it regressed `scheduled`
75→63 — because `/loop`, `/schedule`, and `/babysit` are **volume** commands.
Their signal is real autonomous-workflow evidence *regardless of which
session kind fired them*: a scheduled job kicking off `/loop` inside an
SDK-orchestrated session is exactly the behavior the scorer wants to credit,
not noise to filter out. Excluding it deleted genuine signal to fix a
different problem.

So the fix has to be per-command, not per-session-kind-blanket. CLAUDE.md
had already named the shape as a deferred follow-up before this landed —
PR #110 is what makes it real.

## The partition

`scripts/_usage-data.mjs` now declares two disjoint, canonical Sets:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside `scanTranscriptInvocations`, each session is classified once via
`classifySessionKind(path)`, and posture counters are gated behind:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Volume counters stay unconditional — every session kind the scanner reaches
still increments `goCommandUses`, `batchCommandUses`, `scheduleCommandUses`,
and the `/loop` / `/babysit` per-session flags.

`"unknown"` is deliberately treated as posture-eligible. `classifySessionKind`
reads up to five lines of a transcript looking for an `entrypoint` field; if
none appears, it falls through to `"unknown"`. The design choice here is
conservative-by-default: a transcript with no detectable entrypoint is more
likely a legitimate interactive session that predates entrypoint tracking
than a hostile observer echo, so it's given the benefit of the doubt.

`effortMax` and `planThenLaunch` sit outside the partition entirely — neither
is detected via the `<command-name>` markup that `POSTURE_COMMANDS` /
`VOLUME_COMMANDS` classify. `effortMax` runs a regex over the raw prompt
text (`hasEffortMax`), and `planThenLaunch` is a structural pattern keyed off
an `ExitPlanMode` tool_use event. The command-partition assertion doesn't
apply to either.

## The fail-loud guard

A new `assertCommandPartition(posture, volume, target)` runs once at module
load against the live Sets, and catches three drift cases:

1. **Overlap** — a command classified as both posture and volume.
2. **Missing classification** — a member of `TARGET_COMMANDS` (the canonical
   scanned set) that isn't in either partition Set.
3. **Dead classification** — a member of the partition Sets that isn't in
   `TARGET_COMMANDS` at all (i.e., classifying something the scanner never
   looks for).

If any of these fire, the whole `npm run assess` invocation aborts before
writing `assessment.json` — no partial or silently-wrong score gets written.
This is intentional: a contributor adding a new command to `TARGET_COMMANDS`
without classifying it as posture or volume should get a stack trace, not a
quietly-miscounted dimension. The operational corollary: if the LaunchAgent's
scheduled `npm run assess` run exits non-zero and no `assessment.json` shows
up, check stderr for a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error
before assuming an environmental problem.

## What this doesn't touch

- **Subagent sessions.** `classifySessionKind` returns `"subagent"` for paths
  matching `.../subagents/agent-*.jsonl`, but the scanner's traversal reads
  `projectsRoot/*/*.jsonl` — exactly two directory levels deep. Real subagent
  transcripts live four levels deep, so they're unreachable from this scanner
  today. There's no `subagent` skip in the loop because it would be dead
  code; the source has an inline note that a future traversal change adding
  recursion must add that skip explicitly, or subagent-echoed posture
  commands will reintroduce the same inheritance bug this PR just fixed.
- **The history.jsonl MAX-merge.** `run-assessment.mjs`'s
  `Math.max(transcriptCount, historyCount)` blend for commands like `/color`
  is unchanged. History-derived floors already only reflect typed user
  prompts from interactive sessions, so they were never part of the bug —
  they just happened to mask it for the commands that have one. `/rewind` has
  no history floor (it's a keyboard shortcut, not in the history command
  list), so it was the command most exposed to a real threshold crossing;
  post-partition counts stayed above the `>=1` next-action threshold in
  verification.
- **`score.mjs`'s universe gates.** The posture/volume partition is a
  transcript-scanning concern. The separate `interactive_cli`-only universe
  restriction on posture *scorers* (permissions, plan mode, learning ratios)
  is an existing, unrelated rule — see CLAUDE.md's "Verify denominator
  semantics for every ratio scorer."

## Reference

- Design: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- Implementation: `scripts/_usage-data.mjs` (`POSTURE_COMMANDS`,
  `VOLUME_COMMANDS`, `assertCommandPartition`, `scanTranscriptInvocations`)
- Tests: `scripts/__tests__/_usage-data.test.mjs`
- Tracker: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  (Part 1 Transcripts layer, posture-command rows annotated with the
  session-kind gate)
