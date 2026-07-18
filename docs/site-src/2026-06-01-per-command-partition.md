---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for observer-session false positives

PR #110 closes out a deferred follow-up (CCE-71) in how `scanTranscriptInvocations`
(`scripts/_usage-data.mjs`) counts slash commands out of `~/.claude/projects/*/*.jsonl`
transcripts. The short version: posture commands are now only counted from
sessions the scanner can attribute to the user; volume commands still count
everywhere.

## The problem

Observer sessions — the ones that watch a primary session and emit structured
observations — echo the primary session's `<command-name>cmd</command-name>`
markup into their own transcript. Before this change, `scanTranscriptInvocations`
walked every `.jsonl` file it found with no session-kind filter, so an observer
session's echo of `/color` or `/btw` counted as a second, false invocation. That
inflated posture-ratio scoring for exactly the dimensions (Terminal &
Customization, Memory & Context) that lean on those counters.

This isn't a new discovery — it's the resolution of a documented false start.
v0.9.17 tried the obvious blanket fix: exclude `observer`, `sdk_orchestrated`,
and `subagent` sessions from the scanner entirely. That regressed the
`scheduled` dimension from 75 to 63, because `/loop` and `/schedule` invocations
fired from those same non-interactive session kinds are genuine autonomous-workflow
signal, not noise. The blanket exclusion was reverted. The correct shape,
per CLAUDE.md's "posture vs volume" note, is a **per-command partition**: filter
by session kind only for the commands where session kind actually matters.

## What changed

`scripts/_usage-data.mjs` now declares two disjoint, module-level `Set`s:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

Inside `scanTranscriptInvocations`'s per-session loop, each transcript is now
classified once via `classifySessionKind(path)`, and posture-command counters
are gated on the result:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`allowPosture` guards `found.has("color") && allowPosture`, and similarly for
the other eight posture commands. Volume-command counters (`go`, `batch`,
`schedule`, `loop`, `babysit`) stay structurally unchanged — they count across
every session kind the scanner sees, `sdk_orchestrated` and `observer` included.

`"unknown"` is treated as posture-eligible by design, not oversight:
`classifySessionKind` returns it when no recognized `entrypoint` field turns up
in a transcript's first five lines, and the conservative read is that an
unclassifiable session is more likely a pre-entrypoint-tracking legitimate
session than a hostile observer echo.

A fail-loud `assertCommandPartition(posture, volume, target)` runs at module
load and checks three invariants against `TARGET_COMMANDS` (the canonical
scanned-command set): the two Sets are disjoint, every scanned command is
classified as one or the other, and no partition member exists outside the
scanned set. If any of the three drift, the whole `npm run assess` invocation
throws before writing `assessment.json` — a stale or incomplete partition
fails CI rather than silently under- or over-counting.

One case sits outside the partition on purpose: `effortMaxCommandUses` is
detected by regex over prompt text (`hasEffortMax`), not by the
`<command-name>` markup `extractSlashCommands` matches, so it was never a
member of `TARGET_COMMANDS` and the assertion doesn't touch it.

## Why this shape and not the blanket one

The distinguishing question per command is: *is session kind actually
informative about whether the user did this?* For posture commands — the
ones that toggle a setting or a mode a user chooses for themselves
(`/color`, `/voice`, `/focus`, `/clear`, `/compact`, `/simplify`, `/rewind`,
`/btw`, `/fewer-permission-prompts`) — an observer or SDK-orchestrated session
can't meaningfully originate the invocation; any occurrence there is markup
echo, not intent. For volume commands — the ones that represent autonomous
workflow throughput (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) — the
session kind is beside the point: the signal is real regardless of which
process fired it. Filtering both classes the same way either keeps noise in
the posture counters or deletes signal from the volume counters; the
per-command split is what lets both counters be correct at once.

Subagent transcripts are a related non-issue today, not a gap: `classifySessionKind`
returns `"subagent"` for paths under `.../subagents/agent-*.jsonl`, but the
scanner's traversal only reads `projectsRoot/*/*.jsonl` — two levels deep —
so subagent transcripts (three levels deeper) are never reached by this
scanner in the first place. The code comments this inline so a future
traversal change that adds recursion doesn't inherit the assumption silently.

## Practical effect

Expect small downward or flat movement on posture-command counters
(`colorCommandUses`, `btwCommandUses`, `rewindCommandUses`, and friends)
on the first `npm run assess` after this lands — that's the observer noise
being removed, not a regression. Volume counters (`goCommandUses`,
`scheduleCommandUses`, `loopCommandUses`, `babysitLoopUses`) should stay flat.
Most posture scorers are cushioned by the existing MAX-merge against
`~/.claude/history.jsonl` (typed-prompt history, which was never polluted by
observer echo); `/rewind` is the one posture command with no history floor,
so it's the counter most worth spot-checking after upgrading.

No new probes, catalog entries, or `signalsSummary` keys came out of this —
it's an accuracy fix to existing transcript-derived counters, not new
coverage. The probe tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) picks up
a footnote on the affected Transcripts-layer rows rather than a new row.
