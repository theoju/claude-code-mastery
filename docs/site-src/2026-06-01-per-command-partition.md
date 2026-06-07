---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command partition: posture vs volume

PR #110 / CCE-71 codifies a structural boundary in `scripts/_usage-data.mjs`
between two semantically distinct command classes. Getting the line wrong causes
scoring regression in either direction — double-counted posture, or silently
discarded autonomous-workflow signal.

## The problem

Observer sessions in `~/.claude/projects/*/*.jsonl` replicate the primary
session's `<command-name>` markup verbatim. Before this change, every posture
command (`/clear`, `/compact`, `/btw`, and others) was counted once in the
interactive session and once more in the co-present observer — inflating the
numerator and over-stating how often you actually used those commands.

An earlier broad fix (v0.9.17) attempted to exclude all non-`interactive_cli`
sessions from the transcript scanner. That regressed the `scheduled` dimension
score from 75 to 63: `/loop`, `/schedule`, `/go`, and `/batch` are legitimately
emitted by autonomous sessions, and filtering at the session level threw away
valid evidence along with the noise.

## The partition

The fix operates at command granularity, not session granularity.

**Posture commands** measure user-settable behavior — things you explicitly
issue to shape how Claude Code behaves in your interactive sessions. They are
meaningful only when the session kind is `interactive_cli` or `unknown` (the
conservative fallback for unclassified sessions):

```
/color  /voice  /focus  /btw  /clear  /compact
/simplify  /rewind  /fewer-permission-prompts
```

**Volume commands** measure autonomous-workflow activity. They are valid
regardless of which session emitted them — a `/loop` fired from a `scheduled`
or `sdk_orchestrated` session is exactly the signal you want:

```
/loop  /schedule  /babysit  /go  /batch
```

The canonical lists are `POSTURE_COMMANDS` and `VOLUME_COMMANDS` exported from
`scripts/_usage-data.mjs`. Those exports are the single source of truth; if you
need to reference the partition elsewhere, import from there rather than
duplicating the arrays.

## The enforcement boundary

A fail-loud `assertCommandPartition` guard runs at module load and asserts:

- The two sets are **disjoint** — no command appears in both lists.
- Every classified command is still recognized by the transcript scanner.
- No known command escapes classification.

If any assertion fires, `npm run assess` exits non-zero before writing
`assessment.json`. If the scorer produces no output file, check stderr for a
partition error before assuming an environmental issue.

## Scoring impact

| Dimension   | Direction | Root cause                                               |
| ----------- | --------- | -------------------------------------------------------- |
| Memory      | over-counted → corrected | Observer sessions double-counted `/clear` + `/compact` |
| Scheduled   | 75 → 63 (broad fix) → 75 (partition fix) | Session-level filter discarded `/loop` signal |

The per-command partition resolves both regressions in one change. Memory
Execution numerator now reflects actual interactive posture; the `scheduled`
Execution score recovers its autonomous-workflow signal.

## Adding a new slash command to the scanner

1. Decide which class it belongs to: **posture** (meaningful only in
   interactive sessions) or **volume** (valid across all session kinds).
2. Add it to exactly one of `POSTURE_COMMANDS` or `VOLUME_COMMANDS` in
   `scripts/_usage-data.mjs`. `assertCommandPartition` will fail startup if
   you add it to both, or skip it entirely.
3. If the new command backs a probe, update
   `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` in the
   same PR (the probe tracker is a CI-enforced contract — a stale tracker
   entry fails tests).
