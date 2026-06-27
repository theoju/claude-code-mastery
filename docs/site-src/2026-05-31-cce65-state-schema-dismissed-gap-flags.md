---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: Fix `dismissed_gap_flags` type in `state.json`

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Follow-up:** CCE-66 (plugin-side preflight fix)

## Problem

The docs-agent nightly was exiting with code 2 within ~0.2 seconds of launch — before any subagent dispatched. The failure happened at the schema-validation step.

Root cause: the bootstrap PR that seeded `.engineering-docs-agent/state.json` wrote `dismissed_gap_flags` as an empty JSON array (`[]`). The plugin's state schema requires that field to be a keyed object mapping `{owner}/{name}#{pr}` strings to values. Strict schema validation rejects an array where an object is expected, so every subsequent nightly run aborted immediately.

## Decision

Change `dismissed_gap_flags` from `[]` to `{}` in `.engineering-docs-agent/state.json`. One character; no logic changes.

```json
// before
"dismissed_gap_flags": []

// after
"dismissed_gap_flags": {}
```

The current state of the file (confirmed in the repo):

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

## Why this fix, not a schema-coercion patch

The plugin validates state strictly on load. Adding coercion inside the plugin (silently converting `[]` → `{}`) would mask future bootstrap errors of the same class. Fixing the seeded file is the right scope for CCE-65; the plugin side is tracked separately as **CCE-66**, which targets the setup skill so it never emits an array for this field in the first place.

## Impact

- **Before fix:** every nightly run exits code 2 at schema validation; no PR summaries are generated; no pages are authored.
- **After fix:** schema validation passes; the orchestrator proceeds to subagent dispatch normally.
- **No breaking change:** `dismissed_gap_flags: {}` is the correct empty state the plugin expects. Existing entries (there were none) would serialize identically.

## Follow-up

CCE-66 addresses the upstream gap: the engineering-docs-agent setup skill should emit `dismissed_gap_flags: {}` (object) rather than `[]` (array) when seeding a fresh `state.json`. Until CCE-66 lands, treat this file as fragile during re-bootstrap — verify the field type after any manual reset.
