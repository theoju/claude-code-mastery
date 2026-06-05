---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# `/progression` — dual milestone-source architecture

The `/progression` timeline at `app/progression/page.tsx` renders
`app/data/progression.json`, which is rewritten on every `npm run assess`. It
merges two independent milestone sources with different time semantics. If the
timeline looks frozen past a certain date, that is usually expected — not a
bug. This page explains why.

## Two milestone sources

| Source | Script | How dates are set | Lookback |
| ------ | ------ | ----------------- | -------- |
| **Telemetry milestones** | `scripts/progression.mjs` | Self-dated from session `start_time` in `~/.claude/usage-data/` | Full history (`--progression-lookback null`, independent of `--insights-lookback`) |
| **Config milestones** | `scripts/config-progression.mjs` | Stamped at **first run** that observes the signal; written to `app/data/progression-config.json` and frozen | Not applicable — reads the signals snapshot, which carries no embedded timestamp |

Telemetry milestones can surface dates from months ago because they walk the
full session history. Config milestones can only say "first time I saw this,"
which defaults to your dashboard's first `npm run assess` run.

## The first-run caveat

Every config signal that was already satisfied when you ran the dashboard for
the first time gets `firstSeenAt` stamped with that single run's timestamp.
That is why all 8 config milestones may share an identical date (for example,
`2026-05-09T08:37:16.111Z` on the reference installation). It deliberately
does **not** back-date from file mtimes or git history — those sources are
fragile and lossy, and the trade-off is documented as a known limitation, not
an oversight.

The config milestone file (`app/data/progression-config.json`) is frozen: once
a signal's `firstSeenAt` is written, subsequent runs preserve it. A newly
satisfied signal gets stamped on the run that first observes it, so the file
accumulates over time rather than being rewritten each run.

## The coverage gap

The milestone catalog covers 8 of the 12 scored dimensions:

```
automation  integrations  learning  memory
model-effort  parallel  permissions  planning
```

Three dimensions — **`scheduled`**, **`remote`**, and **`verification`** — have
no milestone detector. Heavy usage in those areas produces no timeline entry,
so the progression view can look frozen even when execution scores in those
dims are improving. This is tracked as **CCE-33** (feature work; design before
implementing new detectors).

## Reading the timeline

When you see a wall of identical config timestamps followed by silence, the
likely explanation is:

1. **First-run artifact** — all config signals were already satisfied when you
   first ran `npm run assess`. The timestamps are real; they reflect when the
   dashboard first observed your setup, not when you adopted the feature.
2. **Saturation** — you've hit the ceiling of what the current catalog detects.
   Telemetry milestones that would push the timeline forward (first worktree
   session, first `/insights` run, first plan-mode activation) may already be
   satisfied and won't re-fire.
3. **Coverage gap** — your active work is in `scheduled`, `remote`, or
   `verification`, which have no detectors yet (CCE-33).

A genuinely new behavior — enabling a previously-absent signal, crossing a
telemetry threshold for the first time — will add a fresh entry on the next
`npm run assess` run.

## Files involved

| File | Role |
| ---- | ---- |
| `scripts/progression.mjs` | 9 telemetry milestone detectors, self-dated from session `start_time` |
| `scripts/config-progression.mjs` | 8 config milestone detectors, `firstSeenAt` frozen on first observation |
| `app/data/progression-config.json` | Persisted config milestone state (gitignored) |
| `app/data/progression.json` | Merged output written on every `npm run assess` (gitignored) |
| `app/progression/page.tsx` | Timeline renderer — reads `progression.json` via `loadProgression` |
