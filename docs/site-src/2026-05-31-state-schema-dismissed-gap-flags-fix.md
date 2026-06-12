---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Decision: `dismissed_gap_flags` must be `{}`, not `[]`

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## Problem

The bootstrap PR seeded `.engineering-docs-agent/state.json` with
`dismissed_gap_flags: []` (an empty JSON array). The engineering-docs-agent
plugin validates the state file schema at startup and expects
`dismissed_gap_flags` to be a JSON **object** keyed by `{owner}/{name}#{pr}` —
not an array. Every nightly run was failing to parse the state file, which
halted automated doc-gap processing before any work was done.

## Fix

One character: change `[]` → `{}`.

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "...",
    "pr_number": 0
  },
  "dismissed_gap_flags": {}
}
```

The key is now an empty object ready to receive string-keyed entries of the
form `"theoju/claude-code-self-assessment#102": true`.

## Why this matters

`dismissed_gap_flags` is a lookup table, not a list. When the agent marks a
gap flag as dismissed, it writes `flags["{owner}/{name}#{pr}"] = true` and
checks `flags[key] !== undefined` on subsequent runs. An array `[]` passes
neither of those operations correctly — the schema validator rejects it
outright, and even if it didn't, the key-lookup semantics would break silently.

## Rule for future bootstraps

When onboarding the engineering-docs-agent into a new repo, seed
`.engineering-docs-agent/state.json` with `dismissed_gap_flags: {}` (object).
Any tool or script that generates the initial state file must write an object
literal, not an array literal, for this field.
