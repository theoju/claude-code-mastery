---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Decision: `dismissed_gap_flags` must be an object, not an array

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Follow-up:** CCE-66 (plugin-side root-cause fix)

## What happened

The bootstrap PR seeded `.engineering-docs-agent/state.json` with
`dismissed_gap_flags: []` — an empty array. The docs-agent plugin's schema
validation requires that field to be an empty object (`{}`). The type mismatch
caused the nightly docs-agent pipeline to reject the state file on first read,
failing the run before any page work was attempted.

PR #102 corrected the single character: `[]` → `{}`. That one-line change
unblocked the nightly run.

## The schema contract

`.engineering-docs-agent/state.json` carries a `dismissed_gap_flags` field
used by the plugin to track which gap warnings the operator has explicitly
silenced. The required shape is:

```json
{
  "dismissed_gap_flags": {}
}
```

Not:

```json
{
  "dismissed_gap_flags": []
}
```

The field is a map (object) from flag key to a boolean or timestamp — an array
has no valid interpretation in this context and the plugin's validator raises
immediately. Any bootstrap script or scaffold template that seeds this file
must use `{}` as the initial value.

## Why the bad value was written

The bootstrap PR that initialized `.engineering-docs-agent/state.json` treated
the field as a list (zero dismissed flags → empty list). The plugin schema was
not consulted before committing the seed value.

## Follow-up

CCE-66 tracks the plugin-side fix: the `setup_scaffold` path in the
engineering-docs-agent plugin should write `dismissed_gap_flags: {}` by
default, preventing this class of error for any new host repo onboarded in
the future. Until CCE-66 lands, verify the initial value manually whenever
bootstrapping a new host.
