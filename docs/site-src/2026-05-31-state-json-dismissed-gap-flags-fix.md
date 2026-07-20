---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` schema mismatch in docs-agent state

## What broke

The 2026-05-31 nightly docs-agent run failed before any subagent dispatched,
about 0.2s in, with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

`.engineering-docs-agent/state.json` is the orchestrator's local checkpoint
file — it tracks the last successfully-processed commit (`last_successful_run`)
and the set of gap flags a maintainer has explicitly dismissed
(`dismissed_gap_flags`). The state schema requires `dismissed_gap_flags` to be
an **object** keyed by `{owner}/{name}#{pr}`, but a prior bootstrap PR had
seeded it as an empty **array** (`[]`) instead. Strict schema validation
rejected the mismatch on load, exit code 2, and the whole nightly run was
blocked — no subagents ran, nothing got dispatched.

## The fix

PR #102 corrected the seed value. `dismissed_gap_flags` in
`.engineering-docs-agent/state.json` is now:

```json
"dismissed_gap_flags": {}
```

That's the entire change — a one-character-class fix (`[]` → `{}`) in a
single config file. No source-tree or architecture changes were needed, and
none of this repo's scoring, signals, or dashboard code was touched.

## Why it happened

The array shape was a plausible-looking mistake: `dismissed_gap_flags` reads
like a list of dismissed items, so seeding it as `[]` is the intuitive
default. But the orchestrator addresses individual entries by PR key
(`{owner}/{name}#{pr}`), which requires an object, not an array. The prior
bootstrap PR that created `state.json` got the container type wrong and
nothing caught it until the schema validator ran against the real state file
on the next nightly.

## Scope: this PR vs. the deeper fix

This PR is the unblock — it corrects the value already checked into this
repo's `.engineering-docs-agent/state.json` so the orchestrator can run
again. It does **not** address why the setup/preflight skill emitted the
wrong shape in the first place. That root-cause prevention — making sure the
plugin-side state bootstrap can't seed `dismissed_gap_flags` as an array on
any host repo — is tracked separately as **CCE-66**, and belongs in the
engineering-docs-agent plugin's own codebase and docs, not here.

If you're debugging a similar failure in another repo running this plugin,
check `dismissed_gap_flags` in that repo's `.engineering-docs-agent/state.json`
for the same array/object mismatch before assuming a new bug.
