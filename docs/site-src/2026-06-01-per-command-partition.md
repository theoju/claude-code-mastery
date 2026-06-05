---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command posture-vs-volume partition (CCE-71)

**PR #110 · merged 2026-06-01**

Transcript scanning now applies a per-command filter when counting slash
command invocations. Posture commands are counted only from `interactive_cli`
and `unknown` sessions; volume commands are counted from every session kind.
A fail-loud assertion at module load enforces the partition and catches any
future drift.

---

## The problem

Observer sessions duplicate the primary session's `<command-name>` markup
verbatim. Before this change, every user-typed posture command was
double-counted: once from the real interactive session, and again from the
observer that mirrored it. The result was inflated posture counters on
dimensions like Memory and Terminal & Customization.

A prior fix in v0.9.17 tried to exclude all non-interactive sessions from
`scanTranscriptInvocations` entirely. That removed the false positives for
posture commands but regressed the `scheduled` Execution score from 75 → 63
by deleting genuine autonomous-workflow signal from volume commands (`/loop`,
`/schedule`, `/babysit`, `/go`, `/batch`), which are legitimately emitted by
non-interactive sessions.

The per-command partition is the correct shape: filter by session kind where
the signal is posture-specific, and keep the full session universe where the
signal is session-kind-agnostic.

---

## What changed

**`scripts/_usage-data.mjs`** now classifies every tracked slash command into
one of two groups:

| Group | Commands | Session universe |
| --- | --- | --- |
| `POSTURE_COMMANDS` | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` and `unknown` only |
| `VOLUME_COMMANDS` | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | all session kinds |

`scanTranscriptInvocations` routes each command through its partition before
incrementing its counter. Observer, SDK-orchestrated, and subagent sessions
can no longer inflate posture counters by echoing the primary session's
command markup.

`assertCommandPartition` runs at module load and fails loudly if the two sets
are not disjoint, if any tracked command is missing from both, or if a
classified command is no longer tracked. A `npm run assess` exit that emits no
`assessment.json` and prints a partition error to stderr is this assertion
firing — fix the classification before assuming an environmental issue.

---

## Score impact

Two posture command counters dropped on the first run after this change:

- **`simplifyCommandUses`** — prior non-zero counts came entirely from
  observer-session false positives. No `history.jsonl` MAX-merge floor existed
  to preserve the previous count, so the counter reset to actual usage.
- **`rewindCommandUses`** — same cause.

If you see either counter at zero after upgrading and you haven't genuinely
used `/simplify` or `/rewind` in the scoring window, that is the correct
reading — not a regression. Run `/simplify` or `/rewind` in an interactive
Claude Code session and the counter will reflect real usage on the next
`npm run assess`.

No other counters are affected. Volume command counters (`/loop`,
`/schedule`, etc.) are unchanged because they were already being counted
from all session kinds.

---

## Tests

Eleven new unit tests cover:

- `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are disjoint and non-empty.
- `assertCommandPartition` throws on overlap, on an unclassified command,
  and on a dead classification.
- Fixture paths for posture-filtered and volume-preserved counting.

Run them with:

```bash
npx vitest run scripts/__tests__/usage-data.test.mjs
```

---

## Design background

The spec and implementation plan are committed alongside the code:

- `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- `docs/superpowers/plans/2026-05-31-per-command-partition.md`

The CLAUDE.md "Command counting honors the posture-vs-volume partition"
hard rule documents the behavioral contract and the historical context for
why the v0.9.17 blanket fix was the wrong shape.
