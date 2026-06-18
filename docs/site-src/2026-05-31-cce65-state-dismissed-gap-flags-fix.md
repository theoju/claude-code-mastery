---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: Fix `dismissed_gap_flags` type in `state.json`

**PR #102 — 2026-05-31**

## Problem

The bootstrap PR seeded `.engineering-docs-agent/state.json` with `dismissed_gap_flags` as an empty array (`[]`). The plugin's state schema requires that field to be an object keyed by `{owner}/{name}#{pr}` strings. At startup the orchestrator performs strict JSON Schema validation and exits with code 2 on type mismatches, so every nightly docs-agent run failed within ~0.2 s — before any subagent was dispatched.

## Decision

Change the value from `[]` to `{}` in `.engineering-docs-agent/state.json`. That is the only change in PR #102.

The field's correct shape in the live file after the fix:

```json
{
  "dismissed_gap_flags": {}
}
```

This matches the contract documented in `state.example.json` and eliminates the startup validation failure.

## Why not patch the schema to accept both types?

The object keying is load-bearing: the orchestrator writes dismissal records as `{owner}/{name}#{pr}: true` entries. An array has no keying mechanism; accepting both types would require a migration path on every read. Keeping the strict object type is correct — the bootstrap was wrong.

## Follow-up: CCE-66

The root cause is that the preflight/setup skill emitted `[]` instead of `{}` when seeding a fresh state file. CCE-66 tracks the plugin-side fix: the skill must emit `{}` or omit `dismissed_gap_flags` entirely (absent fields are treated as empty objects by the validator). That fix is separate from this one-character repair.
