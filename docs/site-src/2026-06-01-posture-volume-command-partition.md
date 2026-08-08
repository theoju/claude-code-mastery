---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Posture/volume command partition

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks
`~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per
session. As of PR #110 (CCE-71), it no longer counts every command from
every session kind the same way — commands are split into a **posture**
set and a **volume** set, and only posture commands are gated by session
kind.

## Why a per-command split

Observer sessions (transcripts that monitor a primary session's work) and
SDK-orchestrated sessions frequently echo the primary session's
`<command-name>cmd</command-name>` markup without the user actually having
invoked anything in that session. Counting those echoes inflates
posture-command signal — things like `/color`, `/btw`, `/clear` — with
noise that has nothing to do with the user's actual habits.

The obvious fix looks like "exclude observer and SDK-orchestrated sessions
from the scan entirely." That was tried first, and it was wrong: it
regressed the `scheduled` dimension score from 75 to 63 by deleting
genuine `/loop` and `/schedule` signal. Autonomous-workflow commands are
*supposed* to show up from non-interactive sessions — that's the point of
scheduling and looping work. The blanket exclusion had to be reverted.

PR #110 replaces it with a partition that treats the two command families
differently:

- **Posture commands** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) are only
  counted from sessions `classifySessionKind` resolves to `interactive_cli`
  or `unknown` (the conservative fallback for transcripts with no
  detectable `entrypoint` in their first five lines). These are exported as
  `POSTURE_COMMANDS` in `_usage-data.mjs`.
- **Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`)
  are counted across every session kind the scanner reaches, unconditionally
  — this is `VOLUME_COMMANDS`. Autonomous-workflow signal is valid
  regardless of which session fired it.

`effortMaxCommandUses` and `planThenLaunchSessions` sit outside the
partition entirely: they're detected by regex over prompt text
(`hasEffortMax`) and by structural lookahead from an `ExitPlanMode`
tool_use, not by `extractSlashCommands`, so the posture/volume
classification doesn't apply to them.

## Where the gate lives

Inside the per-session loop in `scanTranscriptInvocations`:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Each posture-command flag is then set only when `allowPosture` is true
(e.g. `if (found.has("btw") && allowPosture) sessionHasBtw = true;`), while
the volume-command counters (`goCommandUses`, `batchCommandUses`,
`scheduleCommandUses`, and the `loop`/`babysit` session flags) are
incremented unconditionally on `found.has(...)`, same as before the
change.

`classifySessionKind` also returns `"subagent"` for paths matching
`.../subagents/agent-*.jsonl`, but the scanner's directory traversal only
reads `projectsRoot/*/*.jsonl` — two levels deep — while real subagent
transcripts live four levels deep. So `"subagent"` is unreachable from this
scanner today; a future traversal that recurses into subagent directories
would need to add an explicit skip for that kind, which is called out
inline in the source as a note for whoever adds that recursion.

## Fail-loud drift guard

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` are asserted against
`TARGET_COMMANDS` (the canonical scanned-command set) at module load, via
`assertCommandPartition`:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

The assertion catches three drift cases: the two sets overlapping, a
`TARGET_COMMANDS` member missing from either set, and a partition member
that isn't in `TARGET_COMMANDS` at all (dead classification). Because this
runs at module load — the top of `gatherSignals` in the assessment chain —
a drift bug aborts the entire `npm run assess` invocation before any score
is written, rather than silently miscounting. If the LaunchAgent/cron run
exits non-zero with no `assessment.json` written, check stderr for a
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before assuming an
environmental issue — this is now called out directly in CLAUDE.md's hard
rules.

`assertCommandPartition` is exported as a standalone function specifically
so it can be unit-tested against forged Sets (`scripts/__tests__/_usage-data.test.mjs`)
without needing import-cache tricks to monkeypatch the real module-level
constants.

## What this doesn't change

- Volume-command counting behavior is byte-identical to before the PR.
- `classifySessionKind`'s own fallback semantics are unchanged — the
  partition only adds an interpretation rule (`interactive_cli` or
  `unknown` → eligible for posture counting) on top of the existing
  classifier output.
- No new probes, catalog entries, or `signalsSummary` keys were added by
  this change — it's an accuracy refinement to existing transcript-derived
  signals, not new coverage.

## Expected effect on scores

Posture-command counts trend down or stay flat wherever observer-session
markup was previously inflating them; volume-command counts stay flat.
`/rewind` is the one posture command with no `history.jsonl` floor to fall
back on (it's a keyboard shortcut, not something `history.jsonl` records),
so it's the counter most exposed to a real drop — worth checking after
upgrading if a `/rewind`-adjacent next-action's status changes.
