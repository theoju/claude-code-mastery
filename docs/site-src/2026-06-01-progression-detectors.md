---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# Progression timeline detectors — CCE-33

PR #108 closes the coverage gap in the `/progression` milestone timeline. Before
this change, three of the twelve scored dimensions — `scheduled`, `remote`, and
`verification` — had no detector. Heavy usage in those areas produced no
milestones, making the timeline appear frozen past the initial 2026-05-09
first-run wall. Three new detectors in `scripts/progression.mjs` and a small
extension to `scanTranscriptModes` in `scripts/_usage-data.mjs` close the gap.

## Background: how the progression timeline works

`app/progression/page.tsx` renders `app/data/progression.json`, regenerated on
every `npm run assess`. That file merges two sources:

- **`scripts/progression.mjs`** — telemetry detectors, self-dated from session
  `start_time` over **full history** (`--progression-lookback`, default `null`,
  independent of `--insights-lookback`).
- **`scripts/config-progression.mjs`** — config detectors; `firstSeenAt` is
  frozen at first observation in `app/data/progression-config.json` (by design —
  does not back-date from file mtimes).

Before PR #108 the telemetry detector array had 9 entries covering 8
dimensions. The three undetected dimensions (`scheduled`, `remote`,
`verification`) appear in the radar and scoring but were invisible to the
timeline.

## What changed

### Three new detectors in `scripts/progression.mjs`

Each record matches the existing detector shape:

```js
{
  transcriptsRequired: boolean,
  detect(sessions, facets, transcripts, ctx) -> milestone | null
}
```

`detectMilestones` already loops over the array and skips
`transcriptsRequired: true` records when `--include-transcripts` is off. No
changes to the runner or the UI pipeline were needed.

| Detector       | Signal source     | Fires on                                   | Boris tip |
| -------------- | ----------------- | ------------------------------------------ | --------- |
| `scheduled`    | transcripts       | First session invoking `/loop`, `/schedule`, or `/babysit` | 48        |
| `remote`       | session-meta facets | First session with `tool_counts` containing `RemoteTrigger`, `PushNotification`, or `SendMessage` > 0 | 35 |
| `verification` | transcripts       | First session invoking `/go`               | 73        |

**`scheduled` — why transcript-first, not facet-first.** The milestone semantics
are "user adopted autonomous scheduling" — a user action, not a downstream tool
fire. `CronCreate` and `ScheduleWakeup` appear in `tool_counts` as Claude's
consequence of the user typing `/loop`; citing the command directly is more
accurate. Five existing detectors are also `transcriptsRequired: true`;
`--include-transcripts` is the default for `npm run assess`.

**`remote` — why facet-first.** `RemoteTrigger`, `PushNotification`, and
`SendMessage` are Claude's outbound tool calls. They appear in
`session-meta/*.json::tool_counts` without any transcript scan. Using facets
here means the `remote` milestone fires even on runs without
`--include-transcripts`, and it avoids adding a second parse layer for signals
already materialized in session-meta JSON. Empirically verified against live
`~/.claude/usage-data/` during design audit.

**`verification` — why `/go` maps to tip 73, not tip 14.** Tip 14 is Boris's
foundational "verification is the #1 tip" concept. Tip 73 is the concrete
operationalization: the `/go` composite skill (run tests, subagent verify,
code review, simplify). Citing the specific tip the user's action satisfies
matches the convention used by other detectors (e.g. "First MCP-powered
session" cites tip 9, not the broad autonomy concept).

### `scanTranscriptModes` extension in `scripts/_usage-data.mjs`

The `scheduled` and `verification` detectors need the set of slash commands
invoked in each session. `scanTranscriptModes` already scans transcript lines
for `<command-name>` tags during mode detection (for the plan/learning mode
classifiers). PR #108 piggybacks on that loop to collect a per-session
`commands: Set<string>` field alongside the existing `modes: Set<string>`.

This is a ~5-line addition; no extra file I/O is needed because the scan loop
already reads every transcript line.

The `goCommandUses` counter used by the existing verification _scorer_
(`scripts/score.mjs`) is produced by `scanTranscriptInvocations`, a separate
path. The new `commands` Set in `scanTranscriptModes` is only consumed by the
two new transcript-dependent detectors.

## Back-dating behavior

All three detectors self-date from `session.start_time` over full transcript
history. On first deploy, the timeline immediately shows historically-accurate
adoption timestamps rather than the deploy date. Example timestamps observed in
live verification:

| Dimension      | Back-dated first-seen |
| -------------- | --------------------- |
| `scheduled`    | 2026-04-29            |
| `remote`       | 2026-04-15            |
| `verification` | 2026-05-26            |

This matches the behavior of all existing telemetry detectors (config-progression
detectors are the only ones that can't back-date, because the config snapshot
carries no embedded timestamp).

## Coverage after this change

| Dimension       | Detector type    | Before PR #108 | After |
| --------------- | ---------------- | -------------- | ----- |
| `automation`    | telemetry        | ✅              | ✅     |
| `integrations`  | telemetry        | ✅              | ✅     |
| `learning`      | telemetry        | ✅              | ✅     |
| `memory`        | telemetry        | ✅              | ✅     |
| `model-effort`  | telemetry        | ✅              | ✅     |
| `parallel`      | telemetry        | ✅              | ✅     |
| `permissions`   | telemetry        | ✅              | ✅     |
| `planning`      | telemetry        | ✅              | ✅     |
| `scheduled`     | telemetry        | ❌              | ✅     |
| `remote`        | telemetry        | ❌              | ✅     |
| `verification`  | telemetry        | ❌              | ✅     |
| `customization` | config only      | ✅ (config)     | ✅ (config) |

## No downstream changes required

- **UI:** `app/progression/page.tsx` and the `loadProgression` utility consume
  `app/data/progression.json` uniformly. The new milestone records drop in via
  the existing pipeline.
- **Probe tracker / header counts:** no new `satisfiedWhen` predicates,
  `probe-catalog.json` entries, or `signalsSummary` keys were introduced. The
  five CI-enforced header counts remain `75/12/48/47/71`.
- **Scoring:** `scripts/score.mjs` is unchanged. The detectors are
  purely additive to the timeline display.

## Related files

- `scripts/progression.mjs` — detector array (12 entries after this PR)
- `scripts/_usage-data.mjs` — `scanTranscriptModes` (new `commands` field)
- `docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md` — full design spec
- `docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md` — implementation plan
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — probe tracker (updated in same PR)
