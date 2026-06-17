---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# CCE-65: `dismissed_gap_flags` schema fix — `[]` → `{}`

## What happened

The bootstrap PR seeded `.engineering-docs-agent/state.json` with
`dismissed_gap_flags: []` (an empty JSON array). The docs-agent orchestrator
validates state at startup against a strict schema that requires this field to
be a JSON **object** keyed by `{owner}/{name}#{pr}` strings. The mismatch
caused every nightly run to abort with exit code 2 within ~0.2 seconds — before
any subagent was dispatched and before any page could be authored or updated.

## The fix (PR #102)

One character: `[]` → `{}`.

```json
// .engineering-docs-agent/state.json — before
"dismissed_gap_flags": []

// after
"dismissed_gap_flags": {}
```

The current committed state (`version: "1"`, `dismissed_gap_flags: {}`) is the
correct form. No source code or API surface changed.

## Schema constraint

`dismissed_gap_flags` is a map from PR identifiers to boolean flags. An
identifier has the form `{owner}/{repo}#{pr_number}`, e.g.
`theoju/claude-code-self-assessment#102`. An empty map must be expressed as
`{}`, not `[]` — the orchestrator's JSON Schema parser rejects the array type
at startup and does not fall back to an empty map.

## When you bootstrap a new host

If you run the engineering-docs-agent setup skill on a fresh repository, verify
that `state.json` initialises `dismissed_gap_flags` as an object literal before
the first nightly run fires:

```bash
cat .engineering-docs-agent/state.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert isinstance(d['dismissed_gap_flags'], dict), 'must be object'"
```

A zero exit confirms the correct type. A failed assertion means you need to
apply the same one-character edit before the orchestrator will start.

## Follow-up: CCE-66

The root cause lives in the plugin: the setup skill and `state.example.json`
both emit `[]` for this field. **CCE-66** tracks the plugin-side fix so that
new host bootstraps never produce the invalid seed value. Until CCE-66 ships,
treat the one-line assertion above as a required post-bootstrap check.
