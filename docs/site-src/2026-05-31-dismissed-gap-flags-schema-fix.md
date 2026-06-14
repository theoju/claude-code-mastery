---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Incident: `dismissed_gap_flags` schema fix (CCE-65)

**Date**: 2026-05-31  
**Ticket**: CCE-65 (incident) · CCE-66 (root-cause follow-up)  
**PR**: [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## What happened

Every nightly docs-agent run was failing immediately with orchestrator exit code 2. No subagent dispatched; the failure occurred ~0.2 s into startup during JSON schema validation of `.engineering-docs-agent/state.json`.

The cause: the bootstrap PR that first wrote `state.json` emitted `dismissed_gap_flags: []` (an empty JSON array). The plugin's state schema requires `dismissed_gap_flags` to be a keyed object — `{ "{owner}/{name}#{pr}": <flag> }` — not an array. Strict schema validation at orchestrator startup caught the type mismatch and exited before any work could proceed.

## Fix

PR #102 is a one-line change to `.engineering-docs-agent/state.json`:

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

The corrected file now reads:

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

This unblocks the nightly pipeline. No scoring logic, no rubric, and no subagent behavior changed.

## Root cause

The preflight / setup skill that bootstrapped `state.json` emitted `[]` for an object-typed field. JSON serializers that default an empty collection to array syntax rather than object syntax are the proximate cause; the deeper issue is that the setup skill had no schema validation step before writing the file.

CCE-66 tracks the plugin-side fix: the preflight/setup skill must always emit `{}` for `dismissed_gap_flags`, and should validate the written file against the schema before exiting.

## Decision

Apply the minimal one-line type correction immediately (PR #102). Do not attempt to auto-migrate or reconstruct dismissed flags — the field was empty, so no information is lost.

## References

- [PR #102](https://github.com/theoju/claude-code-self-assessment/pull/102) — the fix
- CCE-65 — incident ticket
- CCE-66 — root-cause ticket (setup skill emits wrong type)
- `.engineering-docs-agent/state.json` — the affected file
