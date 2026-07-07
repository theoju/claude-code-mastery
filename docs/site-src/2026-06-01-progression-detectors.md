---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# Progression detectors: closing the scheduled / remote / verification gap

`scripts/progression.mjs` walks `~/.claude/usage-data/session-meta` (plus,
optionally, raw transcripts) in chronological order and emits a flat array of
milestone events — first time you adopted a workflow pattern, last time you
used a deprecated one — for the `/progression` timeline. Before PR #108, the
detector catalog covered only 8 of the 12 scored dimensions: `automation`,
`integrations`, `learning`, `memory`, `model-effort`, `parallel`,
`permissions`, `planning`. `scheduled`, `remote`, and `verification` had no
detector at all, so heavy real usage in those three areas produced nothing on
the timeline — it looked frozen past the first-run wall even for users
actively running `/loop`, dispatching remote sessions, or reflexively closing
prompts with `/go`. This was tracked as CCE-33.

PR #108 adds three telemetry-dated detectors — one per missing dimension —
bringing `DETECTORS` in `scripts/progression.mjs` from 9 to 12 entries. Each
new record matches the existing shape exactly:

```js
{
  transcriptsRequired: boolean,
  detect(sessions, facets, transcripts, ctx) -> milestone | null
}
```

`detectMilestones` loops the array, skips any `transcriptsRequired: true`
record when transcripts weren't scanned (`--include-transcripts` off), calls
`detect()`, and collects non-null results. No changes were needed to
`app/progression/page.tsx` — it consumes the `{timestamp, dimension,
milestone, borisTip, evidence, sessionId}` shape uniformly, and the new
milestones drop straight into that pipeline.

## The three new detectors

**`scheduled`** — fires on the first session whose transcript contains
`/loop`, `/schedule`, or `/babysit`. This is deliberately command-first, not
tool-first: the milestone semantics are "the user adopted autonomous
scheduling," which is a user action (the slash command they typed), not
Claude's downstream `CronCreate` / `ScheduleWakeup` tool fires that follow as
a consequence. Cites Boris tip 48.

**`remote`** — fires on the first session where `tool_counts` shows a nonzero
`RemoteTrigger`, `PushNotification`, or `SendMessage` count. Unlike
`scheduled`, this one is `transcriptsRequired: false` — all three signals are
tools Claude itself fires (external trigger, mobile push, iMessage/email
dispatch) and they're already present in `session-meta/*.json::tool_counts`,
so no transcript scan is needed. Cites Boris tip 35 (the umbrella "Remote
Control" tip), even though the rubric maps `remote` to tips `[35, 44, 46, 47,
50]` — a future per-sub-feature breakdown is out of scope here.

**`verification`** — fires on the first session whose transcript invokes
`/go`. Boris tip 14 ("Verification — The #1 Tip") is the underlying ritual,
but the detector cites tip 73 (`/go composite skill`) because that's the
concrete action the user took, matching the citation style of the existing
detectors (e.g. the MCP detector cites tip 9 specifically, not a broader
concept tip).

All three detectors are added as new elements in the `DETECTORS` array in
`scripts/progression.mjs` — `scheduled` and `verification` are
`transcriptsRequired: true`, `remote` is `transcriptsRequired: false`.

## Supporting change: `commands` on `scanTranscriptModes`

`scheduled` and `verification` both need to know which slash commands a
session's transcript contains. `scanTranscriptModes` in
`scripts/_usage-data.mjs` already scans every line for `<command-name>`
markup (to detect skill-equivalent plan/learning modes); PR #108 adds a
`commands: Set<string>` field to its return value, populated in the same
loop, at essentially no extra I/O cost:

```js
if (raw.includes("<command-name>")) {
  for (const m of raw.matchAll(COMMAND_NAME_RE)) {
    const cmd = m[1];
    commands.add(cmd);
    if (PLANNING_SKILL_COMMANDS.has(cmd)) modes.add("plan");
    if (LEARNING_SKILL_COMMANDS.has(cmd)) modes.add("learning");
  }
}
```

The returned object now includes `commands` alongside `modes`,
`hasWorktreeState`, `hasAiTitle`, `skills`, `learningModeMatches`,
`assistantTurns`, `opusAssistantTurns`, and `entrypoint`. Note this is a
distinct, session-scoped view from `scanTranscriptInvocations`'s
aggregate-across-all-sessions command counters used for scoring — both scans
already walk the same transcripts, so exposing the per-session set here adds
no duplicate work.

## Data flow

```
session-meta/*.json + transcripts/*.jsonl
        │
        ▼
loadSessionMeta + scanTranscriptModes (now also emits commands: Set<string>)
        │
        ▼
detectMilestones (12 detectors: 9 existing + 3 new)
        │
        ▼
app/data/progression.json.milestones
        │
        ▼
app/progression/page.tsx — renders unchanged
```

## Tests

`scripts/__tests__/progression.test.mjs` adds one test per new detector (each
asserting the milestone dates to the correct session's `start_time` and
carries the right evidence string) plus a regression check that the existing
9 detectors still fire against their existing fixtures — guarding against the
`scanTranscriptModes` return-shape change breaking any test that asserts an
exact key set.

## What this doesn't change

- Still one broad detector per dimension — no sub-feature breakdown (Chrome
  control vs. claude.ai web vs. iOS vs. GitHub Actions for `remote`; `/loop`
  vs. `/schedule` vs. `/babysit` as distinct milestones for `scheduled`).
- Config-milestone back-dating is unaffected — that freeze-at-first-run
  behavior in `scripts/config-progression.mjs` remains by design.
- `/ship`'s verify-agent stage still isn't a separate verification milestone;
  `verification` coverage here is scoped to `/go` only.

Per project convention, this PR also syncs
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — new
Part 1 registry rows for the three detectors under the Progression layer, and
updated Part 2 coverage rows for Boris tips 35, 48, and 73.
