---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fixing `dismissed_gap_flags`: `[]` vs `{}` in `.engineering-docs-agent/state.json`

## What broke

On 2026-05-31 the docs-agent nightly workflow failed within about 0.2 seconds
of starting. The orchestrator's strict schema validation rejected this repo's
`.engineering-docs-agent/state.json` with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The field was seeded as an empty array (`[]`). The plugin's state schema
requires `dismissed_gap_flags` to be an object, keyed by
`{owner}/{name}#{pr}`. An array satisfies neither the type nor the key
shape, so validation failed fast and the orchestrator never got past
startup.

## Root cause

The original bootstrap PR that scaffolded this repo's
`.engineering-docs-agent/state.json` used the wrong JSON type for this one
field. It's a plain typo-class bug, not a schema change on the plugin side —
`dismissed_gap_flags` was always meant to be a map, not a list.

## The fix

PR #102 changed the seed value from `[]` to `{}`. The file now reads:

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

That's the entire diff. No other fields, no schema migration, no
user-facing behavior change — the only observable effect is that the
nightly docs-agent workflow runs again instead of exiting with code 2 on
startup.

## Why this is worth a note

A one-character JSON type mismatch blocked a whole nightly pipeline with an
opaque-looking exit. If you're debugging a docs-agent run that dies almost
instantly with no meaningful log output, check
`.engineering-docs-agent/state.json` against the plugin's state schema
before looking anywhere else — `dismissed_gap_flags` in particular must stay
an object (`{}` when empty), never an array.
