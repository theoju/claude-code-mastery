---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression timeline: dual-source architecture

The `/progression` page (`app/progression/page.tsx`) renders a milestone
timeline that draws from two independent sources merged at assessment time.
Several of its behaviors look like bugs — April dates under a 30-day scoring
window, all config milestones carrying the same timestamp, certain dimensions
appearing frozen — but each is intentional. This document records the
architecture and the design decisions behind those behaviors.

## Two milestone sources

`npm run assess` writes `app/data/progression.json` by merging output from two
separate walkers:

| Source | Script | Detectors | Dating strategy |
| ------ | ------ | --------: | --------------- |
| **Telemetry milestones** | `scripts/progression.mjs` | 9 | Self-dated from session `start_time` across **full history** (independent of `--insights-lookback`) |
| **Config milestones** | `scripts/config-progression.mjs` | 8 | `firstSeenAt` stamped at the **first run that observes** the signal; frozen in `app/data/progression-config.json` |

### Telemetry milestones

`scripts/progression.mjs` walks `~/.claude/usage-data/session-meta/*.json`
from the beginning of recorded history, regardless of how many days
`--insights-lookback` covers for scoring. A session that first matched the
"multi-task" pattern in April still dates its milestone to April even when
the scoring window is 30 days. The full-history walk is intentional: the
timeline is a record of when you adopted something, not a view into the
current scoring window.

### Config milestones

`scripts/config-progression.mjs` reads the signals snapshot produced by
`scripts/signals.mjs`. Those signals have no embedded "when" — `settings.json`
records the current state, not the history. To give every config milestone a
date, `config-progression.mjs` stamps `firstSeenAt = <now>` the first time it
observes a signal as satisfied and persists that stamp in
`app/data/progression-config.json` (gitignored). On subsequent runs, it reads
the stored stamp rather than overwriting it.

**First-run caveat (by design):** every config signal that was already
satisfied at the time of the dashboard's first run gets
`firstSeenAt = first-run timestamp`. That is why all 8 config milestones in a
fresh install share the identical `2026-05-09T08:37:16.111Z` — the dashboard
cannot back-date from file mtimes or git history (fragile and lossy), so it
deliberately doesn't try. The policy is: _the dashboard knows when it first
saw it, not when you first did it._

## Coverage gap

Of the 12 scored dimensions, only 8 have milestone detectors:

| Covered | Not covered |
| ------- | ----------- |
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

Heavy real usage of scheduled work, remote/mobile sessions, or verification
workflows produces no progression entry and leaves those sections of the
timeline frozen past the first-run wall. This is a known gap, not a data
error. Adding telemetry-dated detectors for the three uncovered dimensions is
tracked as **CCE-33**.

## Where things live

```
scripts/
  progression.mjs           # telemetry milestone walker (9 detectors)
  config-progression.mjs    # config milestone walker (8 detectors)
app/
  progression/page.tsx      # renders app/data/progression.json
  data/
    progression.json        # gitignored: merged output, rewritten each run
    progression-config.json # gitignored: persisted firstSeenAt stamps
```

`progression.json` is rewritten on every `npm run assess` — so the timeline
_is_ current after each run. If the timeline appears stale, confirm
`npm run assess` completed without error before assuming a data issue.

## Practical consequences

- **Old dates under a short lookback window** — expected. Telemetry milestones
  date to actual session history, not to the scoring window.
- **All config milestones share one timestamp** — expected on a fresh install.
  The stamp advances only when you add a new config signal after the first run.
- **A dimension never shows a milestone** — likely in the coverage gap
  (`scheduled`, `remote`, `verification`). CCE-33 tracks the fix.
- **A config milestone's timestamp is wrong** — only possible if
  `progression-config.json` was deleted and regenerated after the real adoption
  date. The file is gitignored; deleting it resets all config stamps to today.
