---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# `/progression` — dual milestone-source architecture

The `/progression` timeline in the dashboard merges two independent milestone
pipelines that date events differently. If the timeline looks frozen since a
single date, or all config milestones share an identical timestamp, neither is
a bug — both are deliberate design artifacts with known tradeoffs.

## Two sources, two dating strategies

| Source | Script | Detectors | Dating |
| --- | --- | --- | --- |
| Telemetry milestones | `scripts/progression.mjs` | 9 detectors | Self-dated from session `start_time` across **full history** — independent of `--insights-lookback` |
| Config milestones | `scripts/config-progression.mjs` | 8 detectors | `firstSeenAt` stamped at the **first run that observed the signal**, then frozen in `app/data/progression-config.json` |

`app/progression/page.tsx` reads `app/data/progression.json`, which is
**rewritten on every `npm run assess`**. That file merges both sources at
write time.

### Telemetry milestones

`scripts/progression.mjs` walks the session `start_time` field across your
full `~/.claude/usage-data/` history. Its lookback is set via
`--progression-lookback` (default: `null`, meaning all-time) — **not** the
`--insights-lookback` flag that controls the 30-day scoring window. This is
why April-dated milestones appear under a 30-day scoring window: the scoring
window and the progression lookback are independent.

### Config milestones

`scripts/config-progression.mjs` reads signals from the snapshot that
`scripts/signals.mjs` produces — the same settings, filesystem, and plugin
reads that feed Platform Setup scoring. Those signals carry no embedded
timestamp, so `firstSeenAt` is stamped at the first run that observed them and
written to `app/data/progression-config.json`. Subsequent runs leave the value
frozen.

## The first-run caveat

On the very first `npm run assess` run, every already-satisfied config signal
is observed simultaneously, so all 8 config milestones receive the same
`firstSeenAt`. In production this looks like:

```
2026-05-09T08:37:16.111Z  — hooks configured
2026-05-09T08:37:16.111Z  — custom agents present
2026-05-09T08:37:16.111Z  — slash commands authored
…
```

All eight share an identical timestamp. That is the dashboard's first-run
date, not the true adoption date for any of them.

This is deliberate. Back-dating from file mtimes or git history is fragile and
lossy — mtimes reset on clone and git history tracks commits, not when you
actually adopted a practice. The first-run wall is the honest representation
of what the dashboard knows.

## Coverage gap — three unmeasured dimensions

Of the 12 scored dimensions, only 8 have milestone detectors:

```
automation, integrations, learning, memory,
model-effort, parallel, permissions, planning
```

The remaining three have **no detector**:

| Dimension | Why |
| --- | --- |
| `scheduled` | Autonomous `/schedule` / `/loop` volume is in cooked telemetry, but no dated-event shape to hang a milestone on yet |
| `remote` | Same gap — remote-session volume exists, no milestone anchor |
| `verification` | Verification signals are ratio/count-based with no natural "first event" |

Heavy real usage in `scheduled`, `remote`, or `verification` produces no
milestone, and the timeline will look frozen past the first-run wall for those
dimensions. This is expected. Adding telemetry-dated detectors for all three is
tracked as **CCE-33**.

## Diagnosing a "frozen" timeline

If the progression page looks static, work through this checklist:

1. **All config milestones share one date** → first-run artifact. Normal.
2. **No new telemetry milestones since first run** → saturation: all 9
   telemetry detectors already fired. Check which ones by looking at the
   milestone list — once a detector fires it doesn't re-fire.
3. **No milestones at all for a dimension you actively use** → coverage gap.
   If that dimension is `scheduled`, `remote`, or `verification`, it's CCE-33.
4. **Telemetry milestones predating your expectations** → confirm
   `--progression-lookback` is not restricting history. The default is
   `null` (all-time).

## Related files

| File | Role |
| --- | --- |
| `scripts/progression.mjs` | Telemetry milestone walker — 9 detectors, self-dated from session `start_time` |
| `scripts/config-progression.mjs` | Config milestone walker — 8 detectors, `firstSeenAt` frozen on first observe |
| `app/data/progression.json` | Merged output — rewritten by `npm run assess` |
| `app/data/progression-config.json` | Config milestone state — `firstSeenAt` values frozen here |
| `app/progression/page.tsx` | Timeline renderer — reads `progression.json` via `loadProgression` |

## CCE-33

**CCE-33** tracks the design and implementation of telemetry-dated milestone
detectors for the three uncovered dimensions (`scheduled`, `remote`,
`verification`). Design it before implementing — the right anchor event for
each isn't obvious and getting it wrong produces misleading dates that are
worse than no date.
