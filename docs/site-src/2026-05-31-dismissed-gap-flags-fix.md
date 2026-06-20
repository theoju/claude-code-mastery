---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` initialized as array instead of object

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Follow-up:** CCE-66

## What broke

The engineering-docs-agent nightly run aborted within ~0.2 seconds of startup — before any subagent dispatched — with exit code 2 and the message:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The orchestrator enforces strict JSON schema validation on `.engineering-docs-agent/state.json` at load time. The `dismissed_gap_flags` field must be a keyed object where each key is of the form `{owner}/{name}#{pr}`. The bootstrap PR that seeded the file had set it to an empty array (`[]`) instead of an empty object (`{}`). The schema check is strict: an array is not an object, so validation failed immediately and the entire run was blocked.

## The fix

One character change in `.engineering-docs-agent/state.json` — `[]` → `{}`:

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

The field is now an empty object, which satisfies the schema's type constraint. Normal nightly execution resumes.

## Why this happened

The `dismissed_gap_flags` field is populated lazily — the orchestrator only writes entries when a gap flag is dismissed. Until a dismissal occurs, the field sits empty. An empty array (`[]`) and an empty object (`{}`) are visually similar and both "empty" in casual reading, but they are distinct JSON types. The bootstrap script that seeded `state.json` used `[]`, which passed no runtime check until the schema validator ran on the first nightly invocation.

## What remains

**CCE-66** tracks the plugin-side preventive fix: the setup skill and `state.example.json` should never emit an array for `dismissed_gap_flags`. Until that lands, any fresh install that bootstraps `state.json` from the example or the setup skill is at risk of the same abort. If you hit exit code 2 with a schema error on this field, apply the one-character fix above directly to your local `.engineering-docs-agent/state.json`.
