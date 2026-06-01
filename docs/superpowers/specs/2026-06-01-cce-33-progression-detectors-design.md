---
status: shipped
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33: Progression milestone detectors for scheduled / remote / verification

**Status:** Implementation complete — shipped in PR #108 (2026-06-01)
**Ticket:** [CCE-33](https://designitright.atlassian.net/browse/CCE-33)
**Related cycles:** v0.9.7 (`/progression` page split-out), v0.9.16 (runtime-adoption probes)

## Goal

Extend `scripts/progression.mjs` with three new telemetry-dated milestone detectors so the `/progression` timeline covers all 12 scored dimensions. Today the catalog tracks 8 of 12 (`automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning`); `scheduled`, `remote`, and `verification` have **no detector**, so heavy real usage in those areas produces no milestone and the timeline appears frozen past the 2026-05-09 tracking-start wall.

The new detectors are **telemetry-dated** — self-dated from session `start_time` over full history — so they back-date adopted features to their true first-occurrence dates rather than stamping them at first-run-after-merge. A user who first invoked `/loop` on 2026-04-25 will see that milestone appear at its real date once this lands, not on the day the detector shipped.

## Context

`/progression` (rendered from `app/data/progression.json`, regenerated on every `npm run assess`) merges two milestone sources:

- **`scripts/progression.mjs`** — 9 telemetry detectors, self-dated from session `start_time`, full history (uses `--progression-lookback`, default `null`; independent of `--insights-lookback`).
- **`scripts/config-progression.mjs`** — 8 config detectors, stateful; `firstSeenAt` frozen at first observation in `app/data/progression-config.json` (the documented first-run caveat — does not back-date from mtimes, deliberately).

Per CLAUDE.md the timeline has shown no new milestones since 2026-05-09: all 9 telemetry firsts saturated by 2026-04-26, all 8 config firsts share `2026-05-09T08:37:16.111Z` (the dashboard's first run). The frozen appearance is **partly expected** (one-time first-adoption events) but **partly a real coverage gap** — three dimensions have no detector at all. This work closes the coverage gap; the saturation half is by design.

## Architecture

Three new detector records appended to `scripts/progression.mjs::DETECTORS` (currently a 9-element array at lines 36-190). Each record matches the existing shape exactly:

```js
{
  transcriptsRequired: boolean,
  detect(sessions, facets, transcripts, ctx) -> milestone | null
}
```

`detectMilestones` loops over the array, skips records whose `transcriptsRequired` is true when `transcripts` is null (i.e., `--include-transcripts` was off), invokes `detect()`, and collects non-null results. The page renderer (`app/progression/page.tsx` via `app/data/progression.json`) consumes the result shape uniformly, so **no UI changes are required** — the new milestones drop in through the existing pipeline.

One supporting change: extend `scanTranscriptModes` in `scripts/_usage-data.mjs` (line 428-496) to track slash-command names per session as a `commands: Set<string>` field. The function already scans transcript lines for `<command-name>` tags during mode detection (line 478-484); this is a ~5-line addition piggybacking on the existing scan loop, no extra I/O.

## Per-detector spec

### Detector 1 — `scheduled`

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
},
```

**Why command-first (transcripts-required), not tool-first (facets-only):** the milestone semantics are "user adopted autonomous scheduling," which is a _user_ action (the slash command they typed). `CronCreate` / `ScheduleWakeup` are Claude's _downstream_ tool fires — they fire as a consequence of the user's reflex, not as the reflex itself. The user always runs `npm run assess` with `--include-transcripts` (per the SKILL.md command), so transcripts are de facto always available; this is consistent with five existing detectors that are also transcripts-required.

### Detector 2 — `remote`

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
},
```

**Why facets-only:** all three remote signals are _tools_ fired by Claude (`RemoteTrigger` when an external entity triggers a session, `PushNotification` when Claude pings the user, `SendMessage` when Claude dispatches via iMessage/email/etc.). They appear in `session-meta/*.json::tool_counts` directly — no transcript scan needed. Empirically verified: `tool_counts.RemoteTrigger` and `tool_counts.PushNotification` populate on real session-meta files in `~/.claude/usage-data/` (multiple sessions observed during design audit).

**Why tip 35:** the rubric maps `remote` to tips `[35, 44, 46, 47, 50]` — `RemoteTrigger`/`PushNotification`/`SendMessage` each serve a different sub-feature (cowork dispatch, mobile push, iMessage), and the detector fires on any of them. Tip 35 ("Remote Control") is the umbrella that the three tools collectively serve, so it's the cleanest single citation. A future expansion to per-sub-feature detectors (out of scope here) would cite tip 50 / 46 / 44 individually.

### Detector 3 — `verification`

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
},
```

**Why /go is the right signal:** Boris tip 14 ("Verification — The #1 Tip") is the foundational post-work review ritual, but the actionable signal the user adopts is **tip 73 ("/go composite skill")** — `/go` is the command that operationalizes the ritual (run tests, verify with subagents, review code, simplify). Cite tip 73 because it's the specific tip the user "did," matching the existing detector cadence (e.g., "First MCP-powered session" cites tip 9 "MCP Servers" specifically, not a broader concept tip). `goCommandUses` is already collected by `scanTranscriptInvocations` for the existing verification scorer (`scripts/score.mjs`); we just need the _first_ occurrence, dated, which requires the per-session `commands` Set added to `scanTranscriptModes`.

## Supporting change: `scanTranscriptModes`

Extend the function in `scripts/_usage-data.mjs:428` to track slash-command names per session:

```js
// Inside scanTranscriptModes — add `commands` to the locals:
const commands = new Set();

