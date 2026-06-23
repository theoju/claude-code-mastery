---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: Fix `dismissed_gap_flags` Schema — `[]` → `{}`

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Ticket:** CCE-65

---

## Context

`.engineering-docs-agent/state.json` is loaded and validated against a strict JSON Schema on every orchestrator startup. The schema requires `dismissed_gap_flags` to be an **object** keyed by `{owner}/{name}#{pr}` strings — each value is a boolean flag indicating the operator has explicitly dismissed a gap for that PR.

The bootstrap commit that seeded `state.json` wrote:

```json
"dismissed_gap_flags": []
```

An array is an intuitive shape for a "list of dismissed things," but the schema declares the field as `type: object`. Because validation is strict and runs before any subagent dispatch, every nightly docs-agent run was exiting with **code 2 within approximately 0.2 s** — before a single subagent could be scheduled.

## Decision

Change the single character that causes the type mismatch. The corrected field in `.engineering-docs-agent/state.json`:

```json
"dismissed_gap_flags": {}
```

An empty object satisfies `type: object` and is semantically correct: no gaps have been dismissed yet, so the map has no entries. No application logic changed — only the seed value.

## Why this shape

The field is a map rather than an array because lookups happen by key (`{owner}/{name}#{pr}`), not by linear scan. An array would require iterating every entry on each PR check; an object gives O(1) membership tests. The schema reflects this intent, and the bootstrap value should have matched it from day one.

## Impact

- **Before fix:** orchestrator exits code 2 on load; zero subagents dispatched; all nightly runs blocked.
- **After fix:** schema validation passes; orchestrator proceeds normally. No data migration needed — the empty object is the correct initial state.

## Follow-up

**CCE-66** tracks the plugin-side prevention: the preflight/setup skill that generates the initial `state.json` should emit `{}` (or omit the field entirely and let the schema apply a default) rather than relying on the caller to get the type right. Until that lands, any fresh bootstrap must use `{}` for this field.
