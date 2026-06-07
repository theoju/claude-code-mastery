---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression Timeline: Dual-Source Architecture

The `/progression` page (`app/progression/page.tsx`) renders a milestone timeline that reads from `app/data/progression.json`, a file rewritten on every `npm run assess` run. If the timeline looks frozen, or if you see April dates under a 30-day scoring window, or if all config milestones share the same timestamp — that's by design. This page explains the two milestone sources and their different semantics.

## Two sources, two semantics

`progression.json` merges milestones from two independent walkers:

| Source | Script | Detectors | Date-stamping |
|---|---|---|---|
| Telemetry milestones | `scripts/progression.mjs` | 9 detectors | Self-dated from session `start_time` over **full history** |
| Config milestones | `scripts/config-progression.mjs` | 8 detectors | Stamped at the **first run that observed it**, then frozen in `app/data/progression-config.json` |

### Telemetry milestones

`scripts/progression.mjs` scans `~/.claude/usage-data/` across full session history — it uses `--progression-lookback` (default `null`, meaning all history), independent of `--insights-lookback`. A 30-day scoring window doesn't constrain what dates the progression walker can surface. That's why an April session date can appear on the timeline while the Execution scores reflect only the last 30 days: the two lookback windows serve different purposes.

### Config milestones

`scripts/config-progression.mjs` reads the signals snapshot produced by `scripts/signals.mjs`. Config signals (`~/.claude/settings.json`, agent/command/skill files, plugins) carry no embedded timestamp — there's no reliable "when was this first set?" field in the file system state. So each detector stamps `firstSeenAt` at the first run that observed the signal satisfied, and that value is frozen in `app/data/progression-config.json`.

**First-run caveat (by design):** every already-satisfied config signal gets `firstSeenAt = first-run date`. This is why all 8 config milestones may share the same timestamp (e.g. `2026-05-09T08:37:16.111Z`) rather than reflecting true adoption dates. The design deliberately does not back-date from file mtimes or git history — those signals are fragile and lossy.

## Coverage gap

The detector catalog covers 8 of 12 scored dimensions:

| Covered | Gap |
|---|---|
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

The three uncovered dimensions have no milestone detector. Heavy real usage in those areas produces no milestone, so the timeline can look frozen past the first-run wall even when Execution scores in those dims are non-trivial. Adding telemetry-dated detectors for `scheduled`, `remote`, and `verification` is tracked as **CCE-33** — file a design spec before implementing.

## File layout

```
app/data/
  progression.json           # merged output, rewritten every npm run assess
  progression-config.json    # frozen firstSeenAt stamps for config milestones

scripts/
  progression.mjs            # 9 telemetry milestone detectors
  config-progression.mjs     # 8 config milestone detectors

app/progression/page.tsx     # renders progression.json (not /insights history)
```

`app/progression/page.tsx` reads `app/data/progression.json` via `loadProgression`. It was moved out of the main dashboard in v0.9.7. The data contract is a flat array of milestone objects with `{ id, label, date, source }` — each run replaces the file wholesale.

## Debugging the timeline

If the timeline looks wrong:

1. **All milestones share one date** — normal for config milestones on a first run; check the `source` field to distinguish telemetry vs. config entries.
2. **Old dates appear under a 30-day window** — expected; telemetry milestones use `--progression-lookback` (unbounded by default), not `--insights-lookback`.
3. **A dimension is missing entirely** — it may be in the coverage gap (`scheduled`, `remote`, `verification`). CCE-33 tracks adding those detectors.
4. **Timeline hasn't updated** — confirm `npm run assess` ran successfully and `app/data/progression.json` was rewritten (check its mtime).
