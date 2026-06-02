---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# `/progression` timeline — dual-source architecture

The `/progression` timeline (`app/progression/page.tsx`) merges milestones from
two independent detectors. They differ in how they assign dates, how far back
they look, and which dimensions they cover. Understanding the split explains
several behaviors that otherwise look like bugs.

## Two detector families

| Detector family | Script | Date source | History window |
| --- | --- | --- | --- |
| Telemetry milestones | `scripts/progression.mjs` (9 detectors) | `start_time` from session data | Full history (`--progression-lookback null`, independent of `--insights-lookback`) |
| Config milestones | `scripts/config-progression.mjs` (8 detectors) | Stamped at first observed run | Frozen in `app/data/progression-config.json` after first stamp |

### Telemetry detectors

`scripts/progression.mjs` walks the session telemetry under
`~/.claude/usage-data/` and reads each session's `start_time` directly. This
means a telemetry milestone can surface a date in April even if your scoring
window is 30 days — the lookback for progression is unrestricted by design and
is controlled separately via `--progression-lookback` (default `null`,
meaning full history).

Dates on telemetry milestones are accurate to the session that first satisfied
the detector.

### Config detectors

`scripts/config-progression.mjs` reads the signals snapshot produced by
`scripts/signals.mjs` — the same flat object that drives Platform Setup
scoring. That snapshot captures _whether_ a config signal is present; it
carries no embedded "when." So `config-progression.mjs` stamps `firstSeenAt`
at the **first `npm run assess` run that observed the signal**, and writes it
to `app/data/progression-config.json`. Subsequent runs leave the value frozen.

The frozen file is gitignored, like `assessment.json`.

## First-run artifact

If you clone the repo and run `npm run assess` with an already-mature Claude
Code setup, every config signal that's already satisfied gets
`firstSeenAt = <timestamp of that first run>`. That is why all 8 config
milestones on a first-time installation share an identical timestamp —
`2026-05-09T08:37:16.111Z` in the original deployment, for example. The
dashboard does **not** back-date these from file mtimes or git history;
that approach is fragile and lossy, and the deliberate choice is to accept
"all config milestones arrived at first-run time" as a known artifact rather
than an inaccurate reconstruction.

If this matters for your workflow, the only reliable signal is the telemetry
family: those dates come from actual session records and are accurate regardless
of when you first ran the scorer.

## Coverage gap

The 9 telemetry detectors cover 8 of the 12 scored dimensions:
`automation`, `integrations`, `learning`, `memory`, `model-effort`,
`parallel`, `permissions`, and `planning`. Three dimensions have **no
milestone detector**:

- `scheduled`
- `remote`
- `verification`

Heavy real usage in those three dimensions produces no timeline entry.
The `/progression` page will look frozen after the first-run wall for
engineers who primarily use scheduled workflows, remote/mobile access,
or systematic verification patterns. This is a known gap, tracked as
**CCE-33** (feature work: design and add telemetry-dated detectors for
the three missing dimensions before implementing).

## Reading the timeline

When you see a cluster of milestones at a single date:

1. **Config milestones with a shared timestamp** — first-run artifact.
   All config signals that were already satisfied stamped simultaneously.
2. **Telemetry milestones spread across months** — accurate session dates
   from `start_time`; the lookback is unrestricted.
3. **No milestones after a certain date** — likely coverage gap (`scheduled`,
   `remote`, or `verification`) rather than a regression.

The progression data is rewritten on every `npm run assess` run, so the
timeline updates as your telemetry history grows.

## Files involved

| File | Role |
| --- | --- |
| `scripts/progression.mjs` | 9 telemetry detectors; reads `~/.claude/usage-data/` |
| `scripts/config-progression.mjs` | 8 config detectors; reads `signals.mjs` snapshot |
| `app/data/progression-config.json` | Frozen `firstSeenAt` stamps (gitignored) |
| `app/data/progression.json` | Merged milestone output written per-run (gitignored) |
| `app/progression/page.tsx` | Renders `progression.json` via `loadProgression` |
