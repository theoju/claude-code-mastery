---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: architecture
---

# Per-Command Partition: Posture vs. Volume

**PR #110** introduced a posture-vs-volume partition in `scripts/_usage-data.mjs` to prevent observer and SDK-orchestrated sessions from inflating the posture command counters the scoring engine reads.

## The problem

Observer and SDK-orchestrated sessions replicate `<command-name>` markup from their primary interactive session — they echo it, not emit it. Before this change, `scanTranscriptInvocations` counted those echoes as real invocations. The most dramatic case: `focusCommandUses` scored **15** pre-fix and **1** post-fix. Fourteen of those fifteen counts were observer false positives.

Posture counters measure whether *you* are driving the CLI — commands like `/compact`, `/btw`, or `/focus` that signal active environment shaping. Counting them from sessions where an SDK agent is running autonomously defeats the measurement entirely.

## The partition

Every counted command is classified into exactly one of two buckets:

| Bucket | Commands | Counted in |
| --- | --- | --- |
| **Posture** | `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts` | `interactive_cli` and `unknown` sessions only |
| **Volume** | `/loop`, `/schedule`, `/babysit`, `/go`, `/batch` | Every session kind |

Posture commands answer "is the user actively shaping their environment?" — that signal is only meaningful when `classifySessionKind` returns `interactive_cli` (user-driven terminal session) or `unknown` (conservative fallback). Volume commands answer "is autonomous workflow running?" — that signal is real regardless of which session kind emitted it, so they are not filtered.

## Enforcement: `assertCommandPartition`

A fail-loud assertion in `scripts/_usage-data.mjs` runs at module load and checks four invariants:

1. **Disjointness** — no command appears in both sets.
2. **No missing classification** — every command the scanner knows about belongs to one set.
3. **No dead classification** — no entry in either set refers to a command the scanner doesn't know about.
4. **Coverage completeness** — the union of both sets equals the full command list.

If any invariant fails, the process exits before scoring runs. The intent is that future additions to the command list force an explicit partition decision rather than defaulting silently into either bucket. If `npm run assess` exits non-zero with no `assessment.json` written, check stderr for partition errors before assuming an environmental issue.

## Effect on scoring

Two probes crossed thresholds downward after the fix — `simplifyCommandUses` and `rewindCommandUses` dropped below their next-action trigger points. These are correct corrections, not regressions: the prior counts included observer-session echoes, and probe thresholds are supposed to reflect real usage.

Any Execution scorer whose numerator includes posture command counts now measures only sessions where the user was actually driving the CLI, producing ratios that reflect genuine posture rather than inflated false-positive sums.

## Where things live

- Partition declaration and `assertCommandPartition`: `scripts/_usage-data.mjs` (`POSTURE_COMMANDS` / `VOLUME_COMMANDS`)
- Design spec: `docs/superpowers/specs/2026-05-31-per-command-partition-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-31-per-command-partition.md`
- Tests: 11 new cases under `scripts/__tests__/`

## Adding a new command

1. Decide its bucket: is it a user-posture signal (restrict to interactive) or an autonomous-workflow signal (count everywhere)?
2. Add it to `POSTURE_COMMANDS` or `VOLUME_COMMANDS` in `scripts/_usage-data.mjs`.
3. `assertCommandPartition` catches classification errors at load time.
4. Update the probe tracker (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) in the same PR — specifically the Part 1 registry row(s), the tip-coverage tally, and the five CI-enforced header counts.
