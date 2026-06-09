---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Decision: fix `dismissed_gap_flags` type in `state.json` (2026-05-31)

**Ticket:** CCE-66 (plugin-side root cause)  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## What happened

The bootstrap PR that seeded `.engineering-docs-agent/state.json` emitted
`dismissed_gap_flags: []` — an empty array. The plugin's state schema
requires that field to be a keyed object (`{ "owner/name#pr": true, … }`),
not an array.

The orchestrator performs strict JSON Schema validation at startup. A type
mismatch on any field causes an immediate exit with code 2, within ~0.2 s of
launch. The result: every nightly subagent dispatch was silently blocked until
the field type was corrected.

## The fix

One character: `[]` → `{}`.

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

No logic changes; no data was lost. The empty object satisfies the
`additionalProperties: boolean` schema shape the orchestrator validates
against.

## Why strict validation fails fast here

The orchestrator reads and validates `state.json` before doing anything else —
before resolving repos, before queuing dispatches, before writing any output.
The design is intentional: a corrupt state file should never let a partial
dispatch slip through. The cost of that safety property is that a wrong type
on a single field shuts down the whole pipeline until corrected.

## Follow-up

CCE-66 tracks the plugin-side root cause: the setup skill and
`state.example.json` should never emit `[]` for this field. Until that lands,
any host bootstrapping a fresh `state.json` from the example file should
verify `dismissed_gap_flags` is `{}` before the first nightly run.
