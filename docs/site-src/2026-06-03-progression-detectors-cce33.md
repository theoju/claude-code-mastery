---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# Progression Timeline Detectors: All 12 Dimensions (CCE-33)

**PR #108** completes the `/progression` milestone detector catalog, closing the
coverage gap tracked as CCE-33. Before this change, 8 of the 12 scored
dimensions had telemetry-dated detectors. The `scheduled`, `remote`, and
`verification` dimensions had none — so significant real usage in those areas
produced no milestones and the `/progression` timeline appeared frozen after the
first-run config wall, misrepresenting your actual adoption history.

## The gap

The `/progression` page merges two milestone sources on every `npm run assess`
run:

- **Telemetry milestones** (`scripts/progression.mjs`) — self-dated from session
  `start_time` across full history.
- **Config milestones** (`scripts/config-progression.mjs`) — read from the
  signals snapshot; `firstSeenAt` is stamped at the first run that observed
  each signal.

Before this PR, the telemetry detector catalog covered 8 dimensions:
`automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`,
`permissions`, `planning`. The three unmeasured dimensions produced no
timeline entries regardless of how heavily you used them, leaving the timeline
frozen past the initial config wall for anyone with scheduled-task, remote-MCP,
or verification-workflow activity.

## What changed

Three new telemetry-dated detectors land in `scripts/progression.mjs`:

| Detector | Dimension | Signal source |
| --- | --- | --- |
| `scheduled` | Scheduled work | `/schedule`, `/loop`, and `/batch` invocation counts from cooked telemetry |
| `remote` | Remote / mobile | Remote MCP session counts from `scripts/_usage-data.mjs` |
| `verification` | Verification | Verification-workflow session signals (test runs, `/check` invocations) |

Supporting signal extraction is added to `scripts/_usage-data.mjs`. New test
cases for all three detectors land in `scripts/__tests__/progression.test.mjs`.
The probe implementation status tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) is updated
in the same PR.

## Effect on the timeline

After this PR, every scored dimension emits at least one telemetry-dated
milestone when the corresponding session activity exists in your history. If you
see dates appearing on previously frozen timeline slots after your next
`npm run assess` run, that's the detectors backfilling from real session
`start_time` values — not new activity.

Note the **first-run caveat for config milestones** still applies: any
already-satisfied config signal gets `firstSeenAt` stamped at the first run that
observed it, not at its true adoption date. That is by design (back-dating from
mtimes or git history is fragile and lossy). Telemetry milestones are unaffected
— they self-date from your actual session history.

## Technical references

- Design spec:
  [`docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md)
- Plan:
  [`docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md)

The spec and plan are the authoritative technical references for signal
extraction choices, threshold rationale, and any follow-up work.
