---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# State schema fix: `dismissed_gap_flags` (PR #102)

One-character JSON bug in the engineering-docs-agent plugin's bootstrap state
file, `.engineering-docs-agent/state.json`. The `dismissed_gap_flags` field
was seeded as an empty array (`[]`) when the plugin's state schema requires
an object (`{}`). The type mismatch blocked the docs-agent nightly run.

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

## What happened

The bootstrap PR that originally created `state.json` seeded
`dismissed_gap_flags` with the wrong JSON type — `[]` instead of `{}`. This
isn't product code in the self-assessment app; it's the docs-agent plugin's
own state file, so the fix is scoped narrowly: flip the seed value to an
object and unblock the run.

## Scope of this fix

PR #102 is the minimal unblock, not a root-cause fix. It doesn't explain why
the schema/seed mismatch happened in the first place — that's tracked
separately under CCE-66. Read this page as a pointer to that ticket rather
than as the full story: if you're investigating a similar `state.json`
issue, check whether CCE-66 has since landed a broader fix before assuming
this digest is still current.

## Why this page exists

This is a minor, internal, one-character fix to tooling state — not an
architecture or operations change to the self-assessment app itself. It's
logged here as a dated digest entry for traceability rather than folded into
a substantive doc, since no user-visible behavior of the dashboard changed.
