---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: architecture
---

# Progression detectors: scheduled, remote, verification (CCE-33)

`/progression` merges two milestone sources: `scripts/config-progression.mjs`
(config milestones, `firstSeenAt` frozen at first observation) and
`scripts/progression.mjs` (telemetry milestones, self-dated from session
`start_time` over full history). Before this PR, the telemetry side covered
8 of the 12 scored dimensions —
`automation, integrations, learning, memory, model-effort, parallel,
permissions, planning`. `scheduled`, `remote`, and `verification` had no
detector at all, so heavy real usage in those three areas produced nothing
on the timeline. Combined with the fact that all 9 existing telemetry firsts
had already saturated and all 8 config firsts share the identical
first-run timestamp, the whole page looked frozen — some of that is
legitimate (one-time adoption events don't repeat), but the missing three
dimensions were a real coverage gap, tracked as CCE-33. PR #108 closes it.

## Three new detectors

`scripts/progression.mjs::DETECTORS` gained three entries, each matching the
existing record shape (`{ transcriptsRequired, detect(sessions, facets,
transcripts, ctx) }`):

**`scheduled`** — fires on the first session whose transcript contains
`/loop`, `/schedule`, or `/babysit` (checked in that order against a
per-session `commands` Set; see below). `transcriptsRequired: true`. The
milestone is deliberately command-first rather than tool-first: the
semantics are "the user adopted autonomous scheduling," which is a user
action, not `CronCreate`/`ScheduleWakeup` firing as Claude's downstream
consequence of that action. Evidence text names the specific command that
fired first, e.g. `First session invoking /babysit`. Cites Boris tip 48.

**`remote`** — fires on the first session where `tool_counts` shows a
nonzero count for `RemoteTrigger`, `PushNotification`, or `SendMessage`.
`transcriptsRequired: false` — these are tool fires Claude makes (an
external trigger arriving, a push notification going out, an iMessage/email
dispatch), so they're already in `session-meta/*.json::tool_counts` with no
transcript scan needed. Cites Boris tip 35 ("Remote Control"), the umbrella
tip for the rubric's `remote` dimension (which maps to tips
`[35, 44, 46, 47, 50]`); a future per-sub-feature breakdown could cite the
others individually but this detector fires on any of the three tools and
cites the umbrella.

**`verification`** — fires on the first session whose transcript invokes
`/go`. `transcriptsRequired: true`. Cites Boris tip 73 (the `/go` composite
skill) rather than tip 14 ("Verification — the #1 tip") because `/go` is
the specific, concrete action the user took — matching how the existing
"First MCP-powered session" detector cites tip 9 rather than a broader
integrations concept.

Each detector returns `null` when no session matches, same as the existing
nine; `detectMilestones` skips any `transcriptsRequired: true` detector
outright when `includeTranscripts` wasn't passed. No changes to
`app/progression/page.tsx` were needed — it renders whatever
`{timestamp, dimension, milestone, borisTip, evidence, sessionId}` records
show up in `app/data/progression.json.milestones`.

## Supporting change: per-session `commands` tracking

`scanTranscriptModes` in `scripts/_usage-data.mjs` already walked every
transcript line looking for `<command-name>` markup to detect
plan-mode-equivalent and learning skill invocations. This PR adds a
`commands: Set<string>` field to its return value, populated from the same
scan loop with no extra I/O — every `<command-name>` match now also lands
in the session's `commands` set, which the `scheduled` and `verification`
detectors consume via `transcripts.get(sessionId)?.commands`.

This is a different code path from `scanTranscriptInvocations` (the
aggregate scanner `scripts/score.mjs` uses for the Execution axis's
`goCommandUses`, `loopCommandUses`, etc.) — that function counts
occurrences across all sessions for scoring; `scanTranscriptModes` is
per-session and feeds the milestone walk. Both scans already ran over the
same files, so exposing the per-session command set here duplicates no
actual scanning work.

## Tests

`scripts/__tests__/progression.test.mjs` adds one test per detector plus a
regression pass over the existing nine, guarding specifically against the
`commands` Set changing `scanTranscriptModes`'s return shape:

- `scheduled` — three sessions with only the second carrying a `/babysit`
  command tag; asserts the milestone dates to that session and the evidence
  string names `/babysit`, not the earlier no-command session or `/loop`
  fired by a later session.
- `remote` — three sessions with only the second carrying
  `tool_counts.PushNotification: 2`; asserts evidence reads
  `First session firing PushNotification (2 calls)`.
- `verification` — three sessions with only the second carrying a `/go`
  command tag; asserts evidence reads `First session invoking /go (the
post-work review reflex)`.

All three assert on `sessionId`, `milestone`, `borisTip`, and evidence
text — not just presence — so a detector matching the wrong session in a
multi-session fixture fails loudly.

## Net effect

All 12 scored dimensions now have a telemetry-dated progression detector.
The remaining "frozen since first-run" behavior on the config-milestone
half of the timeline is unchanged and is by design (`firstSeenAt` is
stamped at first observation, not back-dated from mtimes — see the
Progression section of the top-level `CLAUDE.md`). Sub-feature breakdowns
(e.g. distinguishing `/loop` from `/schedule` from `/babysit` as separate
milestones, or splitting `remote` by tool) and a `/ship`-specific
verification milestone were explicitly scoped out of this PR.

The probe-implementation-status tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) was
updated in the same PR with three new Part 1 registry rows under the
progression-detector layer; no new predicates or `probe-catalog.json`
entries were added since these detectors read directly from session-meta
and transcripts rather than through the catalog.
