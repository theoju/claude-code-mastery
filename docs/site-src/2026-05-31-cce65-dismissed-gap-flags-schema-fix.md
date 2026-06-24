---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: Fix `dismissed_gap_flags` schema — `[]` → `{}`

**PR #102 · 2026-05-31 · not breaking**

## What changed

A one-character fix to `.engineering-docs-agent/state.json`: the bootstrap PR had seeded `dismissed_gap_flags` as an empty array (`[]`), but the plugin's strict state schema requires it to be an object (`{}`), because keys are composite PR identifiers of the form `{owner}/{name}#{pr}`.

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

After the fix the field looks like:

```json
{
  "version": "1",
  "last_successful_run": { "head_sha": "…", "pr_number": 0 },
  "dismissed_gap_flags": {}
}
```

## Why it happened

`[]` is a natural empty-collection literal — easy to write when you're initializing a state file by hand. The field name `dismissed_gap_flags` doesn't signal "keyed object" at a glance. The bootstrap PR used `[]` and the plugin's schema validator caught the mismatch only at orchestrator startup, not at bootstrap time.

## Impact

The docs-agent nightly was failing with **exit code 2 within ~0.2 seconds of startup** — strict schema validation aborted the orchestrator before any subagent dispatched. Every run since the bootstrap PR landed was a silent no-op.

## How to confirm the fix works

After merging, manually re-trigger the nightly workflow:

```bash
gh workflow run docs-agent-pages.yml
```

Watch the run proceed past state load. If it exits before any subagent fires, check the schema validation error in the job logs — exit code 2 at < 1 second is the fingerprint.

## Follow-up: CCE-66

CCE-66 tracks the plugin-side root cause: the preflight and setup skill must never emit `[]` for `dismissed_gap_flags`. The canonical rule going forward:

- **Omit the field entirely** from `state.example.json` — the orchestrator fills it on first write.
- **If you must emit it explicitly**, emit `{}`, never `[]`.

This repo's `state.json` is the corrected reference (`"dismissed_gap_flags": {}`). The plugin-side guard lives in the engineering-docs-agent repo under CCE-66.
