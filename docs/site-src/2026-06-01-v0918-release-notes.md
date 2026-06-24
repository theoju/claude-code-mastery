---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: decision
---

# v0.9.18 release notes

v0.9.18 is a bundled release that squash-lands 13 PRs (##99–116) on top of
v0.9.17. The headline: Execution scoring is now complete across all 12 rubric
dimensions. Every radar vertex has a real ratio scorer backed by cooked
telemetry; the last two `noTelemetry()` stubs are gone.

## What changed

### Execution scoring — all 12 dimensions covered

Memory & Context Management and Terminal & Customization were the last two
dimensions whose Execution scorer returned `noTelemetry()` (unscored, italic
label, footnote on the radar). Both now have live ratio scorers gated on the
`interactive_cli ∪ unknown` session universe — the conservative fallback that
the transcript-based posture signals (CCE-71) also use. The numerators are
posture-command coverage counters derived from transcript scans; the
denominator is `sessionsByKind.interactive_cli + sessionsByKind.unknown`.

If the session universe is empty (no interactive or unknown sessions in the
window), the scorer still returns `gapReason !== null` and the radar renders
the italic label. Real usage removes the footnote.

### Per-command POSTURE/VOLUME partition (CCE-71)

`scripts/_usage-data.mjs` now declares two disjoint command sets:

- **`POSTURE_COMMANDS`** — `/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`. Counted only
  when `classifySessionKind` returns `interactive_cli` or `unknown`. Observer,
  SDK-orchestrated, and subagent sessions are excluded; their command
  invocations are not posture signals.
- **`VOLUME_COMMANDS`** — `/loop`, `/schedule`, `/babysit`, `/go`, `/batch`.
  Counted across every session kind — autonomous-workflow signal is real
  regardless of which session kind emitted it.

A `assertCommandPartition` call runs at module load and fails loudly if the two
sets overlap or if a command appears in neither. If `npm run assess` exits
non-zero with no `assessment.json` written, check stderr for this assertion
before assuming an environmental issue.

### /ship stage-counting fix (CCE-72)

`scripts/signals.mjs::stageRanInEntry()` now detects stage execution across
all three ship-journal format generations:

| Generation | Shape | Field |
| --- | --- | --- |
| Current | string array | `stages_run: ["test", "verify-agent", …]` |
| Legacy numeric | number array | `stages_run: [1, 2, …]` |
| Singular | scalar | `entry.stage: 2` |

Journals written before the array format landed were silently returning zero
stage-coverage credit. The fix restores adoption signal for users with
multi-month ship histories.

### Predicate evaluator consolidated

`scripts/predicate.mjs` is now the single canonical source of the
`satisfiedWhen` DSL evaluator. `app/lib/assessment.ts:evaluatePredicate` is a
one-line passthrough re-export. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`)
asserts the two are reference-equal so a duplicate implementation fails the
suite immediately.

### /progression telemetry detectors for three new dimensions

The `/progression` timeline previously had no telemetry-dated detectors for
`scheduled`, `remote`, or `verification` — heavy real usage in those dims
produced no milestone, and the timeline appeared frozen after the first-run
wall. v0.9.18 adds detectors for all three, self-dated from session
`start_time` over full history (independent of `--insights-lookback`).

## Supporting changes

- **engineering-docs-agent plugin onboarding** — the nightly docs-agent runs
  against this repo's `docs/site-src/` tree.
- **state.json shape fix** — a field mismatch between the writer and consumer
  was silently dropping ship-state fields on reload.
- **Jira workflow migration** — `/ship` Stage 7 now targets the updated
  `designitright.atlassian.net` project configuration.
- **Plan archiving** — completed plan files moved to
  `docs/superpowers/plans/archived/`.

## Upgrade

No migration required. Pull and run:

```bash
git pull
npm install
npm run assess
```

The two new Execution scorers read the same `~/.claude/usage-data/` paths
every other Execution scorer uses. No new config keys.

## Breaking changes

None.
