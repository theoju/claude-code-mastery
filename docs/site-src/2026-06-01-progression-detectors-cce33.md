---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: decision
---

# CCE-33: Progression milestone detectors for `scheduled`, `remote`, and `verification`

**PR #108 · 2026-06-01 · Boris tips 35, 48, 73**

The `/progression` timeline had a silent coverage gap: three of the twelve
scored dimensions — `scheduled`, `remote`, and `verification` — had no
milestone detectors. Heavy real usage in those areas produced no visible
timeline entries, so the progression page appeared frozen for users whose
primary workflows touched autonomous scheduling, remote triggers, or the
`/go` review reflex. CCE-33 closes that gap.

## What changed

Three new records were appended to `DETECTORS` in
`scripts/progression.mjs`, bringing the array from 9 to 12 entries.
Separately, `scanTranscriptModes` in `scripts/_usage-data.mjs` gained a
`commands: Set<string>` field (purely additive — no existing callers
broke) that the two transcript-backed detectors consume.

### New detectors at a glance

| Dimension      | Milestone title                      | Signal source          | Boris tip | `transcriptsRequired` |
| -------------- | ------------------------------------ | ---------------------- | --------- | --------------------- |
| `scheduled`    | Started using scheduled workflows    | `<command-name>` tag   | 48        | `true`                |
| `remote`       | First remote-tool invocation         | `tool_counts` in facet | 35        | `false`               |
| `verification` | First /go composite invocation       | `<command-name>` tag   | 73        | `true`                |

All three detectors are telemetry-dated: they self-date from the
session's `start_time` across full history (independent of
`--insights-lookback`), so the milestone appears at the real first-use
date, not at the day the detector shipped.

### `scheduled` detector

Fires on the first session that contains a `<command-name>loop</command-name>`,
`<command-name>schedule</command-name>`, or `<command-name>babysit</command-name>`
tag in its transcript. The milestone semantics are "user adopted
autonomous scheduling," which is a user action (the slash command they
typed) — not a tool fire. `CronCreate`/`ScheduleWakeup` are Claude's
downstream consequence, so the detector is command-first, not
tool-first. Because the standard `npm run assess --include-transcripts`
workflow makes transcripts available, `transcriptsRequired: true` is
lossless in practice.

Evidence string example: `First session invoking /babysit`

### `remote` detector

Fires on the first session whose `tool_counts` in `session-meta/*.json`
includes a non-zero count for `RemoteTrigger`, `PushNotification`, or
`SendMessage`. These are tool calls fired by Claude — they appear in the
cooked session-meta without any transcript scan, so `transcriptsRequired`
is `false`. The evidence string names the specific tool and count:
`First session firing PushNotification (2 calls)`.

Boris tip 35 ("Remote Control") is the umbrella covering all three
sub-features (cowork dispatch, mobile push, iMessage dispatch); the
detector fires on whichever tool appears first and cites tip 35 as the
single reference.

### `verification` detector

Fires on the first session whose transcript contains
`<command-name>go</command-name>`. `/go` is the command that
operationalizes Boris tip 14's post-work review ritual as a composite
skill (run tests, run subagents, simplify). The detector cites tip 73
("/go composite skill") because that's the specific tip the user
_did_ — matching the existing detector cadence where milestones cite the
most specific actionable tip, not the broader conceptual parent.

Evidence string: `First session invoking /go (the post-work review reflex)`

## Supporting change: `scanTranscriptModes`

The function at `scripts/_usage-data.mjs` now initializes a `commands`
Set alongside the existing `modes`, `skills`, and `hasWorktreeState`
locals. During the existing `<command-name>` scan loop (which already
runs to populate `PLANNING_SKILL_COMMANDS` and `LEARNING_SKILL_COMMANDS`
membership), each matched command name is also added to `commands`.
The Set is returned as a new field on the result object. This is ~5
lines added to the existing loop body — no extra I/O, no second scan.

## Coverage before and after

Before PR #108 the detector catalog covered **8 of 12** scored
dimensions (`automation`, `integrations`, `learning`, `memory`,
`model-effort`, `parallel`, `permissions`, `planning`). After: **11 of
12**. The twelfth dimension (`model-effort`) still has no progression
detector — that remains an open gap.

## Data flow

```
session-meta/*.json + transcripts/*.jsonl
        │
        ▼
loadSessionMeta + scanTranscriptModes (now emits commands: Set<string>)
        │
        ▼
detectMilestones — 12 detectors (9 pre-existing + 3 new)
        │
        ▼
app/data/progression.json .milestones[]
        │
        ▼
app/progression/page.tsx — renders unchanged
```

No UI changes were required. The page renderer consumes the milestone
shape `{timestamp, dimension, milestone, borisTip, evidence, sessionId}`
uniformly; the new detectors produce that exact shape.

## Tests

`scripts/__tests__/progression.test.mjs` contains one test per new
detector:

- **scheduled**: Three sessions; second has `/babysit` in transcript,
  third has `/loop`. Asserts milestone dated at session #2 and evidence
  matches `/babysit` (not the later `/loop` — chronological first wins).
- **remote**: Two sessions; second has `tool_counts.PushNotification: 2`.
  Asserts milestone at session #2, evidence matches
  `PushNotification (2 calls)`, tip is 35.
- **verification**: Three sessions; second has `/go` in transcript.
  Asserts milestone at session #2, evidence matches `/go`, tip is 73.

The existing regression suite (all pre-existing detectors, bypass
threshold logic, lookback filtering, tie-breaking by session ID) ran
green after the `scanTranscriptModes` return shape change.

## Design decisions recorded

**Why `scheduled` is command-first, not tool-first.** `CronCreate` and
`ScheduleWakeup` are Claude's downstream tool fires; they say Claude
acted on the intent, not that the user typed the command. The milestone
semantics are about the user adopting the reflex. Command-first matches
the pattern of five other existing detectors that are also
`transcriptsRequired: true`.

**Why `remote` doesn't require transcripts.** `RemoteTrigger`,
`PushNotification`, and `SendMessage` are recorded directly in
`session-meta/*.json::tool_counts` — verified against real session-meta
files during the design audit. Transcript scan would add I/O for no
additional signal.

**Why the probe-tracker update is mandatory.** CLAUDE.md requires any
probe-set change to update
`docs/superpowers/specs/2026-05-25-probe-implementation-status.md` in
the same PR. PR #108 added three rows to the Part 1 Progression layer
and updated Part 2 evidence entries for Boris tips 35, 48, and 73. The
five header counts in the tracker are CI-enforced by
`scripts/__tests__/tracker-counts.test.mjs` — a stale count would have
failed the build.
