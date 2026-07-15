---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command posture/volume partition in the transcript scanner

`scripts/_usage-data.mjs::scanTranscriptInvocations` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session for the Execution axis. Until PR #110, it applied no session-kind
filter at all — every transcript the scanner could see contributed to the
counts, including `observer` sessions (which watch a primary session and
echo its `<command-name>` markup into their own transcript) and
`sdk_orchestrated` sessions (which run with SDK defaults, not anything the
user actually set). An observer session quoting the primary session's
`/color` invocation isn't a second invocation — it's the same one, counted
twice, and it inflates a posture ratio with a session that never honored
user-level settings in the first place.

The fix landed as a **per-command partition**, not a blanket exclusion. Two
disjoint, module-level `Set`s now live in `scripts/_usage-data.mjs`:

```js
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

**Posture commands** are only counted from a transcript when
`classifySessionKind(path)` returns `interactive_cli` or `unknown` — the
latter is a deliberate conservative fallback: a transcript with no
recognized `entrypoint` in its first five lines is judged more likely to
predate entrypoint tracking than to be a hostile observer artifact.
**Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) stay
unconditional across every session kind the scanner sees. The reasoning
is that they represent genuine autonomous-workflow signal regardless of
who fired them — an SDK-orchestrated session running `/loop` is still real
`/loop` usage.

## Why not exclude non-interactive sessions outright

This is the second attempt at the problem, and the first one (v0.9.17)
is worth remembering because the failure mode is easy to reintroduce.
That cycle tried a blanket fix — exclude `observer`, `sdk_orchestrated`,
and `subagent` sessions from the scanner entirely — and it regressed the
`scheduled` dimension from 75 to 63 by deleting real `/loop` and
`/schedule` signal along with the noise. It was reverted. The per-command
partition in PR #110 is the corrected shape: filter what's actually
posture-shaped, leave volume alone.

## The guard

A fail-loud assertion, `assertCommandPartition(posture, volume, target)`,
runs once at module load and checks three invariants against
`TARGET_COMMANDS` (the canonical scanned-command set):

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint.
2. Every member of `TARGET_COMMANDS` is classified as one or the other
   (catches a newly-added scanned command that nobody categorized).
3. Every partitioned command is actually in `TARGET_COMMANDS` (catches
   dead classification — a command that no longer exists but is still
   listed).

If any of these fire, `npm run assess` aborts before writing
`assessment.json` — no partial or silently-wrong score gets written. This
is now the canonical operational note in `CLAUDE.md`: a run that exits
non-zero with no `assessment.json` should be triaged against stderr for
a `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before anything
else is assumed.

## What's outside the partition

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside both
Sets by design — neither is detected via `extractSlashCommands`'
`<command-name>` markup. `/effort max` adoption is matched with a
dedicated argument-aware regex over the raw prompt text, and
plan-then-launch is a structural pattern (an `ExitPlanMode` tool_use
followed by a real assistant turn), not a named slash command at all.
The partition assertion doesn't apply to either.

## Known gap: subagent transcripts are unreachable, for now

`classifySessionKind` already returns `"subagent"` for any path matching
`.../subagents/agent-*.jsonl`, but the scanner's traversal reads exactly
`projectsRoot/*/*.jsonl` — two levels deep. Real subagent transcripts live
three levels deeper, so they're invisible to this scanner today and the
`subagent` classification is currently dead code from this call site's
perspective. If a future change recurses the traversal to pick up
subagent files, it needs to add an explicit skip for that kind at the top
of the per-session loop; nothing about the current partition does that
for you.

## Net effect

Posture-command counts (`/color`, `/btw`, `/voice`, `/clear`, `/compact`,
`/simplify`, `/rewind`, `/focus`, `/fewer-permission-prompts`) trend down
or flat wherever observer/SDK noise was previously inflating them; several
already had a `history.jsonl`-derived MAX-merge floor (`/color` since PR
#96) that absorbs most of the difference. `/rewind` is the one posture
command with no such floor, since it's a keyboard shortcut rather than a
typed prompt in `HISTORY_COMMAND_LIST` — worth checking directly if a
`/rewind`-gated next-action flips state after upgrading. Volume-command
counts are unchanged.
