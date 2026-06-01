---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# CCE-65: `dismissed_gap_flags` schema fix (2026-05-31)

**Scope**: operational patch — corrects a malformed field in `.engineering-docs-agent/state.json`.  
**Breaking**: no.  
**Follow-up**: CCE-66 (plugin-side root cause).

## What happened

The docs-agent-nightly workflow was exiting with code 2 on every run before any subagent could dispatch. The orchestrator's strict schema validation step rejected the committed state file with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The bootstrap commit had seeded `dismissed_gap_flags` as an empty array (`[]`). The plugin's state schema requires it to be a keyed object — keys are `{owner}/{name}#{pr}` strings that map to booleans. An array passes JSON parsing but fails schema validation, so the orchestrator aborted before dispatching any subagent.

## The fix

PR #102 changes the one character that matters in `.engineering-docs-agent/state.json`:

```diff
-  "dismissed_gap_flags": []
+  "dismissed_gap_flags": {}
```

That's the complete patch. No logic changed; only the committed state file was corrected.

## Why this field exists

`dismissed_gap_flags` tracks which PR gap-flags a user has explicitly dismissed so the nightly run doesn't resurface them on subsequent passes. The orchestrator reads it as a lookup table keyed by `{owner}/{name}#{pr}`, which is why the value must be a plain object — array indexing by string key is not valid against this schema.

An empty object (`{}`) is the correct initial state: no flags have been dismissed yet.

## Root cause and follow-up (CCE-66)

The immediate cause is clear: the bootstrap path (the setup skill or `state.example.json`) emitted `[]` instead of `{}`. PR #102 patches the symptom in the committed file; CCE-66 tracks the fix so the setup path never seeds this field as an array again.

Until CCE-66 ships, verify `.engineering-docs-agent/state.json` after any fresh bootstrap — confirm `dismissed_gap_flags` is `{}` before the first nightly run triggers.

## Recovery steps

If you hit exit code 2 with the `[] is not of type 'object'` message:

1. Open `.engineering-docs-agent/state.json`.
2. Find the `dismissed_gap_flags` key.
3. Change its value from `[]` to `{}`.
4. Commit and push.
5. Re-trigger the nightly workflow — subagents should dispatch normally.

No data is lost: an empty array and an empty object are semantically equivalent as "nothing has been dismissed yet." The correction is safe to apply to any state file that hasn't accumulated real dismissals.
