---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command posture-vs-volume partition

PR #110 replaced the earlier blanket session-kind filter with a finer-grained
split: each command class is now filtered — or not — based on what _kind_ of
signal it represents.

## The problem it solves

Observer sessions replicate the primary session's `<command-name>` markup in
their transcripts. Before this change, the scanner counted those echoed
invocations as real posture signals. A `/focus` session with one genuine use
could report 15 because 14 observer replicas each included the same markup. The
resulting Execution scores were inflated and not reproducible across session
configurations.

A prior fix in v0.9.17 attempted to solve this by excluding all
`observer`/`sdk_orchestrated`/`subagent` sessions from transcript scanning
entirely. That worked for posture commands but regressed volume scoring — the
`/loop`, `/schedule`, and `/batch` invocations that prove autonomous-workflow
adoption were silently dropped along with the noise. The per-command partition
is the correctly scoped fix: filter where filtering is appropriate, preserve
signal everywhere else.

## The partition

Commands are now assigned to exactly one class at module load time in
`scripts/_usage-data.mjs`:

**Posture commands** — counted only from `interactive_cli` and `unknown`
sessions (the conservative fallback for sessions without a detectable kind):

| Command                     | Boris tip area          |
| --------------------------- | ----------------------- |
| `/color`                    | Terminal customization  |
| `/voice`                    | Output style            |
| `/focus`                    | Context management      |
| `/btw`                      | Background memory       |
| `/clear`                    | Context hygiene         |
| `/compact`                  | Context hygiene         |
| `/simplify`                 | Output style            |
| `/rewind`                   | Context recovery        |
| `/fewer-permission-prompts` | Permissions posture     |

**Volume commands** — counted across all session kinds, including
`sdk_orchestrated`, `observer`, and `subagent`:

| Command     | Boris tip area          |
| ----------- | ----------------------- |
| `/loop`     | Automation / looping    |
| `/schedule` | Scheduled work          |
| `/babysit`  | Supervised automation   |
| `/go`       | Autonomous execution    |
| `/batch`    | Batch processing        |

The logic: posture commands are user-facing configuration reflexes; whether you
_have_ them as a habit is only meaningful if you're the one running them.
Volume commands measure autonomous-workflow adoption; a subagent or SDK runner
invoking `/batch` is genuine signal regardless of which session kind emitted it.

## The partition guard

A `assertCommandPartition()` call runs at module load — before any scoring
logic executes. It verifies three properties:

- Every tracked command is classified in exactly one class (no gaps, no
  overlaps).
- No command appears in both lists.
- No unknown classification labels exist.

If the partition drifts — say, a new command is added to `_usage-data.mjs`
without being assigned to either class — the process exits with a descriptive
error before writing any `assessment.json`. You'll see the error on stderr when
`npm run assess` fails with no output file. Fixing it means adding the new
command to `POSTURE_COMMANDS` or `VOLUME_COMMANDS` in `_usage-data.mjs`.

## Impact

The most visible effect is on posture command counts. In the reference
environment, `/focus` dropped from 15 to 1 after the fix — 14 observer-replica
counts removed. Scores that were inflated by observer echoes will decrease to
reflect actual interactive usage.

Two counters — `simplifyCommandUses` and `rewindCommandUses` — crossed the
`>= 1` adoption threshold in the reference environment after the partition was
applied. This is expected: when observer noise previously dominated the count,
adding a single genuine interactive use pushed the threshold; with only
interactive sessions counted, the single real use is now the only data point.
These threshold crossings are spec-predicted, not regressions.

## Test coverage

Eleven tests were added covering:

- The `assertCommandPartition` guard (disjointness, completeness, no dead
  classifications).
- Per-command counting isolation: posture commands counted from interactive
  sessions only, volume commands counted from all sessions.
- Fixture-fed scorer paths for both posture and volume dimensions to confirm
  the partition doesn't regress existing score contracts.

## Related references

- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-31-per-command-partition.md`
- CLAUDE.md rule: _"Command counting honors the posture-vs-volume partition"_
  (added to Hard rules in the same PR)
