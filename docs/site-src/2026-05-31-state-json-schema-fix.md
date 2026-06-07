---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# State schema fix: `dismissed_gap_flags` must be `{}`

**PR #102 — 2026-05-31**

A one-character difference (`[]` vs `{}`) in `.engineering-docs-agent/state.json`
was blocking every nightly docs-agent run. The fix is a single field swap; the
lesson is a permanent schema contract you should know before touching `state.json`
again.

## What broke

The bootstrap step that seeded `.engineering-docs-agent/state.json` wrote
`dismissed_gap_flags` as an empty JSON array:

```json
{
  "dismissed_gap_flags": []
}
```

The engineering-docs-agent plugin's state loader validates this field on startup.
It expects a **map** — a JSON object keyed by `{owner}/{name}#{pr}` — not a list.
Presenting a list caused a type mismatch at deserialization, which terminated every
subsequent nightly run before any page work started.

## The fix

Swap the field to an empty object:

```json
{
  "dismissed_gap_flags": {}
}
```

That's the only change in the PR. No logic changed; the state file is reread on
the next scheduled run and the agent proceeds normally.

## Schema contract

`dismissed_gap_flags` is the field the plugin uses to record that a specific PR's
gap flag has been explicitly dismissed by a human reviewer. Its keys are
`{owner}/{name}#{pr}` strings and its values are dismissal metadata. An empty
object (`{}`) is the correct initial value. An array (`[]`) is never valid for
this field, regardless of how "empty array ≡ empty collection" reads intuitively
in other contexts.

If you ever need to reset this field (e.g., after migrating repos), write `{}`
— not `[]`, not `null`, not an absent key.

## Upstream root cause

The plugin's `setup_scaffold` skill and preflight checks did not guard against
seeding `dismissed_gap_flags` as an array at bootstrap time. **CCE-66** tracks
the plugin-side fix: the preflight validator and the setup skill must both
enforce the `{}` shape on first write, so the wrong type can never reach a
running agent.

Until CCE-66 lands in the plugin, treat this as a manual invariant: any time
you inspect or edit `.engineering-docs-agent/state.json` by hand, verify the
field is an object before saving.
