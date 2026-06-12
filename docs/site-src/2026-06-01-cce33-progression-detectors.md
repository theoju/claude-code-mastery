---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: decision
---

# CCE-33: Progression timeline now covers all 12 dimensions

**PR #108 · 2026-06-01**

## What changed

Three new telemetry-dated milestone detectors — `scheduled`, `remote`, and
`verification` — were added to `scripts/progression.mjs::DETECTORS`, closing a
coverage gap that left the `/progression` timeline frozen for users who had
adopted workflows in those three dimensions.

Before this change, the DETECTORS array held 9 entries covering 8 of 12
scored dimensions (`automation`, `integrations`, `learning`, `parallel`,
`permissions`, `planning` with two detectors each for `parallel` and
`planning`, plus a `permissions` "stopped-using-bypass" arc detector). The
`scheduled`, `remote`, and `verification` dimensions had **no detector at
all** — heavy real usage there produced zero milestones and the timeline
appeared frozen past the 2026-05-09 first-run wall. PR #108 adds one
detector per missing dimension, bringing the total to 12.

A supporting change extends `scanTranscriptModes` in
`scripts/_usage-data.mjs` to emit a per-session `commands: Set<string>`
field. The function already scanned `<command-name>` markup for mode
detection; this change collects those names into the Set and returns it,
giving both new transcript-required detectors a clean surface to query.

## Per-detector detail

### `scheduled` — first `/loop`, `/schedule`, or `/babysit` invocation

Transcript-required. `sessions.find()` walks the window looking for a session
whose transcript `commands` Set contains any of `["loop", "schedule", "babysit"]`.
Returns `dimension: "scheduled"`, `borisTip: 48`, and evidence of the form
`"First session invoking /babysit"`. The milestone is intentionally
**command-first** (what the user typed) rather than tool-first (`CronCreate`
fires as a downstream consequence). Consistent with five existing detectors
that are also `transcriptsRequired: true`.

### `remote` — first `RemoteTrigger`, `PushNotification`, or `SendMessage` tool fire

**Not** transcript-required. All three signals are tool calls recorded in
`session-meta/*.json::tool_counts`, so no transcript scan is needed.
`sessions.find()` checks `s.tool_counts?.[tool] ?? 0 > 0` for each of the
three tools. Evidence reads `"First session firing PushNotification (2 calls)"`.
Returns `dimension: "remote"`, `borisTip: 35`. The rubric maps `remote` to
tips `[35, 44, 46, 47, 50]`; tip 35 ("Remote Control") is the umbrella, so
it is the single citation here.

### `verification` — first `/go` invocation

Transcript-required. Queries `transcripts.get(s.session_id)?.commands?.has("go")`.
Returns `dimension: "verification"`, `borisTip: 73` ("/go composite skill"),
evidence `"First session invoking /go (the post-work review reflex)"`.
Boris tip 14 is the conceptual foundation of the verification ritual, but the
detectable user action is tip 73 (`/go`), matching the detector cadence of
existing entries that cite the specific tip the user acted on rather than a
broader concept.

## Telemetry dating

All three detectors are **self-dated from session `start_time`** over full
history (`lookbackDays` defaults to `null` for progression, independent of
`--insights-lookback`). A user whose first `/loop` invocation was on
2026-04-25 will see that milestone appear at its true date once they re-run
`npm run assess --include-transcripts`, not at the day the detector shipped.
This matches the behavior of the nine pre-existing detectors.

## Data flow

The new detectors plug into the existing pipeline without UI changes:

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
app/data/progression.json
        │
        ▼
app/progression/page.tsx — renders unchanged
```

The page renderer's input contract (`{timestamp, dimension, milestone,
borisTip, evidence, sessionId}` per milestone) is produced verbatim by
the new detectors.

## Tests

`scripts/__tests__/progression.test.mjs` covers all three new detectors:

- **scheduled**: session with `/babysit` in transcript fires before a later
  session with `/loop`; assert milestone dates to the earlier session and
  evidence matches `/babysit`.
- **remote**: session with `tool_counts.PushNotification: 2` fires before a
  later session with `RemoteTrigger`; assert milestone dates to the earlier
  session and evidence reads `"PushNotification (2 calls)"`.
- **verification**: session with `/go` in transcript fires before a later
  `/go` session; assert milestone dates to the earlier session and evidence
  matches `/go`.

Existing tests confirm all 9 pre-existing detectors continue to fire
correctly and that the `commands` Set addition does not break the
`scanTranscriptModes` return shape.

## Why now

CCE-33 was filed at v0.9.7 when the `/progression` page was first split out
of the main dashboard. The timeline's frozen appearance past the first-run
wall was **partly expected** (one-time first-adoption events saturate
naturally) but **partly a real gap** — three dimensions had zero coverage
regardless of how heavily they were used. PR #108 closes the gap; the
saturation half remains by design.
