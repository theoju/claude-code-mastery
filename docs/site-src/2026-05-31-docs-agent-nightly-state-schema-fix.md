---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Docs-agent nightly: `state.json` schema fix (2026-05-31)

## What broke

The engineering-docs-agent nightly workflow failed on 2026-05-31, exiting
with code 2 within ~0.2s of starting — before any subagent had a chance to
dispatch. The orchestrator's strict schema validation rejected
`.engineering-docs-agent/state.json` with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

## Root cause

`dismissed_gap_flags` is keyed by `{owner}/{name}#{pr}` — it's a map, not a
list. The bootstrap PR that originally seeded `state.json` emitted an empty
array (`[]`) for this field instead of an empty object (`{}`). That single
wrong type was enough to fail the orchestrator's strict validation on every
run since, silently blocking the nightly entirely (no subagent output, no
partial page updates — just an early non-zero exit).

Confirmed against the current file: `.engineering-docs-agent/state.json`
now holds `"dismissed_gap_flags": {}` (an object), matching the
`{owner}/{name}#{pr}`-keyed schema the orchestrator expects.

## Fix

PR #102 corrects the field in-place:

```diff
-  "dismissed_gap_flags": [],
+  "dismissed_gap_flags": {},
```

That's the whole change. `.engineering-docs-agent/state.json` is internal
orchestrator state for this pipeline, not application code, so the fix
doesn't touch anything under `scripts/` or `app/`.

## Follow-up

The one-character fix here unblocks the nightly, but it doesn't address why
the bootstrap emitted the wrong type in the first place. **CCE-66** tracks
the plugin-side root cause: the preflight/setup skill that seeds
`state.json` should never emit `[]` for `dismissed_gap_flags` — the
plugin's own `state.example.json` omits the field entirely, which is the
safer default (absent > wrong-shaped). Until CCE-66 lands, a future
bootstrap on a fresh repo could reintroduce the same failure mode.
