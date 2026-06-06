---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression timeline — dual-source architecture

The `/progression` timeline (`app/progression/page.tsx`) renders
`app/data/progression.json`, which is **rewritten on every `npm run assess`
run**. That file merges two independent milestone sources whose dating
semantics are completely different. Understanding both prevents common
misreads — particularly the "frozen since May 9" appearance that shows up for
every fresh install.

## Source 1 — telemetry milestones

**Script:** `scripts/progression.mjs` (9 detectors)

These milestones self-date from the `start_time` field of session records
in `~/.claude/usage-data/session-meta/`. Because the session history spans
**full account history** (not the `--insights-lookback` window), an April
milestone correctly appears even when you're running a 30-day scoring window.
Dates here reflect when usage actually happened.

`--progression-lookback` (default `null` = full history) controls how far
back these detectors scan. Pass `--progression-lookback 90` to restrict the
walk to 90 days. This is independent of `--insights-lookback`, which only
affects the Execution scoring window.

## Source 2 — config milestones

**Script:** `scripts/config-progression.mjs` (8 detectors)

These milestones read the signals snapshot (the same static state
`scripts/signals.mjs` produces) and stamp `firstSeenAt` at the **first run
that observed the signal satisfied**. The timestamp is frozen in
`app/data/progression-config.json` and never updated thereafter.

There is no "true adoption date" here — config signals carry no embedded
timestamp (a `settings.json` key doesn't record when it was set). The design
deliberately doesn't back-date from mtimes or git history because both are
fragile and lossy. The consequence: every already-satisfied config signal gets
`firstSeenAt = first-run date`.

### Why all 8 config milestones share the same timestamp

If you installed this dashboard and ran `npm run assess` for the first time
after your Claude Code setup was already mature, all 8 config milestones
share the same `firstSeenAt` — for example `2026-05-09T08:37:16.111Z`.

That is not a bug. It means all 8 signals were already satisfied on the
first run, so all 8 were stamped together. The "first seen" semantics are
correct; the date is just the dashboard's first run, not the underlying tool's
adoption date.

## Coverage gap (CCE-33)

The 9 telemetry detectors and 8 config detectors cover 8 of the 12 scored
dimensions:

| Covered | Dimensions |
| ------- | ---------- |
| ✅      | `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` |
| ❌      | `scheduled`, `remote`, `verification` |

The three uncovered dimensions have no milestone detector. Real adoption there
— heavy scheduled usage, verified remote sessions, strong verification
posture — produces no milestone entry, so the timeline appears frozen after
the first-run wall even when those dimensions are active. **CCE-33** tracks
adding telemetry-dated detectors for all three.

## How the page renders

`app/progression/page.tsx` calls `loadProgression()` which reads
`app/data/progression.json`. It does **not** read `/insights` history or
`~/.claude/usage-data/` directly. Both milestone sources are merged and
sorted before writing `progression.json` on each `npm run assess` run, so the
page is always a snapshot of the last scored run — not a live query.

## Debugging the timeline

| Symptom | Likely cause |
| ------- | ------------ |
| All config milestones share identical timestamp | First-run artifact — all signals were already satisfied on first run. By design. |
| Telemetry milestones cluster in a narrow date range | Saturation: you adopted everything early; new detectors can't find an earlier session. |
| No milestones past a certain date despite active usage | Coverage gap — usage was in `scheduled`, `remote`, or `verification` (CCE-33). |
| Timeline looks completely empty | `app/data/progression.json` is missing or stale — run `npm run assess` first. |

If the issue is saturation or coverage gap, run `npm run assess:print` and
inspect the per-dimension Execution scores. Those read from `usage-data/`
directly and will confirm whether real usage is occurring in the uncovered
dimensions, regardless of whether the timeline shows it.
