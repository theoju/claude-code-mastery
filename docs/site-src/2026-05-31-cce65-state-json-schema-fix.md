---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# CCE-65: `state.json` schema fix — `dismissed_gap_flags` must be `{}`

**PR #102 · 2026-05-31 · one-character operational fix**

## What broke

The docs-agent nightly was completely blocked. The orchestrator exited immediately with code 2 before dispatching any subagent. No pages were authored, no gaps were evaluated, no runs succeeded.

## Root cause

The bootstrap PR that created `.engineering-docs-agent/state.json` seeded `dismissed_gap_flags` as an empty array:

```json
{
  "dismissed_gap_flags": []
}
```

The plugin's state schema requires this field to be a keyed object — keys are `{owner}/{name}#{pr}` identifiers, values are dismissal metadata. An array fails strict schema validation at state-load time, which is the very first thing the orchestrator does. There was no recovery path; it exited before touching any subagent.

## Fix

One character changed in `.engineering-docs-agent/state.json`:

```json
{
  "dismissed_gap_flags": {}
}
```

That's the entire diff. The orchestrator now passes state validation and runs normally.

## Follow-up: CCE-66

This was an operational incident caused by a plugin-side authoring mistake. CCE-66 tracks the prevention work: the setup skill and `state.example.json` should never emit `[]` for `dismissed_gap_flags` in the first place. Until CCE-66 lands, any repo that bootstrapped `state.json` from the setup skill during this window should verify the field is `{}`, not `[]`.

## Impact

- **Severity**: complete nightly blockage — zero docs output while the bug was live.
- **Fix scope**: one file, one field, no logic changes, no test changes.
- **Detection**: orchestrator exit code 2 with schema validation error in stderr.
