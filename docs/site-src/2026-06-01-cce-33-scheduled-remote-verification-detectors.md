---
title: "CCE-33: progression detectors for scheduled, remote, and verification"
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: decision
---

# CCE-33: progression detectors for scheduled, remote, and verification

`scripts/progression.mjs` walks `~/.claude/usage-data/` in chronological order
and emits milestones — first time you adopted a workflow pattern, self-dated
from the session's `start_time` — for the `/progression` timeline. Before
PR #108 the detector catalog covered 8 of the 12 scored dashboard dimensions
(`automation`, `integrations`, `learning`, `memory`, `model-effort`,
`parallel`, `permissions`, `planning`). `scheduled`, `remote`, and
`verification` had no detector at all, so real usage in those three
dimensions produced no milestone — the timeline just looked frozen past the
first-run wall, exactly the coverage gap CCE-33 tracked. This PR adds the
missing three.

## What changed

Three new records were appended to the `DETECTORS` array in
`scripts/progression.mjs`, matching the existing shape exactly —
`{ transcriptsRequired, detect(sessions, facets, transcripts, ctx) }`:

| Dimension      | `transcriptsRequired` | Fires on                                                  | Boris tip |
| -------------- | :--------------------: | ---------------------------------------------------------- | :-------: |
| `scheduled`    | `true`                  | First session whose transcript `commands` set contains `loop`, `schedule`, or `babysit` | 48        |
| `remote`       | `false`                 | First session-meta record whose `tool_counts` has a nonzero `RemoteTrigger`, `PushNotification`, or `SendMessage` | 35        |
| `verification` | `true`                  | First session whose transcript `commands` set contains `go`                              | 73        |

Each detector returns the same milestone shape as the other nine:
`{timestamp, dimension, milestone, borisTip, evidence, sessionId}`. Because
`app/progression/page.tsx` renders `app/data/progression.json.milestones`
generically, no UI changes were needed — the new milestones drop straight
into the existing rendering pipeline.

**`scheduled` and `verification` are command-first, not tool-first, by
design.** The milestone semantics are "the user adopted a workflow reflex" —
a user action, not a downstream tool fire. `CronCreate` / `ScheduleWakeup`
fire as a *consequence* of `/loop` or `/schedule`, not as the reflex itself,
so the detector looks for the slash command in the transcript rather than
the tool call in session-meta. `remote` goes the other way: `RemoteTrigger`,
`PushNotification`, and `SendMessage` are tools Claude fires (an external
trigger arrived, a push notification went out, a message got sent) and
they're already present in `session-meta/*.json::tool_counts` — no
transcript scan required, so that detector runs even without
`--include-transcripts`.

**Why `/go` for `verification`, not tip 14.** Boris tip 14 ("Verification —
The #1 Tip") is the general post-work review ritual, but `/go` (tip 73, the
composite skill that runs tests, dispatches verification subagents, reviews
code, and simplifies) is the specific, detectable action the user takes to
enact it. That matches how the other detectors cite tips — e.g. "First
MCP-powered session" cites tip 9 specifically rather than a broader
umbrella concept.

**Why tip 35 for `remote`**, even though the rubric maps the `remote`
dimension to tips `[35, 44, 46, 47, 50]`: the three tools each serve a
different sub-feature (cowork dispatch, mobile push, iMessage), and the
detector fires on any of them without distinguishing which. Tip 35 ("Remote
Control") is the umbrella tip that covers all three, so it's the cleanest
single citation for a detector that doesn't discriminate sub-features. A
future per-tool breakdown was explicitly scoped out.

## Supporting change: `commands` on `scanTranscriptModes`

Both `scheduled` and `verification` need to know *which* slash command
fired in a given session, which the existing per-session transcript scan
didn't expose. `scanTranscriptModes` in `scripts/_usage-data.mjs` already
walked every transcript line looking for `<command-name>` markup to detect
mode-equivalent skills (`plan`, `learning`); the change adds a `commands:
Set<string>` accumulator to the same loop and returns it alongside the
existing `modes`, `skills`, `hasWorktreeState`, `learningModeMatches`,
`assistantTurns`, `opusAssistantTurns`, and `entrypoint` fields. It's the
same scan pass — no extra I/O, no new transcript read.

## Data flow

```
session-meta/*.json + projects/*/*.jsonl
        │
        ▼
loadSessionMeta + scanTranscriptModes (now also emits commands: Set<string>)
        │
        ▼
detectMilestones — 12 detectors (9 existing + 3 new)
        │
        ▼
app/data/progression.json.milestones
        │
        ▼
app/progression/page.tsx — renders unchanged
```

`detectMilestones` sorts all sessions by `start_time` (tie-broken by
`session_id` for determinism), builds a transcript scan map only when
`--include-transcripts` is on, then loops the detector array once, skipping
`transcriptsRequired: true` records when transcripts weren't scanned. All
three new detectors go through this same loop — no special-casing.

## Tests

`scripts/__tests__/progression.test.mjs` adds one test per new detector
(fixture with a non-matching earlier session and a matching later one,
asserting the milestone timestamp and evidence text point at the *matching*
session, not an earlier tool-fire-only one) plus a regression pass
confirming the existing 9 detectors still fire against their existing
fixtures — the risk being that adding `commands` to
`scanTranscriptModes`'s return shape could break a test asserting the
object's exact key set.

## Coverage gap closed, saturation gap not

This PR closes the *detector-coverage* gap: all 12 scored dimensions now
have a progression detector. It does **not** address the separate
*saturation* behavior noted in project memory — telemetry-dated "first"
milestones are one-time events by nature, so a timeline that looks frozen
after all firsts have fired is expected, not a bug. What was a bug is the
three dimensions that could *never* produce a milestone regardless of
usage; that's what's fixed here.

## Probe-tracker update

Per the CLAUDE.md rule that probe changes must update the tracker in the
same PR, `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
got three new Part 1 registry rows under the progression-detector layer
(one per new detector) and Part 2 coverage updates for Boris tips 35, 48,
and 73 to reflect that progression-detector coverage now exists for them.
Header counts were re-derived rather than hand-edited, per the same rule —
they're machine-enforced by `scripts/__tests__/tracker-counts.test.mjs`.
