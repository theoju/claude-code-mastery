---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` schema correction in docs-agent state

**Date:** 2026-05-31  
**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)  
**Scope:** `.engineering-docs-agent/state.json` — one character change  
**Follow-up:** CCE-66 (plugin-side hardening)

## What happened

The bootstrap PR that first seeded `.engineering-docs-agent/state.json` wrote `dismissed_gap_flags` as an empty array (`[]`). The docs-agent plugin validates this field as an object keyed by `{owner}/{name}#{pr}` strings — a dictionary of per-PR dismissal records, not a list. The type mismatch caused the nightly docs-agent run to fail schema validation and exit before producing any output.

**Before:**

```json
{
  "version": "1",
  "last_successful_run": { "head_sha": "…", "pr_number": 0 },
  "dismissed_gap_flags": []
}
```

**After:**

```json
{
  "version": "1",
  "last_successful_run": { "head_sha": "…", "pr_number": 0 },
  "dismissed_gap_flags": {}
}
```

## Why it wasn't caught earlier

The state file was seeded by hand during initial scaffolding. `[]` is a syntactically valid JSON value and passes basic parse checks; the schema-level type assertion (`object`, not `array`) only fires when the plugin's validator actually runs against it — which happens at the start of each nightly run, not at seed time.

## Impact

The nightly docs-agent pipeline was blocked until PR #102 landed. No behavioral data was lost; the field was empty in both forms. Once corrected, the run proceeded normally.

## Resolution

Single-character edit: `[]` → `{}`. No other fields in `state.json` were affected. The current committed state confirms the fix:

```json
"dismissed_gap_flags": {}
```

## Follow-up

**CCE-66** tracks a plugin-side root-cause fix — the `setup_scaffold` script (or equivalent bootstrap path) should write `dismissed_gap_flags` as `{}` rather than relying on contributors to know the expected type. Until that lands, treat any manual re-seeding of `state.json` as requiring explicit `{}` for this field.
