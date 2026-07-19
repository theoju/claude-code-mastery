---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Incident: `dismissed_gap_flags` shape mismatch blocked the docs-agent nightly

On 2026-05-31 the engineering-docs-agent nightly workflow failed before
dispatching a single subagent. The orchestrator exited with code 2 within
roughly 0.2 seconds of starting — fast enough that it couldn't have gotten
past its own startup validation, which is exactly what happened.

## Root cause

`.engineering-docs-agent/state.json` — the orchestrator's committed run
state — had `dismissed_gap_flags` seeded as an empty array:

```json
"dismissed_gap_flags": []
```

The plugin's state schema requires this field to be a dictionary keyed by
`{owner}/{name}#{pr}`, not a list. The workflow run's own error output was
unambiguous:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

Strict schema validation runs before the orchestrator dispatches any
subagent, so the malformed field blocked the entire nightly — not just the
gap-flag-dismissal feature.

The `[]` shape traces back to a prior bootstrap PR that seeded the file. It
never should have been an array; the field only makes sense as a lookup
keyed by PR, and an array can't represent that.

## Fix

PR #102 changed the one field:

```json
"dismissed_gap_flags": {}
```

That's the entire fix — swap the empty array for an empty object so it
matches the schema's required type. `.engineering-docs-agent/state.json`
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

with `dismissed_gap_flags` as an object, unblocking the nightly.

## What's still open

PR #102 is the host-repo-side fix — it repairs the committed file so this
orchestrator run stops failing. It does not fix the underlying cause: the
plugin's preflight/setup skill is what emitted `[]` as the default for this
field in the first place, and nothing stops a future bootstrap from doing
it again. That plugin-side fix is tracked separately as **CCE-66**.

If you're onboarding a new host repo with this plugin and the nightly fails
immediately with a `state invalid at $.dismissed_gap_flags` error, check
`.engineering-docs-agent/state.json` for this exact shape mismatch before
assuming an environmental or auth issue.
