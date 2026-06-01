---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# Hotfix: `dismissed_gap_flags` schema type mismatch (PR #102)

**Date:** 2026-05-31  
**Ticket:** CCE-66 (upstream plugin fix, open)

## What broke

Every nightly docs-agent run was aborting at orchestrator startup with exit code 2:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

No subagent dispatched. No docs were updated. The failure was silent until the
nightly run was inspected manually.

## Root cause

The bootstrap PR seeded `.engineering-docs-agent/state.json` with
`dismissed_gap_flags: []` — a JSON array. The orchestrator performs strict JSON
schema validation on load, and the schema requires this field to be a keyed
**object** (keys take the form `{owner}/{name}#{pr}`):

```json
// ❌ what was written (bootstrap)
{
  "dismissed_gap_flags": []
}

// ✅ what the schema expects (empty map, not empty list)
{
  "dismissed_gap_flags": {}
}
```

The type mismatch is the sort of thing that passes a casual "looks right" read
— both `[]` and `{}` represent "nothing dismissed yet" — but strict schema
validation treats them as different types.

## Fix applied

PR #102 replaces the `[]` literal with `{}` in
`.engineering-docs-agent/state.json`. One character change; no logic touched.

## Upstream follow-up

CCE-66 tracks the plugin-side root cause: the setup skill that seeds
`state.json` should emit `{}` for `dismissed_gap_flags`, not `[]`. Until that
ships, any fresh bootstrap risks re-introducing the same mismatch. When setting
up a new instance manually, initialize the field as an object:

```json
"dismissed_gap_flags": {}
```

## Lessons

- **Validate state on write, not just on read.** The orchestrator's load-time
  schema check caught the error, but only because the process tried to run.
  Catching a bad write at the setup skill prevents a silent overnight failure.
- **Empty array vs. empty object is a real type distinction.** `[]` and `{}`
  are both "empty" to a human reader; they are not interchangeable in a typed
  schema. Review any state-file initialization that produces an empty
  collection and confirm the schema type.
