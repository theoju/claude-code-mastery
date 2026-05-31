---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# CCE-65: `dismissed_gap_flags` schema fix — `[]` → `{}`

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Severity:** blocking — orchestrator exited code 2 on startup, no subagents dispatched

---

## What broke

The bootstrap PR that seeded `.engineering-docs-agent/state.json` initialized `dismissed_gap_flags` as an empty array:

```json
{
  "dismissed_gap_flags": []
}
```

The orchestrator's schema validator checks this field at startup. `dismissed_gap_flags` must be a JSON **object** keyed by `{owner}/{name}#{pr}` strings — not an array. The validator rejected the array type immediately:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The process exited with code 2 within ~0.2 seconds, before any subagent could dispatch. Every nightly docs-agent workflow run was blocked from the moment the bootstrap was applied.

---

## The fix

Change the field value in `.engineering-docs-agent/state.json` from `[]` to `{}`:

```json
{
  "dismissed_gap_flags": {}
}
```

That's the entire patch. An empty object satisfies the schema; keys are written by the orchestrator when a gap flag is dismissed at runtime.

If you're setting up state.json from scratch, check `state.example.json` — it either omits the field or emits `{}`. Either form is valid; the orchestrator treats a missing field the same as an empty object.

---

## Root cause

The bootstrap author initialized `dismissed_gap_flags` with `[]` (the JSON "empty container" mental model applied without checking the field type). The schema requires an object, not an array, because dismissals are keyed lookups — checking whether a specific `{owner}/{name}#{pr}` string is present — not ordered items.

---

## Follow-up: CCE-66

CCE-65 is the unblocking patch — it corrects the live state file. **CCE-66** tracks the plugin-side root cause: the preflight/setup skill must never emit `[]` for `dismissed_gap_flags`. The fix there is to update the skill to either omit the field (matching `state.example.json`) or explicitly emit `{}`. CCE-66 does not need to land before CCE-65 takes effect; fix the live file first, then address the generation path.

---

## Checklist if you hit this again

1. Confirm the exit code is 2 and the error message names `$.dismissed_gap_flags`.
2. Open `.engineering-docs-agent/state.json`; locate the field.
3. Replace `[]` with `{}`. Save.
4. Re-run the orchestrator — startup schema validation should pass and subagent dispatch should proceed normally.
5. If the same bootstrap skill is used elsewhere, open a CCE-66-style ticket against it.
