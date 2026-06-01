---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# Fix: `dismissed_gap_flags` schema error in `state.json`

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Ticket:** CCE-66 (root cause; see below)

## What broke

The engineering-docs-agent nightly run exited with code 2 before dispatching any subagent. The orchestrator's strict JSON Schema validation caught a type mismatch in `.engineering-docs-agent/state.json` at startup:

```
state invalid at $.dismissed_gap_flags: [] is not of type object
```

The plugin's state schema requires `dismissed_gap_flags` to be a **JSON object** keyed by `{owner}/{name}#{pr}` strings — a map of dismissed flags per PR. The bootstrap PR that seeded `state.json` had initialized the field as an empty **array** (`[]`) instead of an empty **object** (`{}`). One character; full stop on the nightly.

## The fix

Changed `.engineering-docs-agent/state.json`:

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

No other changes. The schema validation passes and the orchestrator proceeds past state load.

## Verifying after merge

Re-trigger the nightly manually to confirm the orchestrator runs end-to-end:

```bash
gh workflow run docs-agent-nightly.yml
```

Watch for the `state loaded` log line — its presence confirms the plugin passed validation and began dispatching subagents.

## Root cause not addressed here

This PR fixes the symptom. The root cause — the plugin's setup skill and `state.example.json` emitting `[]` instead of `{}` for `dismissed_gap_flags` — is tracked in **CCE-66**. Until that lands, any fresh bootstrap of `state.json` from the example file or the setup skill will reproduce the error.

If you're bootstrapping a new instance before CCE-66 closes, either:

- Edit `state.json` manually to use `{}`, or
- Run the fix-up one-liner after bootstrap:
  ```bash
  jq '.dismissed_gap_flags = {}' .engineering-docs-agent/state.json > /tmp/state.tmp \
    && mv /tmp/state.tmp .engineering-docs-agent/state.json
  ```
