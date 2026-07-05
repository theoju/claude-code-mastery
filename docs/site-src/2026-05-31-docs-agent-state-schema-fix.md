---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Docs-agent state schema fix: `dismissed_gap_flags` must be an object, not an array

## What broke

The engineering-docs-agent orchestrator keeps its bootstrap state in
`.engineering-docs-agent/state.json`, committed to this repo. The field
`dismissed_gap_flags` is a map keyed by `{owner}/{name}#{pr}`, not a list.
The original bootstrap PR seeded it as `[]` instead of `{}`. The orchestrator
validates this file against a strict schema on startup, and `[]` fails a
`type: object` check:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

That validation runs before any subagent dispatch, so the nightly docs-agent
workflow exited with code 2 within roughly 0.2 seconds — no summarizer, no
page-author, nothing. The failure mode looked instantaneous because it was:
the whole run never got past config load.

## The fix

PR #102 changed one character class in the committed state file:

```json
"dismissed_gap_flags": {}
```

Current state, confirmed in `.engineering-docs-agent/state.json`:

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

No other fields changed. `last_successful_run` still tracks the last SHA/PR
pair the orchestrator processed; `dismissed_gap_flags` now matches the shape
the plugin actually reads and writes to it (a map from PR identity to
whichever gap flags were dismissed against that PR).

## Why this happened, and what's still open

The root cause isn't in this repo — it's in the engineering-docs-agent
plugin's preflight/setup skill, which emits `[]` for this field when
bootstrapping a new host repo instead of either omitting the field or
emitting `{}`. This PR is the local unblock, not the fix: any other repo
bootstrapped by the same plugin version will hit the identical schema error
on its first nightly run. The plugin-side fix is tracked as **CCE-66** and
hasn't landed as of this writing. If you're onboarding a new host repo with
this plugin before CCE-66 ships, check the seeded `state.json` for this same
`[]`-vs-`{}` mismatch before waiting on a failed nightly run to tell you.

## Takeaway

A single wrong JSON type in a committed bootstrap file can fail an entire
automated pipeline before it does any real work, and the failure will look
like "nothing ran" rather than "something errored" unless you go looking at
the exit code and the ~0.2s runtime. When an orchestrated workflow exits
suspiciously fast, check state/config validation first — it's cheaper than
assuming the task itself is broken.
