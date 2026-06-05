---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# CCE-65: `dismissed_gap_flags` type fix — `[]` → `{}`

**Date:** 2026-06-05  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Severity:** P0 operational — every nightly docs-agent run was blocked

---

## What broke

Every nightly run of the engineering-docs-agent orchestrator exited with code 2 before dispatching any subagent. The error was emitted at state-load time:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

No lens pages were authored, no gap-flag checks ran, no deploys happened.

## Root cause

The bootstrap PR that seeded `.engineering-docs-agent/state.json` emitted `dismissed_gap_flags` as a JSON array (`[]`) instead of a JSON object (`{}`). The plugin's state schema requires this field to be an object whose keys are `{owner}/{name}#{pr}` strings — one entry per gap flag the operator has manually dismissed. An array fails the schema's `type: object` constraint at strict validation, which the orchestrator enforces before doing anything else.

The field is correct as an empty object when no flags have been dismissed yet. It should never be an array at any point in the state lifecycle.

## Fix

One character changed in `.engineering-docs-agent/state.json`:

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

The orchestrator passed schema validation on the next run and dispatched subagents normally.

## Schema constraint for future maintainers

If you are bootstrapping `state.json` from scratch, the `dismissed_gap_flags` field must be an empty object, not an empty array:

```json
{
  "dismissed_gap_flags": {}
}
```

Once a gap flag is dismissed, the orchestrator writes an entry with the shape:

```json
{
  "dismissed_gap_flags": {
    "theoju/claude-code-self-assessment#42": true
  }
}
```

An array type here is never valid — even an empty one. If the orchestrator exits code 2 immediately on startup with a `$.dismissed_gap_flags` validation error, this is the first thing to check.

## Follow-up

**CCE-66** tracks the plugin-side fix: the setup skill and `state.example.json` should be hardened so this field can never be emitted as an array during initial scaffold. That change will have its own doc entry when shipped.
