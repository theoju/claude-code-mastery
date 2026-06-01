---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# Progression Timeline: Dual-Source Architecture

`app/progression/page.tsx` reads `app/data/progression.json`, which is
**rewritten on every `npm run assess` run**. That file merges two structurally
different milestone sources — telemetry detectors and config detectors — each
with a different dating strategy and coverage scope. If the timeline looks
frozen, or all config milestones share an identical timestamp, the architecture
explains why. Neither is a bug.

---

## Two milestone sources

| Source | Script | Detectors | Dating strategy | Persisted in |
| --- | --- | --- | --- | --- |
| Telemetry | `scripts/progression.mjs` | 9 | `session.start_time` from raw session data | `app/data/progression.json` (rewritten per run) |
| Config | `scripts/config-progression.mjs` | 8 | `firstSeenAt` stamped at first observation, frozen thereafter | `app/data/progression-config.json` |

---

## Telemetry milestones

`scripts/progression.mjs` walks the cooked telemetry under
`~/.claude/usage-data/` and finds when each behavioral milestone first
occurred. Every detector reads the real `session.start_time` field, so
milestones self-date from the actual session — not from when the dashboard was
installed.

**Lookback is independent of scoring.** The telemetry walker uses
`--progression-lookback` (default `null`, meaning full history), which is a
separate flag from `--insights-lookback` (default 30 days). This is why you
may see April milestone dates even under a 30-day scoring window — the two
lookbacks are distinct knobs.

The 9 detectors cover 8 scored dimensions plus one cross-cutting behavioral
signal: `automation`, `integrations`, `learning`, `memory`, `model-effort`,
`parallel`, `permissions`, `planning`.

---

## Config milestones

`scripts/config-progression.mjs` reads the signals snapshot produced by
`scripts/signals.mjs` — the same Platform Setup signals the scorer reads.
Those signals carry no embedded "when" field. The script can only record when
_the dashboard first observed_ a signal as satisfied.

The persistence contract:

1. **First run**: if a config signal is satisfied, stamp `firstSeenAt = now`
   and write it to `app/data/progression-config.json`.
2. **Subsequent runs**: if `firstSeenAt` is already frozen in
   `progression-config.json`, keep it. Never overwrite.
3. **Late adoption**: if a signal transitions from unsatisfied → satisfied
   after the first run, `firstSeenAt` gets the current run's timestamp —
   accurate to within one assess cycle.

### First-run caveat (by design)

Every config signal that was _already satisfied_ before the dashboard's first
run receives `firstSeenAt = first-run timestamp`. This is why all 8 config
milestones share the identical `2026-05-09T08:37:16.111Z` — the dashboard's
first run observed them all as already-satisfied on that date and stamped them
in one batch.

The dashboard deliberately does not back-date from file mtimes or git history.
Mtimes reset on clone; `~/.claude/settings.json` is a flat file, not an append
log; neither surface reliably reconstructs adoption dates. The first-run wall
is an accepted trade-off, not an oversight.

---

## Coverage gap (CCE-33)

The 9 telemetry detectors cover **8 of the 12 scored dimensions**. Three
dimensions have no detector:

| Dimension | Status |
| --- | --- |
| `scheduled` | Volume data exists in cooked telemetry; no detector built yet |
| `remote` | Same — telemetry is available, detector work deferred |
| `verification` | Same |

If your usage is concentrated in those three dimensions, the progression
timeline will look frozen after the first-run config wall — no new telemetry
milestones fire regardless of how much you use them. This is a **known
coverage gap tracked as CCE-33**. Adding telemetry-dated detectors for all
three is feature work; design before implementing.

---

## File map

```
scripts/
  progression.mjs           # telemetry milestone walker (9 detectors)
                            # uses --progression-lookback (default null = full history)
  config-progression.mjs    # config milestone walker (8 detectors)
                            # reads signals snapshot; freezes firstSeenAt on first observation
app/
  data/
    progression.json        # merged output — rewritten on every npm run assess (gitignored)
    progression-config.json # frozen firstSeenAt store for config milestones (gitignored)
  progression/
    page.tsx                # reads app/data/progression.json via loadProgression()
```

---

## Interpreting a frozen timeline

| Symptom | Cause | Action |
| --- | --- | --- |
| All milestones at `2026-05-09T08:37:16.111Z` | First-run artifact — config signals were already satisfied at install | Expected; not fixable retroactively |
| No new milestones despite active use | Usage is in `scheduled`, `remote`, or `verification` (CCE-33 gap) | Track CCE-33; no workaround until detectors ship |
| Timeline not advancing at all | `app/data/progression.json` may not be updating | Run `npm run assess` and check the file mtime |
| April dates under a 30-day scoring window | `--progression-lookback` defaults to full history, independent of `--insights-lookback` | Expected; pass `--progression-lookback N` to constrain it |

To inspect the merged output directly:

```bash
cat app/data/progression.json | jq '.milestones | length'
cat app/data/progression-config.json | jq 'keys'
```
