---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` schema mismatch blocked the nightly docs run

**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## What broke

The 2026-05-31 nightly `docs-agent-pages` run failed before a single subagent
dispatched:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
exit code 2
```

`.engineering-docs-agent/state.json` had `dismissed_gap_flags` seeded as an
empty array (`[]`). The plugin's state schema keys this field by
`{owner}/{name}#{pr}` — it's a map, not a list — so strict schema validation
rejected the file on load, roughly 0.2s into the run.

## The fix

One-character change: `[]` → `{}`.

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

That's the committed shape today. With `dismissed_gap_flags` typed as an
object, the orchestrator passes schema validation and the nightly run can
proceed to subagent dispatch.

## Root cause, and why it's not fixed here

A prior bootstrap PR seeded the field as `[]` instead of `{}`. This repo's
copy was a symptom, not the source: the engineering-docs-agent plugin's own
setup/preflight skill is what emits `[]` for `dismissed_gap_flags` rather than
omitting the field or defaulting it to `{}`, per the plugin's own
`state.example.json`. That's tracked on the plugin side as **CCE-66** and is
out of scope for this repo — this fix only unblocks the nightly immediately
by correcting the committed state file.

If a future bootstrap or reset of `.engineering-docs-agent/state.json`
reintroduces `[]` for this field, that's the CCE-66 bug resurfacing, not a
new issue.

## Why this page lives at the lens root

There's no `operations` or `archive` section under the `core` lens yet (only
`images`), so this decision record is filed as a flat dated slug at the lens
root rather than nested under a subdirectory that doesn't exist yet.
