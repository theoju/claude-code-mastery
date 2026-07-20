---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# Progression detectors: closing the scheduled / remote / verification gap

`scripts/progression.mjs` walks session history and emits telemetry-dated
milestones — first time you adopted a workflow pattern — for the `/progression`
timeline. Until PR #108 (CCE-33), that walk only covered 8 of the 12 scored
dimensions: `automation`, `integrations`, `learning`, `memory`, `model-effort`,
`parallel`, `permissions`, `planning`. `scheduled`, `remote`, and `verification`
had no detector at all, so real usage in those areas never produced a
milestone and the timeline looked frozen past the first-run wall — even for
users actively running `/loop` sessions or firing remote tools. PR #108 adds
the three missing detectors, closing the coverage gap to all 12 dimensions.

## The three new detectors

All three live in the `DETECTORS` array in `scripts/progression.mjs`, matching
the shape every existing detector already uses:
`{ transcriptsRequired: boolean, detect(sessions, facets, transcripts, ctx) }`.
`detectMilestones` skips a `transcriptsRequired: true` record when transcripts
weren't scanned (i.e. `--include-transcripts` was off) and otherwise collects
whatever non-null milestone each detector's `detect()` returns.

### `scheduled` — first `/loop`, `/schedule`, or `/babysit`

```js
{
  transcriptsRequired: true,
  detect(sessions, _facets, transcripts) {
    const scheduledCommands = ["loop", "schedule", "babysit"];
    const m = sessions.find((s) => {
      const cmds = transcripts.get(s.session_id)?.commands;
      return cmds && scheduledCommands.some((c) => cmds.has(c));
    });
    if (!m) return null;
    const cmds = transcripts.get(m.session_id).commands;
    const cmd = scheduledCommands.find((c) => cmds.has(c));
    return {
      timestamp: m.start_time,
      dimension: "scheduled",
      milestone: "Started using scheduled workflows",
      borisTip: 48,
      evidence: `First session invoking /${cmd}`,
      sessionId: m.session_id,
    };
  },
}
```

This fires on the command, not on the tool. `CronCreate` / `ScheduleWakeup`
are Claude's downstream tool calls — a consequence of the user reflex, not
the reflex itself. The milestone is meant to date "user adopted autonomous
scheduling," so it has to key off the slash command the user typed.

### `remote` — first `RemoteTrigger`, `PushNotification`, or `SendMessage`

```js
{
  transcriptsRequired: false,
  detect(sessions) {
    const remoteTools = ["RemoteTrigger", "PushNotification", "SendMessage"];
    const m = sessions.find((s) =>
      remoteTools.some((t) => (s.tool_counts?.[t] ?? 0) > 0),
    );
    if (!m) return null;
    const tool = remoteTools.find((t) => (m.tool_counts?.[t] ?? 0) > 0);
    const count = m.tool_counts[tool];
    return {
      timestamp: m.start_time,
      dimension: "remote",
      milestone: "First remote-tool invocation",
      borisTip: 35,
      evidence: `First session firing ${tool} (${count} call${count === 1 ? "" : "s"})`,
      sessionId: m.session_id,
    };
  },
}
```

Unlike `scheduled`, this one doesn't need `--include-transcripts` at all —
`RemoteTrigger`, `PushNotification`, and `SendMessage` are tools Claude fires
(cowork dispatch, mobile push, iMessage/email), and they already land in
`tool_counts` on the raw `session-meta/*.json` records. Cites Boris tip 35
("Remote Control") as the umbrella tip covering all three sub-features rather
than splitting per-tool.

### `verification` — first `/go`

```js
{
  transcriptsRequired: true,
  detect(sessions, _facets, transcripts) {
    const m = sessions.find((s) =>
      transcripts.get(s.session_id)?.commands?.has("go"),
    );
    if (!m) return null;
    return {
      timestamp: m.start_time,
      dimension: "verification",
      milestone: "First /go composite invocation",
      borisTip: 73,
      evidence: "First session invoking /go (the post-work review reflex)",
      sessionId: m.session_id,
    };
  },
}
```

Tip 14 ("Verification — The #1 Tip") is the umbrella concept, but the
detector cites tip 73 ("/go composite skill") because that's the concrete
thing the user did — matching the existing convention where, e.g., the MCP
milestone cites tip 9 rather than a broader integrations tip.

## Supporting change: per-session command tracking

None of the new detectors could work without knowing which slash commands
fired inside a given session, so `scanTranscriptModes` in
`scripts/_usage-data.mjs` now returns a `commands: Set<string>` field
alongside `modes`, `skills`, and the rest — populated from the same
`<command-name>` scan the function already runs for mode detection, at
essentially no extra I/O cost. `scheduled` and `verification` both read this
field; `remote` doesn't need it since it reads `tool_counts` directly.

## Why the timeline looked frozen before this

Per-dimension milestones are one-time first-adoption events, so a user whose
config and habits were set early on will naturally see most of their
telemetry-dated milestones cluster near the start of their history — that
part is expected. What wasn't expected was that three dimensions could never
produce a milestone no matter how much a user relied on them, because no
detector existed to notice. That's the specific gap PR #108 closes: it
doesn't change how "stopped" or saturation works, it just gives `scheduled`,
`remote`, and `verification` the same first-occurrence detection the other
nine dimensions already had.

## Backdating, not backfilling from today

Like every other detector in the file, the three new ones are **telemetry-dated**
from `start_time` over full session history (`--progression-lookback`,
independent of `--insights-lookback`). A user who first ran `/babysit` back
on 2026-04-25 sees that milestone appear at its true date once this ships —
not on the day the detector code landed. This is the same self-dating
discipline the existing nine detectors use, and it's why the `/progression`
page doesn't need any UI changes to pick these up: it already renders
whatever `progression.json.milestones` contains, keyed by real timestamp.

## Tests and the probe tracker

`scripts/__tests__/progression.test.mjs` gained one test per new detector
(first-occurrence detection, and a no-false-positive check when the signal
is absent) plus a regression pass confirming the existing nine detectors
still fire correctly against their fixtures — guarding against the
`commands` Set changing `scanTranscriptModes`'s return shape underneath
anything that asserts its exact keys.

Per the repo's hard rule on probe changes, the same PR also updated
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`: three new
Part 1 registry rows under the progression-detector layer, and Part 2
tip-coverage rows for Boris tips 35, 48, and 73 reflecting that
progression-detector coverage now exists for those tips. Header counts were
re-derived, not hand-typed, since they're machine-enforced by
`scripts/__tests__/tracker-counts.test.mjs`.

## Notes for future readers

The design doc backing this PR
(`docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md`)
explicitly scoped out a few extensions worth remembering if you're tempted to
add them casually: no per-sub-feature breakdown (Chrome control vs. claude.ai
web vs. iOS vs. GitHub Actions for `remote`; `/loop` vs. `/schedule` vs.
`/babysit` as distinct milestones for `scheduled`), and no `/ship`
verify-agent milestone for `verification` — `/ship` is a composite across
multiple dimensions and would be ambiguous as a single-dimension milestone.
