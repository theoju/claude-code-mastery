---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command partition for slash-command counting

`scripts/_usage-data.mjs` counts how often you invoke slash commands by
scanning your transcript files. Before PR #110, every command was counted
across all session kinds. That overshot the truth: observer sessions in
Claude Code replay the primary session's `<command-name>` markup verbatim,
so a single `/compact` invocation could be counted two or three times — once
for the originating `interactive_cli` session and once for each observer that
shadowed it.

The fix is a **per-command partition**, not a blanket session filter.

## The two buckets

Commands are classified at module load time into exactly two disjoint sets:

| Bucket | Commands | Counting universe |
| --- | --- | --- |
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` and `unknown` sessions only |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | All session kinds |

**Posture commands** reflect user-settable behavior — how you work in an
interactive session. Counting them from observer or SDK-orchestrated sessions
inflates the numerator without a corresponding user action behind it.
Restricting these to `interactive_cli ∪ unknown` removes the duplicate signal.

**Volume commands** reflect autonomous-workflow usage. A `/loop` or `/batch`
invocation is genuine signal regardless of which session kind emitted it —
so these continue counting across every scanned session.

## Why not a blanket filter?

A previous attempt (v0.9.17) excluded observer, SDK-orchestrated, and subagent
sessions from all of `scanTranscriptInvocations`. That regressed the
scheduled-task Execution score by 12 points because it stripped legitimate
`/schedule` and `/loop` calls from autonomous sessions. The per-command
partition is the correct shape: posture is filtered, volume is preserved.

## The partition guard

A fail-loud `assertCommandPartition` assertion runs at module load time. It
checks:

- **Disjointness** — no command appears in both sets.
- **Completeness** — every command the scorer references is classified.
- **No dead entries** — no classified command is absent from the command set
  the scorer knows about.

If `npm run assess` exits non-zero with no `assessment.json` written, check
stderr for a partition error before investigating elsewhere.

## Score impact

Two thresholds crossed downward after the fix — `simplifyCommandUses` and
`rewindCommandUses` both fell. This is **expected de-inflation**, not a
regression. The prior counts included observer-session echoes; the corrected
counts reflect the number of times you actually issued the command in an
interactive session. If your scores for Terminal & Customization or Memory &
Context dropped slightly after upgrading past v0.9.17, the new numbers are the
accurate ones.

## Where the counts feed

The posture-command coverage signals feed two Execution scorers:

- **Memory & Context Management** — `/clear` and `/compact` session-coverage
  counts (30-day windowed, deduped per session) form the numerator of the
  context-hygiene ratio. `/btw` is surfaced separately as cumulative evidence
  text (not mixed into the ratio) per the CCE-79 redesign.
- **Terminal & Customization** — posture-command coverage across the
  `interactive_or_unknown` session universe.

Volume-command counts feed the **Automation** and **Scheduled Work**
Execution scorers, where cross-session counting is correct by design.
