---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression Timeline: Dual-Source Architecture

The `/progression` page (`app/progression/page.tsx`) renders `app/data/progression.json`, which is **rewritten on every `npm run assess`** run. If the timeline looks frozen, the data is fresh — the likely explanations are a first-run artifact, milestone saturation, or a coverage gap, not a stale file.

## Two milestone sources

`progression.json` merges output from two independent detector modules:

| Source | Module | How timestamps work | State file |
| ------ | ------ | ------------------- | ---------- |
| **Telemetry milestones** | `scripts/progression.mjs` | Self-dated from `session.start_time` across **full history** | None — recomputed each run |
| **Config milestones** | `scripts/config-progression.mjs` | Stamped at the **first run that observes the signal as satisfied**, then frozen | `app/data/progression-config.json` |

### Telemetry detectors (`scripts/progression.mjs`)

Nine detectors walk `~/.claude/usage-data/session-meta/*.json` (and optionally raw transcripts) in chronological order. Because each detector dates itself from the session's own `start_time`, telemetry milestones reflect your real first-use date — even sessions from months ago show up with their actual timestamps.

**Important:** telemetry milestones use `--progression-lookback` (default `null`, meaning full history), which is **independent of `--insights-lookback`**. You can run with `--insights-lookback 30` and still see April milestones in the timeline because the progression walker ignores the scoring window.

### Config detectors (`scripts/config-progression.mjs`)

Eight detectors read the signals snapshot — a current-state view of `~/.claude/settings.json` and the filesystem. Because the snapshot has no "when did this entry get added" metadata, the module maintains its own state file (`app/data/progression-config.json`). The first run that observes a signal as satisfied writes `firstSeenAt = now` and that timestamp never changes, even if you later revert the config.

## First-run caveat (by design)

On the dashboard's very first `npm run assess`, every already-satisfied config signal receives `firstSeenAt = first-run date`. That's why all 8 config milestones share the identical `2026-05-09T08:37:16.111Z` timestamp rather than their true adoption dates.

Back-dating from filesystem mtimes or settings.json git history was considered and rejected — it's fragile and lossy. The deliberate trade-off: installation-day timestamps instead of approximate historical ones.

## Coverage gap

The detector catalog only covers 8 of 12 scored dimensions:

| Covered | Not covered |
| ------- | ----------- |
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

Heavy real usage in `scheduled`, `remote`, or `verification` produces no milestone entry, so the timeline can look frozen past the first-run wall for those dimensions. This is a known gap, not a bug. Adding telemetry-dated detectors for the three uncovered dimensions is tracked as **CCE-33**.

## Diagnosing a "frozen" timeline

Work through this checklist before assuming a bug:

1. **First-run artifact** — if all config milestones share the same timestamp, that is the expected first-run behavior. Nothing is wrong.
2. **Saturation** — each detector fires at most once (the first occurrence). Once all milestones for a dimension are crossed, the timeline shows nothing new for that dimension.
3. **Coverage gap** — if you're heavily using `scheduled`, `remote`, or `verification` workflows, those produce no milestones yet (CCE-33).
4. **Stale data file** — check whether `app/data/progression.json` mtime matches your last `npm run assess` run. The file is rewritten unconditionally on every run.

## File map

```
scripts/
  progression.mjs          # 9 telemetry detectors; dated from session start_time
  config-progression.mjs   # 8 config detectors; firstSeenAt stamped at first observation
app/
  progression/page.tsx     # reads app/data/progression.json via loadProgression
  data/
    progression.json       # gitignored; merged telemetry + config milestones (rewritten per run)
    progression-config.json # gitignored; frozen firstSeenAt state for config detectors
```
