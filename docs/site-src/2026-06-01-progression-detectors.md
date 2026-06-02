---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# Progression Timeline: Three New Milestone Detectors

PR #108 closes the CCE-33 coverage gap on the `/progression` timeline by adding telemetry-dated milestone detectors for the three previously-untracked dimensions: **scheduled**, **remote**, and **verification**.

## Background

The progression timeline combines two milestone sources:

- **Telemetry milestones** (`scripts/progression.mjs`) — self-dated from session `start_time` across your full history, independent of the `--insights-lookback` window. If you first ran `/loop` months before installing the dashboard, that milestone back-dates to its real session timestamp once the detector runs.
- **Config milestones** (`scripts/config-progression.mjs`) — stamped at first observation, not back-dated. Every already-satisfied config signal gets `firstSeenAt = first-run date` by design.

Before this PR, the telemetry detector catalog covered 8 of 12 scored dimensions. The three gaps — `scheduled`, `remote`, and `verification` — produced no milestone entries regardless of actual usage. Heavy investment in autonomous scheduling, mobile triggers, or the `/go` verification workflow left the timeline frozen past the initial tracking-start wall for those areas.

## New Detectors

| Dimension | Boris Tip | Trigger condition |
|-----------|-----------|-------------------|
| `scheduled` | 48 | First `/loop`, `/schedule`, or `/babysit` invocation in any session |
| `remote` | 35 | First `RemoteTrigger`, `PushNotification`, or `SendMessage` tool use |
| `verification` | 73 | First `/go` invocation in any session |

All three are telemetry-dated against session `start_time`. The milestone timestamp reflects when you first adopted the behavior, not when the detector ran.

## What Changed

Two files:

**`scripts/progression.mjs`** — Three detector entries appended to the existing catalog. Each follows the same milestone-walker pattern as the nine prior detectors: scan the transcript-derived session data, find the earliest matching session, emit a milestone with its `start_time`.

**`scripts/_usage-data.mjs::scanTranscriptModes`** — Added a `commands: Set<string>` field to the per-session output. The `scheduled` and `verification` detectors need to identify which slash commands appeared in a session; they consume this field. The `remote` detector keys on tool names already surfaced by the existing scan, so it needed no new signal.

The progression page renderer (`app/progression/page.tsx`) required no changes — it consumes milestone objects uniformly regardless of source dimension.

## Probe Tracker

The five machine-enforced header counts (`75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys`) are unchanged. No new `satisfiedWhen` predicates, `probe-catalog.json` entries, or `signalsSummary` keys were added. The tracker spec was synced in the same PR with a new Part 1 Progression layer and updated tip-coverage evidence for tips 35, 48, and 73.
