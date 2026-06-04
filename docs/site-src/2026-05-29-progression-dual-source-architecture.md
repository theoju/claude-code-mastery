---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression timeline — dual-source architecture

The `/progression` dashboard page (`app/progression/page.tsx`) renders
`app/data/progression.json`, which is rewritten on every `npm run assess` run.
That file merges milestones from two independent sources, each with different
dating semantics. Understanding the split explains why the timeline can look
frozen past a certain wall even when your usage is active.

## Two milestone sources

### 1 — Telemetry milestones (`scripts/progression.mjs`)

Nine detectors read session-level data from `~/.claude/usage-data/` and
date each milestone from the `start_time` field of the session that first
satisfied the detector. Because session history can reach arbitrarily far
back, these milestones self-date over **full history** regardless of
`--insights-lookback`. You can see April dates appear under a 30-day
scoring window for exactly this reason — the lookback controls Execution
scoring, not the progression timeline.

| What it tracks | Source |
| -------------- | ------ |
| First session with a specific behaviour (plan mode, parallel work, etc.) | `usage-data/facets/*.json` + `session-meta/*.json` |

The `--progression-lookback` flag (`none` by default, meaning full history)
is the only control that affects which sessions feed these detectors.

### 2 — Config milestones (`scripts/config-progression.mjs`)

Eight detectors read from the signals snapshot — the same `~/.claude/`
state that drives Platform Setup scores. Config signals carry no embedded
timestamp, so `firstSeenAt` is **stamped at the first `npm run assess` run
that observes the signal** and frozen in
`app/data/progression-config.json`. Subsequent runs that see the same
signal in-place leave the stored `firstSeenAt` untouched.

| What it tracks | Source |
| -------------- | ------ |
| Presence of agents, commands, hooks, skills, plans, etc. | `scripts/signals.mjs` output |

## First-run caveat

On a fresh install, every already-satisfied config signal gets
`firstSeenAt = <timestamp of first run>`. That is why all 8 config
milestones typically share the same timestamp if you ran `npm run assess`
after you had already configured your `~/.claude/` directory. The
dashboard deliberately does **not** back-date from mtimes or git history
— that approach is fragile and lossy.

If you care about the true adoption date for a config signal, you can
manually edit `app/data/progression-config.json` before the next
`npm run assess` run overwrites the stale `firstSeenAt`. The file format
is a plain JSON array of `{ id, firstSeenAt }` objects.

## Coverage gap (CCE-33)

The progression catalog covers 8 of 12 scored dimensions:

| Covered | No detector |
| ------- | ----------- |
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

If you use `scheduled`, `remote`, or `verification` features heavily, that
usage produces no milestone and the timeline looks frozen past the first-run
wall. Adding telemetry-dated detectors for the three missing dimensions is
tracked as **CCE-33**.

Until CCE-33 lands, a gap in the timeline for those dimensions is **expected
behaviour**, not a bug in the assessment runner or the data pipeline.

## What gets rewritten on each run

| File | Rewritten by | Contains |
| ---- | ------------ | -------- |
| `app/data/progression.json` | `scripts/run-assessment.mjs` (every run) | Merged telemetry + config milestones |
| `app/data/progression-config.json` | `scripts/config-progression.mjs` (every run, but preserves existing `firstSeenAt`) | Config milestone timestamps only |

Neither file is committed; both are gitignored alongside `assessment.json`.
The timeline you see on the dashboard is always the latest merged snapshot
from your local machine.
