---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33: Progression Timeline — Scheduled, Remote & Verification Detectors

**PR #108 · 2026-06-01**

Closes the `/progression` timeline coverage gap (CCE-33) by adding three
telemetry-dated milestone detectors to `scripts/progression.mjs`. The
catalog now covers **11 of 12 scored dimensions**, up from 8.

## The gap this closes

`app/progression/page.tsx` renders milestones from two sources: telemetry
detectors in `scripts/progression.mjs` (self-dated from session
`start_time` over full history) and config detectors in
`scripts/config-progression.mjs` (stamped on first observation).

Before this PR, three dimensions — `scheduled`, `remote`, and
`verification` — had no detectors at all. Users with real activity in
those areas saw no milestones; the timeline appeared frozen past the
first-run wall. The gap was documented in `CLAUDE.md`'s progression
timeline convention block and filed as CCE-33 (feature work; design
before implementing).

## New detectors

| Detector | Boris tip | Fires on | Signal source |
| --- | --- | --- | --- |
| `scheduled` | 48 | First `/loop`, `/schedule`, or `/babysit` invocation | Transcript scan |
| `remote` | 35 | First `RemoteTrigger`, `PushNotification`, or `SendMessage` tool call | Transcript scan |
| `verification` | 73 | First `/go` invocation | Transcript scan |

All three are **telemetry-dated**: the milestone timestamp is pulled
from the session's `start_time`, so backdated activity surfaces at its
real date — not the date you first ran `npm run assess` (that's the
first-run caveat that applies only to config milestones).

Live verification confirmed all three fire correctly:

- `scheduled` → 2026-04-29
- `remote` → 2026-04-15
- `verification` → 2026-05-26

## Implementation notes

`scripts/_usage-data.mjs::scanTranscriptModes` was extended with a
per-session `commands` Set to support the two transcript-dependent
detectors (`scheduled` and `verification`). Each session's command
invocations are collected into the Set before the milestone walker
checks them; this avoids double-counting across repeated tool calls
within a single session.

The `remote` detector reads tool-call names directly from the session's
assistant turns rather than the commands Set — `RemoteTrigger`,
`PushNotification`, and `SendMessage` are tool names, not slash
commands.

## What's not changed

The five machine-enforced probe-tracker header counts
(`75 tips / 12 dims / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys`)
are **unchanged**. These detectors are purely telemetry milestone
walkers — no new `satisfiedWhen` predicates, no new `probe-catalog.json`
entries, no new `signalsSummary` keys.

The **twelfth dimension** (`model-effort`) still has no progression
detector and is not addressed here. Adding it is the natural next step
if a reliable transcript signal for Opus usage or effort-level changes
can be identified.

## Files changed

- `scripts/progression.mjs` — three new detector functions
- `scripts/_usage-data.mjs` — per-session `commands` Set in `scanTranscriptModes`
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — new Progression layer section
- Design spec and implementation plan shipped alongside the PR
