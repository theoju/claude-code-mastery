---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# 2026-05-31: `state.json` schema-validation fix

The docs-agent nightly orchestrator's bootstrap state file,
`.engineering-docs-agent/state.json`, had its `dismissed_gap_flags` field
seeded with the wrong JSON type. The plugin's state schema requires an
object keyed by `{owner}/{name}#{pr}`; the seed shipped as an empty array
(`[]`) instead.

## Symptom

A scheduled docs-agent-nightly run on 2026-05-31 failed within roughly 0.2
seconds of starting — before any subagent had a chance to dispatch — with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

Strict schema validation runs at orchestrator startup, so the malformed
seed value blocked the entire pipeline rather than degrading gracefully.

## Fix

PR #102 changes the seed value from `[]` to `{}`. `.engineering-docs-agent/state.json`
now reads:

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

That's the whole change — one character, no application code touched, no
user-facing behavior changed. The fix exists purely to unblock the nightly
pipeline.

## Root cause and follow-up

The array was mis-seeded by a prior bootstrap PR. The actual bug is
upstream: the plugin's preflight/setup skill should never emit `[]` for
this field in the first place. That plugin-side fix is tracked separately
as **CCE-66** in the engineering-docs-agent repo — not in this one. This
page documents the local recovery only.
