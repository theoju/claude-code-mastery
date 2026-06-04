---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# Progression timeline: `scheduled`, `remote`, and `verification` detectors

The `/progression` timeline on the dashboard now covers all 12 scored
dimensions. Previously, the `scheduled`, `remote`, and `verification`
dimensions had no telemetry-dated milestone detectors, so the timeline
appeared frozen past the first-run wall for any user whose recent activity
concentrated in those areas.

PR #108 closes the CCE-33 coverage gap by adding one detector each for the
three previously-uncovered dimensions.

## What changed

`scripts/progression.mjs` previously shipped 9 detectors covering 8
dimensions (`automation`, `integrations`, `learning`, `memory`,
`model-effort`, `parallel`, `permissions`, `planning`). The three missing
dimensions now have detectors:

| Dimension      | Milestone fired when                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `scheduled`    | First session where a scheduled workflow command (`/loop`, `/schedule`, `/batch`) fired |
| `remote`       | First session with remote or mobile-originated activity detected                  |
| `verification` | First session where a verify-agent stage or `/go` reflex invocation was recorded  |

Each detector is **telemetry-dated**: it reads the session `start_time` from
`~/.claude/usage-data/session-meta/*.json` and stamps the milestone at the
earliest matching session across full history — independent of
`--insights-lookback`. That means a milestone from April will appear on the
timeline even under a 30-day scoring window, matching the behaviour of the
existing 9 detectors.

## What "frozen timeline" looked like

Before this change, a user who had never triggered an `automation` or
`parallel` milestone but ran scheduled jobs regularly would see the timeline
progress stall after the first-run config wall. The dashboard's Progression
page showed no telemetry-dated stamps after the initial batch of config
milestones (which share the dashboard's first-run timestamp by design — they
don't back-date from mtimes).

Now any session that matches one of the three new detectors produces a
dated stamp and the timeline continues forward from that point.

## Implementation notes

- **Detector location**: `scripts/progression.mjs` — the same file as the
  original 9 detectors.
- **Session scanning helper**: `scripts/_usage-data.mjs` provides the
  session-meta iterator consumed by all detectors.
- **Tests**: `scripts/__tests__/progression.test.mjs` covers the three new
  detectors alongside the existing suite.
- **Config milestones unchanged**: `scripts/config-progression.mjs` and
  `app/data/progression-config.json` are not affected. Config milestones
  continue to carry the first-run `firstSeenAt` timestamp by design.

## Remaining gap

The 8 config milestone detectors in `scripts/config-progression.mjs` cover
only 8 of the 12 dimensions (`automation`, `integrations`, `learning`,
`memory`, `model-effort`, `parallel`, `permissions`, `planning`) — the same
set that had telemetry detectors before this PR. Extending config coverage to
`scheduled`, `remote`, and `verification` is left as follow-on work; it
requires defining "what does a config milestone look like" for each of those
three dimensions, which is less clear-cut than the telemetry side.
