---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# State JSON Schema Fix — `dismissed_gap_flags` Must Be an Object

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## Problem

The bootstrap PR that seeded `.engineering-docs-agent/state.json` set `dismissed_gap_flags` to an empty JSON array (`[]`). The plugin's strict JSON Schema validation requires it to be an object (`{}`), keyed by `{owner}/{name}#{pr}` strings.

The orchestrator validates `state.json` at startup and exits with code 2 on any type mismatch. The result: the docs-agent nightly run failed entirely within milliseconds of startup — no pages were written, no gap analysis ran.

The failure was first visible in a `.github/workflows` run on 2026-05-31, with a schema validation error at:

```
$.dismissed_gap_flags
```

## Decision

Use `{}` (empty object) — never `[]` (empty array) — when bootstrapping `dismissed_gap_flags` in `state.json`.

## Correct shape

Empty bootstrap:

```json
{
  "dismissed_gap_flags": {}
}
```

When flags are present, each key follows the `{owner}/{name}#{pr}` pattern:

```json
{
  "dismissed_gap_flags": {
    "theoju/claude-code-self-assessment#97": true
  }
}
```

## Why it matters

The orchestrator enforces strict JSON Schema validation before any useful work starts. A wrong collection type is fatal — there is no graceful degradation, no partial run, no fallback. Exit code 2 fires before any page authoring loop executes.

This makes the bootstrapping shape a hard contract, not a convenience default. Seeding `dismissed_gap_flags` as `[]` is syntactically valid JSON but schema-invalid, and the error only surfaces at runtime when the workflow fires.

If you need to reset `state.json` or seed it in a new environment, always use the `{}` form. The object may be empty but must be an object.

## Fix

Single-line change in `.engineering-docs-agent/state.json`:

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```
