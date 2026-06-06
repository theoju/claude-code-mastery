---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# Fix: `dismissed_gap_flags` schema error in state.json

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Severity:** Blocker — every nightly docs-agent run failed at startup

## What broke

The bootstrap PR seeded `.engineering-docs-agent/state.json` with the following shape for `dismissed_gap_flags`:

```json
{
  "dismissed_gap_flags": []
}
```

The plugin's state schema requires `dismissed_gap_flags` to be an **object** keyed by `{owner}/{name}#{pr}` strings — not an array. Strict schema validation ran before any subagent could dispatch, exiting the orchestrator with code 2 within ~0.2 s of startup:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

## The fix

Change the value from an empty array to an empty object:

```json
{
  "dismissed_gap_flags": {}
}
```

That's the entire change. One character (`[` → `{`, `]` → `}`). The orchestrator loads the corrected file without error and nightly runs proceed normally.

## Why it wasn't caught earlier

The bootstrap PR wrote `[]` — a valid JSON literal that passes basic syntax checks — but the plugin's schema validator only runs at orchestrator startup, not at state-file generation time. The mismatch went undetected until the first nightly run fired.

## Follow-up

**CCE-66** tracks the plugin-side root cause: the setup skill that generates the initial `state.json` must emit `{}` for object-typed fields, not `[]`. That work is separate from this hotfix and not covered by PR #102.

Until CCE-66 lands, if you bootstrap a new host repo and the docs-agent exits immediately with a schema error, check `dismissed_gap_flags` in `.engineering-docs-agent/state.json` first.
