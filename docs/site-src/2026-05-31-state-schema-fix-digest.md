---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Digest: `dismissed_gap_flags` schema fix (PR #102)

One-character bug, full-nightly-run blast radius.

## What broke

`.engineering-docs-agent/state.json` seeds `dismissed_gap_flags` as an empty
object:

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

The plugin's state schema requires `dismissed_gap_flags` to be a keyed map
(dismissed gap identifiers → whatever metadata the plugin attaches), not a
list. The bootstrap PR that first created this file seeded the field as `[]`
instead of `{}` — a one-character mistake that's easy to miss because both
are valid, empty, falsy-looking JSON. Strict schema validation doesn't see it
that way: array-vs-object is a hard type mismatch, and the docs-agent's
validator exits with code 2 on it. Every nightly run failed at that gate
before it could get to the actual doc-generation work.

## Why it matters here

This repo doesn't own the engineering-docs-agent plugin's schema, but it does
own `.engineering-docs-agent/state.json` as checked-in config, and that file
is what the nightly workflow reads first. A malformed seed value blocks the
whole pipeline silently from this repo's side — there's no PR, no doc update,
no signal beyond a failed Action run — until someone goes looking.

## Fix

Corrected the seed to `{}`. No behavior change for this repo's documented
systems: no new signals, no scorer changes, no user-visible dashboard impact.
Recorded here as a digest entry rather than folded into an architecture page,
since the fix is a schema-conformance correction to the docs-agent plugin's
own state file, not a change to anything this repo scores or renders.

## Takeaway

When seeding a new state file against an external plugin's schema, don't
guess the shape of an "empty" collection field from the field name alone —
`_flags` reads like it could be a list. Check the schema (or a working
example) before committing the seed.
