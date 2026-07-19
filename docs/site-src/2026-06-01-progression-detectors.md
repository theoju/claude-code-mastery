---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# Progression detectors: closing the scheduled/remote/verification gap

`/progression` walks your telemetry in chronological order and reports the
first time you adopted a workflow pattern — first subagent session, first
worktree, first plan-mode entry. Through v0.9.19 the detector catalog in
`scripts/progression.mjs` covered 8 of the 12 scored dimensions
(`automation`, `integrations`, `learning`, `memory`, `model-effort`,
`parallel`, `permissions`, `planning`). `scheduled`, `remote`, and
`verification` had no detector at all, so real usage in those three areas
produced nothing on the timeline — it just looked frozen past your first
run. PR #108 closes that gap with three new detectors, tracked as CCE-33.

## The three new detectors

All three live in the same `DETECTORS` array in `scripts/progression.mjs`,
matching the existing record shape exactly:
`{ transcriptsRequired: boolean, detect(sessions, facets, transcripts, ctx) }`.

- **`scheduled`** — fires on the first session where the transcript's
  per-session `commands` set contains `/loop`, `/schedule`, or `/babysit`.
  Milestone text: "Started using scheduled workflows," cites Boris tip 48.
  This is command-first, not tool-first: the milestone is "you adopted
  autonomous scheduling," a user action, so it keys off the slash command
  you typed rather than the `CronCreate`/`ScheduleWakeup` tool calls Claude
  fires as a downstream consequence.
- **`remote`** — fires on the first session where `tool_counts` shows a
  nonzero `RemoteTrigger`, `PushNotification`, or `SendMessage`. Milestone
  text: "First remote-tool invocation," cites Boris tip 35 (the umbrella
  tip for cowork dispatch / mobile push / iMessage — the rubric maps
  `remote` to tips `[35, 44, 46, 47, 50]`, and 35 is the cleanest single
  citation for a detector that fires on any of the three). This one is
  `transcriptsRequired: false` — all three signals already live in
  `session-meta/*.json::tool_counts`, no transcript scan needed.
- **`verification`** — fires on the first session where the transcript's
  `commands` set contains `/go`. Milestone text: "First /go composite
  invocation," cites Boris tip 73 rather than the broader tip 14
  ("Verification — The #1 Tip") — 73 is the specific, actionable thing you
  did (ran the `/go` composite skill), matching how the existing detectors
  cite specific tips (e.g. the MCP detector cites tip 9, not a general
  "integrations" concept).

Like the other transcript-backed detectors, `scheduled` and `verification`
only run when `--include-transcripts` is on; `detectMilestones` skips any
`transcriptsRequired: true` record when the transcript scan wasn't
requested for that run.

## The supporting change: per-session `commands`

Two of the three new detectors (`scheduled`, `verification`) needed a way
to ask "did this session's transcript contain `/loop`, `/babysit`, or
`/go`?" That data didn't previously exist per-session. `scanTranscriptModes`
in `scripts/_usage-data.mjs` already scanned every transcript line for
`<command-name>` markup — it was using that scan to detect the
planning-skill and learning-skill mode-equivalents. The fix piggybacks on
the same loop: every matched command name (slash-stripped, full namespaced
form preserved — `superpowers:writing-plans` stays intact, not truncated to
`writing-plans`) now also lands in a new `commands: Set<string>` returned
alongside `modes`, `skills`, `hasWorktreeState`, and the rest. No extra I/O
— it's the same pass over the same lines, just capturing one more field.

This is worth distinguishing from `scanTranscriptInvocations`'s
`TARGET_COMMANDS` scan, which is a different function serving a different
consumer: `scanTranscriptInvocations` aggregates command counts *across
all sessions* for the Execution scorer (with posture/volume partitioning —
see the CLAUDE.md rule on `POSTURE_COMMANDS`/`VOLUME_COMMANDS`), while
`scanTranscriptModes`'s new `commands` set is a *per-session* view that
progression's "find the first session where X" detectors need. Both scans
were already running; this just exposes a field the second one didn't have
yet.

## Why this matters for the timeline

`/progression` merges two milestone sources: `scripts/progression.mjs`
(telemetry-dated from session `start_time`, full history, independent of
`--insights-lookback`) and `scripts/config-progression.mjs` (config
milestones, `firstSeenAt` frozen at first observation — a separate,
intentional first-run caveat documented elsewhere). Before this PR, a user
with months of real `/loop` or `/go` usage would see none of it reflected
— the timeline would show 9 telemetry firsts saturated early and then
nothing, even though the underlying signal existed the whole time. Because
these new detectors are telemetry-dated rather than stamped at
first-run-after-merge, they back-date correctly: a `/loop` session from
weeks before this PR shipped shows up at its real date, not at the date
you upgraded.

No changes were needed in `app/progression/page.tsx` — the renderer already
consumes the uniform `{timestamp, dimension, milestone, borisTip, evidence,
sessionId}` shape, so the three new detectors drop through the existing
pipeline unmodified.

## Coverage gap, closed

All 12 scored dimensions now have progression coverage — `scheduled`,
`remote`, and `verification` join the original 8. `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
was updated in the same PR with three new Part 1 registry rows under the
progression-detectors layer, and Part 2 coverage rows for Boris tips 35, 48,
and 73 now reflect progression-detector coverage where they previously had
none on that axis.

Deliberately out of scope for this pass: multiple detectors per dimension
(one broad detector each), sub-feature breakdowns (Chrome control vs.
claude.ai web vs. iOS vs. GitHub Actions for `remote`; `/loop` vs.
`/schedule` vs. `/babysit` as distinct milestones for `scheduled`), and a
separate `/ship` verification milestone (the `verification` dimension
already gets `/go` coverage, and `/ship` spans multiple dimensions
ambiguously).
