---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Incident: `dismissed_gap_flags` array/object mismatch blocks nightly pipeline

**Date**: 2026-06-25  
**PR**: [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Severity**: Pipeline blocker (docs-agent nightly did not run)  
**Follow-up ticket**: CCE-66

## What happened

The engineering-docs-agent orchestrator exited with code 2 within ~0.2 seconds
of startup, before dispatching any subagent. The nightly docs build produced no
output.

Root cause: `.engineering-docs-agent/state.json` contained

```json
"dismissed_gap_flags": []
```

The orchestrator performs strict JSON Schema validation at startup. The schema
requires `dismissed_gap_flags` to be a keyed object — keys are strings of the
form `{owner}/{name}#{pr}` — not an array. An empty array is a type mismatch,
and the validator fails fast rather than coercing the value.

The field was seeded as `[]` by the bootstrap PR that first created
`state.json`. The plugin's own `state.example.json` omits the field entirely,
so there was no template to copy from; the bootstrap author guessed "empty
collection → `[]`" rather than `{}`.

## Fix

Single-line change to `state.json`:

```json
// before
"dismissed_gap_flags": []

// after
"dismissed_gap_flags": {}
```

No user-visible behavior change. The pipeline resumed normally on the next
nightly run after the fix landed.

## Why the validator catches this at startup

The orchestrator's schema validation runs before any I/O or subagent dispatch.
A type mismatch on a required field (array vs. object) is a hard error — the
process doesn't attempt to recover or coerce. The ~0.2 s exit time reflects
this: validation is the very first thing that runs after the process boots.

This is intentional design in the plugin. Fail fast on a corrupt state file
rather than proceed with undefined behaviour when a subagent later tries to
key into `dismissed_gap_flags` as an object.

## Follow-up: CCE-66

The root cause is in the setup skill, not the state file. The plugin's preflight
and setup skill must never emit `[]` for this field. Two acceptable forms:

- Omit the field entirely (matches `state.example.json`).
- Emit `{}` explicitly.

CCE-66 tracks the plugin-side fix so any future bootstrap run produces a
schema-valid `state.json` without requiring a manual correction.
