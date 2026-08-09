---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# 2026-05-31: `dismissed_gap_flags` seeded as the wrong JSON type

## What broke

The 2026-05-31 nightly run of the engineering-docs-agent orchestrator
failed validation and exited with code 2 roughly 0.2s after starting —
before it touched a single PR. The error:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

The orchestrator's own state file, `.engineering-docs-agent/state.json`,
had `dismissed_gap_flags` seeded as an empty array (`[]`). The plugin's
state schema requires an object, keyed by `{owner}/{name}#{pr}`. A prior
bootstrap PR wrote the wrong JSON type for that one field, and strict
schema validation — correctly — refused to load it. Because validation
runs before any PR processing, the failure was total: the nightly didn't
partially run, it didn't run at all.

## Fix

PR #102 corrects the seed value. `dismissed_gap_flags` in
`.engineering-docs-agent/state.json` now reads:

```json
"dismissed_gap_flags": {}
```

matching the object shape the schema expects, ready to be keyed by PR
identifier (`{owner}/{name}#{pr}`) as flags get dismissed over time. The
rest of the file — `version`, `last_successful_run.head_sha`,
`last_successful_run.pr_number` — was untouched; this was a single-field,
single-character-class fix (`[]` → `{}`), not a schema or shape change.

## Why this is worth a page

`state.json` isn't application code for this repo — it belongs to the
engineering-docs-agent plugin's own bookkeeping — but a malformed seed in
it fully blocked the nightly docs run in production, silently, until
someone read the workflow logs. There's no architecture or operations
page in this lens that currently covers the docs-agent's state schema
(the core lens's tracked sections stop at `images`), so this is filed as
a flat, dated decision note rather than force-fit into a section it
doesn't belong in.

## Takeaway

Bootstrap/seed files for schema-validated state deserve the same
scrutiny as any other config: a `[]` vs `{}` typo is a one-character diff
that a human reviewer can wave through, but strict validators (correctly)
treat it as fatal, and a fatal validation error in a pipeline's own state
file blocks the pipeline before it does anything — there's no partial
credit. If you're seeding a new field in `.engineering-docs-agent/state.json`
by hand, check the plugin's schema for the field's type before committing
the seed, not after the first run fails.
