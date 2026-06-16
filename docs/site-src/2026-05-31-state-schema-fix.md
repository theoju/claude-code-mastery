---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Postmortem: `dismissed_gap_flags` schema fix (2026-05-31)

**PR #102 · one-character fix · zero service changes**

## What broke

The engineering-docs-agent nightly pipeline exited with code 2 within ~0.2 s of startup on 2026-05-31 — before any subagent could dispatch. No docs were generated, no lens pages were written.

The root cause: `.engineering-docs-agent/state.json` contained an empty array `[]` for the `dismissed_gap_flags` field. The orchestrator performs strict schema validation on load; the plugin's schema requires `dismissed_gap_flags` to be a keyed object (keyed by `{owner}/{name}#{pr}`). An array failed that check immediately with:

```
[] is not of type 'object'
```

After the fix, the field reads:

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

One character changed: `[]` → `{}`. The pipeline resumed on the next nightly trigger.

## Root cause

The bootstrap PR that seeded `state.json` emitted `[]` instead of `{}` for the flags field. JSON distinguishes arrays from objects; the schema does not coerce one to the other. Because `dismissed_gap_flags` is only written to when a gap flag is dismissed, a freshly bootstrapped repo that has never dismissed a flag will always have an empty value — making the wrong literal easy to overlook during review.

The plugin-side preflight/setup skill is the upstream root cause: it should never emit `[]` for this field. That fix is tracked as **CCE-66**.

## What `dismissed_gap_flags` does

The field is a keyed object used by the orchestrator to suppress repeated gap-flag notifications for a given PR. Each key follows the pattern `{owner}/{name}#{pr}` and maps to a boolean or dismissal metadata. An empty object `{}` is the correct initial value — it means "no flags have been dismissed yet." An empty array `[]` is a type mismatch that schema validation catches at startup, hard-stopping the entire pipeline.

## Impact

- **Scope**: full pipeline block — no subagents dispatched, no lens pages updated.
- **Duration**: from the 2026-05-31 nightly trigger until PR #102 merged and the next run.
- **Data loss**: none. The state file's `last_successful_run` pointer was intact; the pipeline simply skipped the cycle.

## Fix applied

Changed `.engineering-docs-agent/state.json` line 7 from:

```json
"dismissed_gap_flags": []
```

to:

```json
"dismissed_gap_flags": {}
```

No logic changes, no configuration changes, no schema version bump required.

## Follow-up

**CCE-66** tracks the plugin-side fix: the preflight/setup skill must emit `{}`, not `[]`, when bootstrapping `state.json`. Until that lands, any new host repo bootstrapped from the plugin's scaffold is at risk of the same startup failure. Verify the field type in `state.json` after any first-run bootstrap before the nightly trigger fires.
