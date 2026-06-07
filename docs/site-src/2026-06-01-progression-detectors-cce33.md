---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# Progression timeline — CCE-33 detector coverage (PR #108)

The `/progression` timeline page (`app/progression/page.tsx`) reads
`app/data/progression.json`, which is rewritten on every `npm run assess`. That
file is produced by two milestone walkers:

- **Telemetry milestones** (`scripts/progression.mjs`) — dated from session
  `start_time` over full history.
- **Config milestones** (`scripts/config-progression.mjs`) — dated from the
  first `npm run assess` run that observed each signal.

Before PR #108, `scripts/progression.mjs` covered only 9 of 12 scored
dimensions. The three missing ones — `scheduled`, `remote`, and `verification`
— had no detectors, so real usage in those areas produced no timeline entry and
the progression page appeared frozen past the first-run wall. CCE-33 tracked
the gap.

## What PR #108 adds

Three new telemetry-dated milestone detectors in `scripts/progression.mjs`:

| Detector | Fires when |
| --- | --- |
| `scheduled` | A `/loop`, `/schedule`, or `/batch` command invocation is found in session transcripts |
| `remote` | A `/go` or `/babysit` invocation is found (autonomous, non-interactive orchestration) |
| `verification` | A multi-step verification sequence is detected in session output — test-run + review step |

Each detector self-dates from the earliest matching session's `start_time`,
consistent with the existing detectors for `learning`, `parallel`, `planning`,
and so on.

### `scanTranscriptModes` extension

To give the new detectors the input they need, `scripts/_usage-data.mjs::scanTranscriptModes`
now returns a per-session `commands: Set<string>` field alongside the existing
`modes` set. Each entry in the set is a command slug (e.g. `"loop"`, `"go"`,
`"babysit"`). Detectors that only care about command presence check
`session.commands.has(slug)` rather than re-scanning message bodies themselves.

The `commands` set is populated only for sessions where `classifySessionKind`
returns `interactive_cli` or `"unknown"` for posture commands
(`POSTURE_COMMANDS`), and across all session kinds for volume commands
(`VOLUME_COMMANDS`) — consistent with the partition enforced by
`assertCommandPartition` at module load.

## Effect on the timeline

After running `npm run assess` with `--include-transcripts`, any session that
used `/loop`, `/schedule`, `/batch`, `/go`, or `/babysit` will now generate a
milestone entry dated to that session. The "frozen past first-run" appearance
for heavy users of scheduled and remote workflows is resolved.

The three remaining dimensions without coverage (`scheduled`, `remote`,
`verification`) all now have detectors. All 12 scored dimensions have at least
one milestone path.

## Tests

`scripts/__tests__/progression.test.mjs` covers the three new detectors with
fixture-fed session data — one test per detector for the happy path (milestone
fires at the correct date) and one for the case where no matching session exists
(no milestone emitted).

## What hasn't changed

- Config milestones (`scripts/config-progression.mjs`) are unchanged — they
  cover 8 dimensions and first-stamp from the run that observed each signal.
- The first-run caveat is unchanged: already-satisfied config signals all share
  the same `firstSeenAt` timestamp (the date of the dashboard's first
  `npm run assess` run) rather than their true adoption dates.
- The `--progression-lookback` flag (default `null` = full history) is
  independent of `--insights-lookback` (default 30 days). Telemetry milestones
  scan full history by design, which is why April dates can appear under a
  30-day scoring window.
- The `/progression` page itself (`app/progression/page.tsx`) is unchanged —
  it renders whatever `app/data/progression.json` contains.
