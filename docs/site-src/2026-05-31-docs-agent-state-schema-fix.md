---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Docs-agent state schema fix: `dismissed_gap_flags` type mismatch

On 2026-05-31 the engineering-docs-agent nightly workflow failed before any
subagent dispatched. The orchestrator exited with code 2 roughly 0.2s after
starting, with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

## What was wrong

`.engineering-docs-agent/state.json` is the orchestrator's bootstrap state
file. A prior bootstrap PR seeded `dismissed_gap_flags` as an empty array
(`[]`). The plugin's state schema requires `dismissed_gap_flags` to be an
**object** keyed by `{owner}/{name}#{pr}` — one entry per PR whose gap flag
has been dismissed, not a list. A single wrong JSON literal (`[]` instead of
`{}`) was enough to fail strict schema validation on every run.

Because the check happens at startup, before dispatch, the failure was total:
no lens pages got processed, no PR summaries ran — the nightly silently did
nothing, night after night, until someone looked at the workflow run.

## The fix

PR #102 corrects the seed value in `state.json` so `dismissed_gap_flags`
starts as `{}`. Current state on disk reflects this:

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "6c782ead5731960d3a0a9dd5b4e2ffcb9e1c2135",
    "completed_at": "2026-08-13T08:40:00.656336+00:00"
  },
  "dismissed_gap_flags": {}
}
```

This unblocks the nightly. It does not touch anything else in the state
schema — `version` and `last_successful_run` were already correctly typed.

## What's still open

This PR only fixes the bootstrap file in this repo. The actual root cause —
the plugin's preflight/setup skill emitting `[]` instead of `{}` when it
first writes `state.json` for a new host repo — lives on the
engineering-docs-agent side and is tracked separately as **CCE-66**. Any
other host repo bootstrapped before that plugin-side fix lands is exposed to
the same one-character failure mode.

## Takeaway

A state file that validates against a schema only at the type level (`[]` vs
`{}`) is a case where "the JSON parses" and "the JSON is correct" are
different bars, and only the second one keeps the orchestrator running. The
failure mode here is also a good diagnostic signature to remember: an
orchestrator that exits near-instantly with no subagent activity at all is
worth checking against schema validation first, before assuming a
downstream (dispatch, LLM, network) failure.
