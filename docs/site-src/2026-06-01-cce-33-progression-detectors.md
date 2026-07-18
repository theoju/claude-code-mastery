---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# CCE-33: scheduled / remote / verification progression detectors

`/progression` walks your session history and reports the first time you
adopted a workflow pattern — first subagent dispatch, first plan-mode
session, first worktree, and so on. Until PR #108 (CCE-33), that catalog
covered 8 of the 12 scored dimensions. `scheduled`, `remote`, and
`verification` had **no detector at all**, so heavy real usage in those
three areas produced no dated milestone and the timeline looked frozen
past the first-run wall even for users actively running `/loop` or `/go`
every day. PR #108 closes the gap: `scripts/progression.mjs` now ships
12 detectors, and all 12 scored dimensions have telemetry-dated coverage.

## What changed

Three new detector records were appended to the `DETECTORS` array in
`scripts/progression.mjs`, matching the existing detector shape exactly
— `{ transcriptsRequired, detect(sessions, facets, transcripts, ctx) }`.
`detectMilestones` already loops over this array, skips
`transcriptsRequired: true` records when transcripts weren't scanned, and
collects the first non-null result per detector — so wiring in three more
records required no change to the walking logic itself.

| Dimension | Milestone | Boris tip | Signal source |
| --- | --- | --- | --- |
| `scheduled` | "Started using scheduled workflows" | 48 | Transcript: first session invoking `/loop`, `/schedule`, or `/babysit` |
| `remote` | "First remote-tool invocation" | 35 | Session-meta: first `tool_counts.RemoteTrigger`, `.PushNotification`, or `.SendMessage` fire |
| `verification` | "First /go composite invocation" | 73 | Transcript: first session invoking `/go` |

A supporting change makes the `scheduled` and `verification` detectors
possible: `scanTranscriptModes` in `scripts/_usage-data.mjs` now tracks a
per-session `commands: Set<string>` field, built off the same
`<command-name>` scan the function already runs for mode detection. It's
a five-line addition riding along on an existing pass over the transcript
— no extra I/O.

## Why command-first for `scheduled`, tool-first for `remote`

The two new transcript-independent choices aren't arbitrary — they follow
from what each milestone is actually claiming happened:

- **`scheduled` is command-first (transcripts required).** The milestone
  semantics are "the user adopted autonomous scheduling," which is a
  *user* action — the slash command they typed. `CronCreate` /
  `ScheduleWakeup` tool fires are Claude's downstream consequence of that
  reflex, not the reflex itself, so the detector only credits the
  session where `/loop`, `/schedule`, or `/babysit` actually appears in
  the transcript.
- **`remote` is tool-first (facets-only, no transcript scan needed).**
  `RemoteTrigger`, `PushNotification`, and `SendMessage` are tools *Claude*
  fires — an external entity triggering a session, Claude pinging the
  user, Claude dispatching a message — and they land directly in
  `session-meta/*.json::tool_counts`. There's no user-typed command to
  wait for, so the detector reads session-meta the same way the
  `parallel` and `integrations` detectors already do.
- **`verification` cites tip 73, not tip 14.** Tip 14 ("Verification —
  The #1 Tip") is the foundational post-work review ritual, but `/go` (tip
  73) is the composite skill that operationalizes it — run tests, verify
  with subagents, review code, simplify. The detector cites the specific
  tip the user *did*, matching the existing cadence (e.g. the MCP
  detector cites tip 9 specifically, not a broader "integrations"
  concept tip).

Each detector fires once, on the earliest matching session in the walked
range, and is null-safe throughout — `transcripts.get(sid)?.commands`,
`tool_counts?.[tool] ?? 0` — the same defensive pattern the other nine
detectors already use.

## What this doesn't change

- **No UI changes.** `app/progression/page.tsx` reads
  `app/data/progression.json.milestones` and renders whatever shape it's
  given; the new detectors produce the same
  `{timestamp, dimension, milestone, borisTip, evidence, sessionId}`
  record the other nine already emit, so the new milestones drop straight
  into the existing timeline.
- **No back-dating of config milestones.** The `scripts/config-progression.mjs`
  catalog (8 detectors, `firstSeenAt` frozen at first observation) is a
  separate, deliberately non-back-dated source — untouched by this PR.
- **One detector per dimension.** Sub-feature breakdowns (`/loop` vs
  `/schedule` vs `/babysit` as distinct milestones; Chrome control vs
  claude.ai web vs iOS for `remote`) were explicitly out of scope for this
  pass.

## Where the milestones actually land

Because these detectors are telemetry-dated — self-dated from session
`start_time`, walked over full history via `--progression-lookback`
(independent of `--insights-lookback`) — a user who first ran `/loop` on
2026-04-25 sees that milestone appear at its true date once this ships,
not on the day the detector merged. That matters for the timeline's
honesty: the frozen-looking `/progression` page pre-PR #108 wasn't lying
about inactivity in `scheduled`/`remote`/`verification` — it simply had
no way to see it.

Test coverage lives in `scripts/__tests__/progression.test.mjs`: one
fixture-backed test per new detector, plus a regression check that the
original nine detectors still fire correctly now that
`scanTranscriptModes`'s return shape carries the additional `commands`
field. As with every probe-catalog change, this PR also updated
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` in
the same commit — three new Part 1 registry rows and updated Part 2
coverage for Boris tips 35, 48, and 73.
