---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression Timeline: Dual-Source Architecture

The `/progression` dashboard page reads `app/data/progression.json`, rewritten on every `npm run assess`. That file merges milestones from two independent sources with different dating semantics. Understanding the split prevents mistaking a frozen or back-dated timeline for a bug.

## Two milestone sources

### Telemetry milestones

`scripts/progression.mjs` contains 9 detectors. Each detector self-dates its milestone from the `start_time` of matching sessions, scanning **full session history** — independent of `--insights-lookback`. That independence is intentional: progression is a long-arc signal, not a 30-day window. If April session dates appear under an active 30-day scoring window, that's correct behavior, not stale data. The two parameters (`--insights-lookback` and `--progression-lookback`, which defaults to `null`) govern entirely separate passes over the telemetry.

The 9 detectors cover: `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, and `planning`.

### Config milestones

`scripts/config-progression.mjs` contains 8 detectors. These read the Platform Setup signals snapshot produced by `scripts/signals.mjs` — the same scan that drives the radar's Setup axis. Because the signals snapshot carries no embedded timestamp for when a setting was first applied, each config milestone's `firstSeenAt` is **stamped at the first `npm run assess` run that observes the condition satisfied** and then frozen in `app/data/progression-config.json`. Subsequent runs leave a satisfied condition's `firstSeenAt` unchanged.

**First-run caveat (by design):** if you install the dashboard after already having hooks, agents, and commands in place, all 8 config milestones will share the same `firstSeenAt` — the date of your first run. The dashboard deliberately does not back-date from file mtimes or git history (fragile and lossy). The identical timestamps are correct behavior, not a sign that detection failed.

## Coverage gap

Three of the 12 scored dimensions — `scheduled`, `remote`, and `verification` — have no milestone detector in either source. Heavy real usage in those areas produces no entry in the progression timeline, and the timeline will appear frozen past the first-run wall for them. Adding telemetry-dated detectors for all three is tracked as **CCE-33**.

## Data flow

```
npm run assess
  ├── scripts/progression.mjs         → merged into app/data/progression.json   (rewritten each run)
  └── scripts/config-progression.mjs  → app/data/progression-config.json        (firstSeenAt frozen on first write)
                                                        ↓
                                          app/progression/page.tsx
                                          (reads via loadProgression — not /insights history)
```

`app/progression/page.tsx` renders `app/data/progression.json` via `loadProgression`. It is completely separate from the `/insights` history; running `/insights` does not update the progression timeline.

## Diagnosing unexpected timeline behavior

| Symptom | Likely cause | Verdict |
| ------- | ------------ | ------- |
| Old dates (e.g. April) appear under a 30-day scoring window | Telemetry milestones scan full history, independent of `--insights-lookback` | Expected |
| All config milestones share the same date | First-run stamping — pre-existing config gets the first-run date | Expected |
| No milestones for `scheduled`, `remote`, or `verification` | No detector exists for those dimensions yet | Expected — see CCE-33 |
| Timeline does not advance after `npm run assess` | Check whether `app/data/progression.json` was actually rewritten | Investigate |
| Config milestone `firstSeenAt` changed between runs | Should not happen — check for a stale `progression-config.json` write | Bug |
