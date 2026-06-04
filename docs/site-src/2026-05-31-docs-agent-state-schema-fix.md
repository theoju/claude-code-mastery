---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# Incident: docs-agent state schema fix (2026-05-31)

The engineering-docs-agent nightly pipeline halted on 2026-05-31 due to a
schema validation failure in `.engineering-docs-agent/state.json`. This page
records the root cause and the one-field fix for future reference.

## What broke

The plugin's state schema requires `dismissed_gap_flags` to be a JSON **object**
(`{}`). The value in the committed state file was of the wrong type — likely
`[]` (empty array) or `null` — which caused schema validation to fail at startup
and halt every nightly run until corrected.

No user-facing API or behavior changed; the pipeline simply could not proceed
past its initialization step.

## The fix

Open `.engineering-docs-agent/state.json` and ensure `dismissed_gap_flags` is
an empty object:

```json
{
  "dismissed_gap_flags": {}
}
```

PR [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)
corrected the value. The change is a single-field update to a non-committed
(state-file) path — no rubric, scorer, or frontend code was touched.

## Why this field exists

`dismissed_gap_flags` is a plugin-managed map that tracks which gap-flag keys
the nightly agent has been told to suppress. The schema enforces an object
(rather than allowing `null` or an array) so the plugin can safely look up
flag keys without a null-guard on every access. An empty object `{}` is the
correct initial state.

## If you hit this again

1. Inspect the validation error in the workflow run log — the plugin logs the
   offending key and expected type.
2. Correct the field in `.engineering-docs-agent/state.json`.
3. Re-trigger the nightly workflow (`gh workflow run docs-agent-pages.yml`) or
   wait for the next scheduled run.

The fix is safe to apply without a full docs-agent restart; the workflow reads
the state file fresh on each run.
