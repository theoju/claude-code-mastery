---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Decision: Fix `dismissed_gap_flags` schema violation in state.json (PR #102)

**Date:** 2026-05-31  
**Status:** Resolved — one-character fix; upstream prevention tracked as CCE-66

## Context

`.engineering-docs-agent/state.json` is the runtime state file read by the docs-agent nightly orchestrator on every startup. The orchestrator enforces strict JSON Schema validation before dispatching any subagent. The schema requires `dismissed_gap_flags` to be a JSON **object** keyed by `{owner}/{name}#{pr}` strings — for example:

```json
{
  "dismissed_gap_flags": {
    "theoju/claude-code-self-assessment#42": true
  }
}
```

The bootstrap PR that first seeded `state.json` initialized the field as an empty **array** (`[]`) instead of an empty **object** (`{}`).

## Problem

Every docs-agent nightly run was aborting within approximately 0.2 seconds of startup with exit code 2 and the message:

```
state invalid at $.dismissed_gap_flags: [] is not of type object
```

No subagent was dispatched. The orchestrator halted immediately at the state-load step, before any gap analysis or page authoring could begin.

## Decision

Apply the minimal correct fix: change `"dismissed_gap_flags": []` to `"dismissed_gap_flags": {}` in `.engineering-docs-agent/state.json`. A one-character correction — array bracket to object brace — is the right scope; there is no other state to migrate.

**Current state of the file after the fix:**

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

## Why not a broader change?

The state file is a runtime artifact, not a committed config template. Changing more than the schema-violating field risks introducing a second gap between the written file and the orchestrator's expected state contract. The prevention fix belongs in the plugin's preflight/setup skill and its `state.example.json` — that work is tracked separately.

## Follow-up

**CCE-66** tracks the root-cause fix in the plugin itself:

- The preflight/setup skill must never emit `[]` for `dismissed_gap_flags` when seeding a new `state.json`.
- `state.example.json` should be updated to model the correct empty-object form (`{}`), so bootstrap PRs generated from the template are correct by construction.
