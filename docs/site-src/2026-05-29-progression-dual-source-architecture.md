---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/101
synthesized_into: []
doc_kind: architecture
---

# Progression timeline — dual-source architecture

The `/progression` timeline on the dashboard combines two independent milestone
sources that have different semantics, different timestamp provenance, and
different coverage. Understanding those differences prevents misreading a
"frozen" or "everything stamped May 9" timeline as a bug.

## Two milestone sources

`app/data/progression.json` is rewritten on every `npm run assess` run. It merges
output from two walker scripts:

| Source | Script | Dating | Lookback |
|---|---|---|---|
| Telemetry milestones | `scripts/progression.mjs` | Self-dated from session `start_time` | Full history (`--progression-lookback null`) |
| Config milestones | `scripts/config-progression.mjs` | Stamped at first observation by the scorer | Frozen after first run |

The two lookback windows are independent. `--progression-lookback` controls
telemetry milestone history and defaults to `null` (full history). It is
completely separate from `--insights-lookback` (default 30 days), which
governs Execution scoring. This is why April dates can appear on the
milestone timeline even when the scoring window is 30 days.

## Telemetry milestones

`scripts/progression.mjs` contains 9 detectors. Each detector reads session
`start_time` from `~/.claude/usage-data/session-meta/*.json` and self-dates
when it first detects its target event (e.g., first parallel session, first
plan-mode session). Because the underlying telemetry carries real timestamps,
these milestones can surface dates from months ago on the first run.

## Config milestones

`scripts/config-progression.mjs` contains 8 detectors. These read the
**signals snapshot** — the static filesystem state of `~/.claude/` —
which carries no "when was this created?" metadata. Each detector stamps
`firstSeenAt` at the moment the scorer first observes the signal and writes
that timestamp to `app/data/progression-config.json`, where it is frozen
permanently.

**First-run behavior (by design):** If you have already satisfied all 8 config
signals when you first run `npm run assess`, every config milestone gets
`firstSeenAt = <first-run timestamp>`. On an initial install from May 9, all 8
entries share the identical timestamp `2026-05-09T08:37:16.111Z`. This is
intentional. The scorer deliberately does not back-date from file mtimes or git
history — that approach is fragile and lossy, and the tradeoff is documented
in `CLAUDE.md`. A frozen cluster at your first-run date is the expected shape
for a well-configured machine.

## Coverage gap

The milestone catalog only covers 8 of the 12 scored dimensions:

| Covered | Not covered |
|---|---|
| `automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning` | `scheduled`, `remote`, `verification` |

Real adoption in the three uncovered dimensions produces no milestone entry.
If you use `scheduled` work, remote/mobile access, or verification workflows
heavily, the timeline will appear to have no activity for those areas — not
because the usage isn't happening, but because no detector exists yet. Adding
telemetry-dated detectors for those three dimensions is tracked as **CCE-33**.

## Reading a "frozen" timeline

If your progression timeline looks static past an early date, check these
causes in order:

1. **Config-milestone saturation**: you satisfied all config signals before the
   first run. The cluster of identical timestamps is expected; it is not
   indicative of a bug. New config milestones only appear when you add a signal
   that wasn't previously observed (e.g., authoring a new agent or enabling a
   hook).

2. **Telemetry coverage gap**: activity in `scheduled`, `remote`, or
   `verification` dimensions isn't yet detected. Heavy real usage there
   produces no timeline entry (CCE-33).

3. **Lookback mismatch**: `--progression-lookback` defaults to `null`
   (all history), so telemetry milestones should reach back to your earliest
   sessions. If old dates are missing, confirm that
   `~/.claude/usage-data/session-meta/` has been seeded by running `/insights`
   at least once.

## Files involved

| File | Role |
|---|---|
| `scripts/progression.mjs` | 9 telemetry-milestone detectors; self-dates from session `start_time` |
| `scripts/config-progression.mjs` | 8 config-milestone detectors; stamps `firstSeenAt` on first observation |
| `app/data/progression.json` | Merged output; rewritten on every `npm run assess` |
| `app/data/progression-config.json` | Frozen config timestamps; persists `firstSeenAt` across runs |
| `app/progression/page.tsx` | Renders `progression.json` via `loadProgression`; not sourced from `/insights` history |

## See also

- `CLAUDE.md` — "The `/progression` timeline has two milestone sources" Conventions entry (the authoritative annotation for this design)
- `CCE-33` — backlog ticket to add telemetry-dated detectors for `scheduled`, `remote`, and `verification`
- `docs/site-src/self-assessment.md` — `--progression-lookback` flag reference
