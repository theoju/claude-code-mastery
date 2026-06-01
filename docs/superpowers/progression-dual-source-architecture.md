---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
---

# `/progression` Timeline — Dual-Source Architecture

The milestone timeline at `/progression` reads `app/data/progression.json`,
which is **rewritten on every `npm run assess`** run. If it looks frozen or
if all config milestones share one timestamp, that is almost certainly
documented behavior — not a bug. This page explains why.

## Two milestone sources

`progression.json` merges output from two independent scripts:

| Source | Script | Detectors | Timestamp origin |
| ------ | ------ | --------: | ---------------- |
| Telemetry milestones | `scripts/progression.mjs` | 9 | `start_time` field in `~/.claude/usage-data/session-meta/*.json` |
| Config milestones | `scripts/config-progression.mjs` | 8 | `firstSeenAt` stamped at the **first run** that observed the signal |

### Telemetry milestones

`scripts/progression.mjs` walks cooked session telemetry under
`~/.claude/usage-data/` and detects nine adoption events (plan-mode first
use, first parallel session, first hook firing, etc.). Each milestone is
self-dated from the session's `start_time`, so dates can reach back months
or years — **independent of `--insights-lookback`**. A 30-day scoring window
does not shorten the progression lookback; `--progression-lookback` defaults
to `null` (full history). That is why you may see April or March dates on a
timeline produced under a 30-day window.

### Config milestones

`scripts/config-progression.mjs` reads the current signals snapshot
(output of `scripts/signals.mjs`) and checks eight structural config
predicates — whether a custom agent exists, whether hooks are configured,
and so on. Config signals carry no embedded timestamp; the filesystem
provides no reliable creation date. Instead, each `firstSeenAt` is stamped
**at the first `npm run assess` run that observed that signal as satisfied**,
then written to `app/data/progression-config.json` and frozen.

## First-run caveat (by design)

If you already had agents, hooks, and commands in place before running the
dashboard for the first time, every already-satisfied config signal gets
`firstSeenAt = first-run timestamp`. That is why all 8 config milestones
may share a single identical timestamp — for example, `2026-05-09T08:37:16.111Z`
— rather than reflecting their true adoption dates.

This is deliberate. Back-dating from file mtimes or git history was
considered and rejected as fragile and lossy: mtimes change on copy, git
history only covers committed files, and neither source is authoritative for
`~/.claude/`. The first-run artifact is the honest behavior; it just looks
surprising until you know to expect it.

**Rule of thumb:** if all config milestones share one timestamp, that
timestamp is your dashboard's first-run date, not a system error.

## Coverage gap — CCE-33

The milestone catalog covers **8 of the 12 scored dimensions**:

```
automation  integrations  learning  memory
model-effort  parallel  permissions  planning
```

Three dimensions have **no milestone detector**:

- `scheduled` — scheduled/autonomous workflow usage
- `remote` — remote/mobile session usage  
- `verification` — verification habit signals

Heavy real usage in those three dimensions produces no milestone entry, so
the timeline can appear frozen or sparse even for active users. Adding
telemetry-dated detectors for these three is tracked as **CCE-33** (deferred
feature work — design it before implementing).

## Distinguishing bugs from documented behavior

| Symptom | Most likely cause |
| ------- | ----------------- |
| All config milestones share one timestamp | First-run artifact — documented behavior |
| Timeline shows April dates under a 30-day window | Telemetry lookback is independent of `--insights-lookback` |
| No milestones for heavy `scheduled`/`remote`/`verification` use | Coverage gap — CCE-33 |
| `progression.json` appears stale | Check whether `npm run assess` ran; the file is written on every run |

If none of those match, check `app/data/progression-config.json` directly —
it holds the frozen `firstSeenAt` values and is the source of truth for
config milestones.

## File map

| File | Role |
| ---- | ---- |
| `scripts/progression.mjs` | Telemetry milestone walker — 9 detectors, self-dated from `session start_time` |
| `scripts/config-progression.mjs` | Config milestone walker — 8 detectors, `firstSeenAt` stamped at first observation |
| `app/data/progression.json` | Merged output; rewritten on every `npm run assess` |
| `app/data/progression-config.json` | Frozen config `firstSeenAt` values; updated only when a new config signal is first observed |
| `app/progression/page.tsx` | Dashboard page — reads `progression.json` via `loadProgression` |
