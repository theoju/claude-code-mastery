---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
doc_kind: decision
---

# Decision: CCE-33 — Progression milestone detectors for scheduled / remote / verification

**Date:** 2026-06-01  
**Ticket:** CCE-33  
**PR:** #108

## Problem

The `/progression` timeline showed no new milestones past the 2026-05-09 first-run wall for three of the twelve scored dimensions. Users with heavy real usage in `scheduled`, `remote`, and `verification` got no timeline evidence of that adoption. The dashboard was silently under-representing their actual workflow history.

Before this change, `scripts/progression.mjs` held nine telemetry detectors covering eight dimensions (`automation`, `integrations`, `learning`, `memory`, `model-effort`, `parallel`, `permissions`, `planning`). `scheduled`, `remote`, and `verification` had **no detector at all** — not a gap-reasoned unmeasured dim, just nothing.

CLAUDE.md had filed the gap under CCE-33 with a note that adding telemetry-dated detectors for those three dims was the right fix.

## Decision

Add three new detector records to `scripts/progression.mjs::DETECTORS`, one per missing dimension. Each detector self-dates from session `start_time` over full telemetry history, so a user who first invoked `/loop` on 2026-04-25 sees that milestone backdated to its real date — not stamped at the day the detector shipped.

A supporting change extends `scanTranscriptModes` in `scripts/_usage-data.mjs` to emit a `commands: Set<string>` field (previously `scanTranscriptModes` returned `modes`, `skills`, `hasWorktreeState`, `hasAiTitle`, `learningModeMatches`, `assistantTurns`, `opusAssistantTurns`, `entrypoint` — no `commands`). Two of the three new detectors need per-session command sets; this is a ~5-line addition piggybacking on the existing `<command-name>` tag scan loop with no extra I/O.

After the change the `DETECTORS` array has twelve entries, covering 11 of 12 scored dimensions. `terminal/customization` remains without a detector (out of scope for this PR; no transcript or facet signal unambiguously gates on it).

## Per-detector rationale

### `scheduled` — Boris tip 48

**Signal:** first session where the transcript contains `<command-name>loop</command-name>`, `<command-name>schedule</command-name>`, or `<command-name>babysit</command-name>`.

**Why command-first rather than tool-first:** `CronCreate`/`ScheduleWakeup` appear in `tool_counts` when Claude schedules downstream work, but the milestone semantics are "user adopted autonomous scheduling" — a _user_ action (the slash command they typed), not Claude's downstream tool fires. The user's standard `npm run assess` workflow passes `--include-transcripts`, so the transcripts-required gate is lossless in practice. Five of the nine existing detectors are already transcripts-required for the same reason.

**Evidence string:** `First session invoking /<cmd>` — e.g., `First session invoking /babysit`. The earliest matching session wins regardless of which of the three commands it fired.

### `remote` — Boris tip 35

**Signal:** first session where `session-meta/*.json::tool_counts` contains a non-zero entry for `RemoteTrigger`, `PushNotification`, or `SendMessage`.

**Why facets-only (no transcripts):** all three signals are tools fired by Claude and populate `tool_counts` directly — no transcript scan needed. This makes the `remote` detector the one new entry with `transcriptsRequired: false`, matching the `parallel` and `integrations` detectors. Empirically verified during design audit: `tool_counts.RemoteTrigger` and `tool_counts.PushNotification` populate on real session-meta files in `~/.claude/usage-data/`.

**Why tip 35:** the rubric maps `remote` to tips `[35, 44, 46, 47, 50]`. The three tools each serve a different sub-feature (cowork dispatch, mobile push, iMessage/email dispatch), and the detector fires on any of them. Tip 35 ("Remote Control") is the umbrella the three tools collectively serve — the cleanest single citation. Per-sub-feature detectors are explicitly out of scope.

**Evidence string:** `First session firing <tool> (<N> call[s])` — e.g., `First session firing PushNotification (2 calls)`.

### `verification` — Boris tip 73

**Signal:** first session where the transcript contains `<command-name>go</command-name>`.

**Why `/go` rather than a broader verification signal:** tip 14 ("Verification — The #1 Tip") is the foundational ritual, but the actionable user adoption signal is tip 73 ("/go composite skill") — `/go` is the command that operationalizes the ritual (run tests, verify with subagents, review code, simplify). Citing tip 73 matches the existing detector cadence: "First MCP-powered session" cites tip 9 specifically, not a broader concept tip. `goCommandUses` is already collected by `scanTranscriptInvocations` for the existing verification Execution scorer; the new detector reuses the per-session `commands` Set from `scanTranscriptModes` to find the first occurrence, dated.

**Evidence string:** `First session invoking /go (the post-work review reflex)`.

## Data flow

```
session-meta/*.json + transcripts/*.jsonl
        │
        ▼
loadSessionMeta + scanTranscriptModes
(now also emits commands: Set<string>)
        │
        ▼
detectMilestones — 12 detectors
        │
        ▼
app/data/progression.json → app/progression/page.tsx
```

No UI changes required. The page renderer consumes the `{timestamp, dimension, milestone, borisTip, evidence, sessionId}` shape per milestone, which the three new detectors produce verbatim.

## Tests

Three new tests in `scripts/__tests__/progression.test.mjs`, each covering first-occurrence detection and no-false-positive when signals are absent:

- **`scheduled`:** fixture of three sessions; the second has `/babysit` in transcript, the third has `CronCreate` in `tool_counts` but no `<command-name>` tag. Asserts milestone is dated at session 2 and evidence mentions `/babysit` — confirming milestone is user-action dated, not tool-fire dated.
- **`remote`:** fixture of two sessions; the second has `tool_counts.PushNotification: 2`. Asserts milestone dated at session 2 with evidence `"First session firing PushNotification (2 calls)"`. Detector runs without `--include-transcripts` (facets-only gate).
- **`verification`:** fixture of two sessions; the second has `/go` in transcript. Asserts milestone dated at session 2 with evidence matching `/\/go/`.

All existing nine detector tests continue to pass — the `commands` field addition to `scanTranscriptModes`'s return shape is purely additive.

## What this doesn't change

- **Config milestones** (`scripts/config-progression.mjs`) are unaffected. The `firstSeenAt` freeze behavior is by design and not addressed here.
- **The 12th gap** (`terminal/customization`) remains without a detector. No session-meta or transcript field unambiguously flags it; CCE-33 explicitly scoped to the three dims with clear existing signals.
- **Coverage counts:** the five machine-enforced header counts in `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 `signalsSummary` keys) are unchanged — detectors are not catalog-backed probes and don't move those counters. The probe-tracker received a new "Progression detectors" layer (3 rows, one per detector) and Part 2 evidence updates for Boris tips 35, 48, and 73.
