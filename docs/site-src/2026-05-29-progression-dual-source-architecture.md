---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# `/progression` — dual milestone-source architecture

The `/progression` timeline merges two independent milestone sources. They have
different freshness semantics, different coverage, and a deliberate first-run
caveat that looks like a bug but isn't. This page documents all three so you
don't re-derive them from scratch.

## Two sources, two semantics

| Source | Script | Dating | History |
| --- | --- | --- | --- |
| Telemetry milestones | `scripts/progression.mjs` | Self-dated from session `start_time` | Full history, independent of `--insights-lookback` |
| Config milestones | `scripts/config-progression.mjs` | Stamped at first observed run | Frozen in `app/data/progression-config.json` after first sight |

`app/progression/page.tsx` reads `app/data/progression.json`, which is
rewritten on every `npm run assess`. That file merges both sources.

### Telemetry milestones

`scripts/progression.mjs` contains 9 detectors. Each milestone date is read
directly from session `start_time` in `~/.claude/usage-data/`. The
`--progression-lookback` flag (default `null`) controls the window; it is
**independent** of `--insights-lookback`. This is why April session dates
can appear on the timeline even when the scoring window is 30 days — the
timeline walker always walks full history unless you explicitly pass a
shorter `--progression-lookback`.

### Config milestones

`scripts/config-progression.mjs` contains 8 detectors. These read the
signals snapshot (`scripts/signals.mjs` output), which carries no embedded
timestamp for when a setting was first enabled. Instead, `firstSeenAt` is
stamped at the **first `npm run assess` run that observes the signal satisfied**
and frozen in `app/data/progression-config.json`. Subsequent runs leave the
date unchanged.

## The first-run caveat (by design)

On the first run, every config signal that is already satisfied gets
`firstSeenAt = <first-run timestamp>`. This causes all 8 config milestones to
share one identical timestamp — in the reference instance,
`2026-05-09T08:37:16.111Z`. That is not corruption; it is the intended
behavior. The alternative — back-dating from file mtimes or git history — was
rejected as fragile and lossy.

**What this means in practice:** if you install the dashboard after months of
using Claude Code, all 8 config milestones will cluster on installation day.
Only milestones you achieve _after_ the first run will carry meaningful dates.

## Coverage gap (CCE-33)

The milestone catalog covers 8 of the 12 scored dimensions:

| Covered | Not covered |
| --- | --- |
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

The three uncovered dimensions have no telemetry detector, so genuine
adoption there never surfaces on the timeline. Heavy real usage in
`scheduled`, `remote`, or `verification` will not produce a milestone
entry — the timeline looks frozen past the first-run wall for those areas.

**CCE-33** tracks adding telemetry-dated detectors for the three uncovered
dimensions. Until that work lands, treat a "no recent milestones" appearance
for those dims as a coverage gap, not evidence of disuse.

## Why the timeline appears frozen

Three factors combine to explain the "frozen since installation" appearance:

1. **First-run artifact** — all already-satisfied config milestones land on
   the same day (see above).
2. **Saturation** — once a telemetry milestone fires, it doesn't repeat. If
   you hit the threshold months ago, the timeline won't show new entries in
   that category.
3. **Coverage gap** — no detectors for `scheduled`, `remote`, `verification`.

None of these is a bug. If you see a truly frozen timeline after genuine
recent usage in a _covered_ dimension, check that `npm run assess` is running
regularly and that `--progression-lookback` isn't set to a window shorter than
your recent activity.

## File map

```
scripts/
  progression.mjs          # telemetry milestone walker (9 detectors)
  config-progression.mjs   # config milestone walker (8 detectors)
app/
  data/
    progression.json        # merged output; rewritten every npm run assess (gitignored)
    progression-config.json # frozen firstSeenAt stamps for config milestones (gitignored)
  progression/page.tsx      # renders progression.json via loadProgression
```
