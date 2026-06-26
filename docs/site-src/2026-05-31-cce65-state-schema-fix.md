---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: Fix `dismissed_gap_flags` schema error in state.json

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Severity:** Pipeline-blocking (orchestrator exit code 2 at startup)

## What happened

The engineering-docs-agent nightly run failed within ~0.2 seconds of startup. No subagent was dispatched. The orchestrator exited with code 2 after strict JSON Schema validation rejected the `state.json` file it loaded at boot:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The field `dismissed_gap_flags` in `.engineering-docs-agent/state.json` had been initialized as an empty array (`[]`) by the bootstrap PR that seeded the file. The plugin's state schema requires it to be a keyed object — entries are indexed by `{owner}/{name}#{pr}` — not an array. The type mismatch is caught at load time, before any work begins.

## The fix

Changed the value from `[]` to `{}`:

```json
// before
"dismissed_gap_flags": []

// after
"dismissed_gap_flags": {}
```

The corrected `.engineering-docs-agent/state.json` now reads:

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "6c782ead5731960d3a0a9dd5b4e2ffcb9e1c2135",
    "pr_number": 0
  },
  "dismissed_gap_flags": {}
}
```

This unblocks the nightly pipeline.

## Root cause

The bootstrap PR that created `state.json` used `[]` as a placeholder for an empty keyed collection. JSON has no shorthand that distinguishes "empty array" from "empty object" visually when the field name is generic — both look like "nothing here." The plugin's own `state.example.json` omits the field entirely rather than providing an empty-value example, which left no authoritative template to copy from.

## Decision

Patch the value in place. The one-character fix (`[]` → `{}`) is lower risk than re-seeding the file from the example, which would also reset `last_successful_run`.

## Follow-up

**CCE-66** tracks the plugin-side fix: the setup skill and preflight check must never emit `[]` for `dismissed_gap_flags`. The preferred behavior is to follow `state.example.json` and omit the field (letting the plugin initialize it on first write), or to emit `{}` explicitly. This PR does not address CCE-66.
