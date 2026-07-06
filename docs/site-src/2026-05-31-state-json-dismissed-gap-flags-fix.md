---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` seeded as `[]` instead of `{}` in `.engineering-docs-agent/state.json`

## What broke

`.engineering-docs-agent/state.json` — the committed state file the
engineering-docs-agent orchestrator reads on every run — had
`dismissed_gap_flags` seeded as an empty array:

```json
"dismissed_gap_flags": []
```

The plugin's state schema requires this field to be an **object**, keyed by
`{owner}/{name}#{pr}`, used to track which documentation-gap flags have been
dismissed per PR. An array where an object is required fails strict schema
validation. The orchestrator exited with code 2 within roughly 0.2s of
starting — before any subagent (summarizer, page-author, etc.) ever
dispatched. The docs-agent-nightly workflow was blocked entirely until this
was fixed.

## Fix

One-character-shape fix to the committed state file:

```json
"dismissed_gap_flags": {}
```

No user-facing behavior changes as a result — the field starts empty either
way. The fix only restores schema validity so the orchestrator can start.

## Root cause

A prior bootstrap PR seeded this repo's `state.json` and got the field's type
wrong at seed time. This is a setup/preflight bug in the
engineering-docs-agent plugin, not a mistake specific to this repo: the
seeding step emits `[]` for `dismissed_gap_flags` regardless of target repo.
Every repo onboarded before the plugin-side fix lands is exposed to the same
failure mode.

The plugin-side root cause — making the setup/preflight skill emit `{}` (or
otherwise validate the seed against the schema before writing) — is tracked
separately as **CCE-66** and is not part of this fix. This page documents the
one-file, repo-local repair; CCE-66 is the preventive fix so future
onboardings don't reproduce it.

## Why this is a decision note, not an architecture edit

`.engineering-docs-agent/state.json` is orchestrator-owned, generated state,
not application code — there's no scorer, script, or `app/` surface to
document here. The `core` lens has no operations/archive section yet (only
`images/` lives alongside these pages), so this incident is recorded as a
standalone note rather than folded into an existing page. If `core` grows an
operations or incident-log section later, fold this in rather than leaving it
freestanding.
