---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# dismissed\_gap\_flags schema fix (2026-05-31)

**PR #102 · non-breaking · no source-code changes**

## What happened

The `.engineering-docs-agent/state.json` file bootstrapped during initial setup
seeded the `dismissed_gap_flags` field as an empty array (`[]`). The
orchestrator's JSON schema validation requires that field to be an **object**
keyed by `{owner}/{name}#{pr}` strings — not an array.

On every subsequent nightly run the orchestrator validated state at startup,
emitted:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

and exited with code 2 within ~0.2 s, before dispatching any subagent. The
docs-agent nightly workflow was completely blocked.

## The fix

Changed the one character in `.engineering-docs-agent/state.json`:

```json
// before
"dismissed_gap_flags": []

// after
"dismissed_gap_flags": {}
```

The current state file (confirmed by reading the source):

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

## Why this field must be an object

The orchestrator uses `dismissed_gap_flags` as a lookup map: when a gap flag is
dismissed for a given PR, the key `{owner}/{name}#{pr}` is written with a
timestamp value. An array has no such key structure, so the schema validator
(strict mode) rejects it immediately rather than silently tolerating it.

## Scope and follow-up

Only the JSON state file was changed — no TypeScript, no scorer logic, no
rubric. The root cause (the plugin-side setup skill emitting `[]` instead of
`{}` during bootstrap) is tracked as **CCE-66**. Until that ticket lands,
anyone re-running the setup skill on a fresh repo should manually verify that
`dismissed_gap_flags` is seeded as `{}` in the generated `state.json`.