// Inside the for-await loop, alongside the existing <command-name> scan
// at line 478-484, also collect bare command names:
if (raw.includes("<command-name>")) {
  for (const m of raw.matchAll(COMMAND_NAME_RE)) {
    const cmd = m[1];
    commands.add(cmd);
    if (PLANNING_SKILL_COMMANDS.has(cmd)) modes.add("plan");
    if (LEARNING_SKILL_COMMANDS.has(cmd)) modes.add("learning");
  }
}

// And in the return object, add the new field:
return {
  modes,
  hasWorktreeState,
  hasAiTitle,
  skills,
  commands, // <-- new
  learningModeMatches,
  assistantTurns,
  opusAssistantTurns,
  entrypoint,
};
```

Total addition: ~5 lines. Mirrors the existing skill-tracking pattern.

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

The page renderer's input contract is the `{timestamp, dimension, milestone, borisTip, evidence, sessionId}` shape per milestone — already produced by the existing detectors and reused verbatim.

## Tests

New tests in `scripts/__tests__/progression.test.mjs` (confirmed to exist; sibling file `scripts/__tests__/config-progression.test.mjs` covers the config detectors separately). One per detector plus one regression:

1. **scheduled**: Fixture of 3 sessions — second has `/babysit` in transcript, third has `CronCreate` but no command. Assert detector returns a milestone dated at session #2's `start_time` and evidence mentions `/babysit` (not session #3's tool fire — milestone is user-action by design).
2. **remote**: Fixture of 2 sessions — second has `tool_counts.PushNotification: 2`. Assert milestone dated at session #2 with evidence `"First session firing PushNotification (2 calls)"`.
3. **verification**: Fixture of 2 sessions — second has `/go` in transcript. Assert milestone dated at session #2 with evidence `"First session invoking /go (the post-work review reflex)"`.
4. **Regression**: The existing 9 detectors still fire correctly against their existing fixtures. Catches accidental breakage from adding the `commands` Set to `scanTranscriptModes`'s return shape (especially if any existing test asserts the return object's exact key set).

## Probe-tracker update (mandatory per CLAUDE.md)

Same PR must update `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`:

- **Part 1 registry:** add 3 rows under the "Progression detectors" / `scripts/progression.mjs` layer (one per new detector).
- **Part 2 tip coverage:** update rows for Boris tips **35** (Remote Control), **48** (/loop & /schedule), and **73** (/go composite skill) — the three tips the new detectors cite — to reflect progression-detector coverage is now present (was previously empty for these tips on the progression-detector axis).
- **Header counts:** re-derive the four counts (tips, dimensions, next-actions, probe-catalog entries, signalsSummary keys) by invoking the source helpers — these are machine-enforced by `scripts/__tests__/tracker-counts.test.mjs`; a stale count fails CI.

## Error handling

Null-safe traversal throughout, matching existing detectors:

- `transcripts.get(sid)?.commands` — optional chaining; `null` if transcript scan missing or commands Set absent.
- `tool_counts?.[ToolName] ?? 0` — default to 0 if `tool_counts` is missing.
- Each detector returns `null` cleanly if no matching session found; `detectMilestones`'s loop already filters nulls (`if (milestone) milestones.push(milestone)` at line 232).
- `transcriptsRequired: true` detectors are skipped when `transcripts` is null — handled by the existing loop guard at line 230.

## Acceptance criteria

- [x] Three new detectors in `scripts/progression.mjs::DETECTORS`, matching the existing record shape (one for scheduled / remote / verification).
- [x] `scanTranscriptModes` in `scripts/_usage-data.mjs` emits a `commands: Set<string>` field.
- [x] Unit tests for each detector — first-occurrence detection + no-false-positive when signals are absent.
- [x] Regression: all 9 existing detectors still fire against their existing fixtures.
- [x] `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` updated in the same PR (Part 1, Part 2, header counts).
- [x] `npm test` green (expect baseline + ~4 new tests).
- [x] Live `npm run assess --include-transcripts --insights-lookback 30` populates `progression.json.milestones` with non-null entries for `scheduled`, `remote`, `verification`.
- [x] `/progression` page shows the new milestones at their telemetry-dated timestamps (not at "today").

## Implementation outcome

PR #108 shipped all changes as specced. Live verification on real `~/.claude/usage-data/` confirmed backdated telemetry timestamps for all three new milestones:

| Dimension | Milestone | Backdated to |
| --- | --- | --- |
| `scheduled` | Started using scheduled workflows | 2026-04-29 |
| `remote` | First remote-tool invocation | 2026-04-15 |
| `verification` | First /go composite invocation | 2026-05-26 |

All five machine-enforced probe-tracker header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 `signalsSummary` keys) are unchanged — the three new detectors are purely progression/telemetry-layer additions with no new `satisfiedWhen` predicates, probe-catalog entries, or `signalsSummary` keys.

## Out of scope

- Multiple detectors per dim (one broad detector each was the explicit scope decision).
- Back-dating config milestones (the `firstSeenAt` freeze is by design per CLAUDE.md — recovering true historical dates from mtimes/git is fragile and lossy).
- Sub-feature breakdowns (Chrome control vs claude.ai web vs iOS vs GitHub Actions for `remote`; `/loop` vs `/schedule` vs `/babysit` as distinct milestones for `scheduled`).
- `/ship` verify-agent dispatches as a separate verification milestone (verification dim already gets `/go` coverage; `/ship` is a composite of multiple dims and would be ambiguous).
- Hybrid tool-or-command detection for scheduled (declined in favor of command-first, since the milestone semantics are user-action; the user's `--include-transcripts` workflow makes this lossless in practice).

## Risks and mitigations

- **`scanTranscriptModes` return shape change:** Adding `commands` to the return object could break any test that asserts exact key membership. Mitigation: regression test (acceptance criterion 4); manual scan for affected tests before implementing.
- **Tracker drift:** Forgetting to update header counts → CI fail. Mitigation: tracker-counts test catches this; design lists the specific files to touch.
- **Wrong Boris tip refs:** Each milestone cites a single Boris tip; if the rubric or tip mapping changes, the milestone becomes inconsistent. Mitigation: confirm Boris tip references against `app/data/rubric.json` during implementation.
- **`commands` Set duplicates the work `scanTranscriptInvocations` does:** They operate at different levels (`scanTranscriptModes` is per-session and called by progression; `scanTranscriptInvocations` aggregates across all sessions for scoring). No actual duplication of effort because both scans are already happening; we're just exposing the per-session view that progression needs.

## Implementation order (preview for the writing-plans handoff)

1. Extend `scanTranscriptModes` with the `commands` Set (verify no existing tests break).
2. Add detector 1 (scheduled) + its test.
3. Add detector 2 (remote) + its test.
4. Add detector 3 (verification) + its test.
5. Update probe-tracker (Part 1, Part 2, header counts).
6. Live verification: `npm run assess` and inspect `progression.json` for the three new milestones.
7. `/ship` the PR.
