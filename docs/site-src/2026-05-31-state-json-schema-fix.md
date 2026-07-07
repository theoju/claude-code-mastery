---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
doc_kind: decision
---

# Fix: `dismissed_gap_flags` schema mismatch blocked every docs-agent nightly run

**PR:** [#102](https://github.com/theoju/claude-code-self-assessment/pull/102)

## What was broken

`.engineering-docs-agent/state.json` seeded `dismissed_gap_flags` as an empty
array:

```json
"dismissed_gap_flags": []
```

The engineering-docs-agent plugin's state schema requires this field to be a
JSON object keyed by `{owner}/{name}#{pr}` — not an array. Strict schema
validation rejected the file with:

```
state invalid at $.dismissed_gap_flags: [] is not of type 'object'
```

Because validation runs before any subagent dispatches, the nightly
orchestrator exited with code 2 within roughly 0.2s of starting, every night,
with no docs generated and no error surfaced anywhere a human would see it
without going looking.

## The fix

Change the seeded value from `[]` to `{}`:

```json
"dismissed_gap_flags": {}
```

That's the entire diff. `.engineering-docs-agent/state.json` in this repo now
reads:

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

An empty object satisfies the schema and unblocks the run; as PRs get their
gap flags dismissed, this field accumulates `"owner/name#pr": {...}` entries.

## Why this happened

A prior bootstrap PR seeded the state file and got the type wrong for this
field — an easy mistake, since `[]` reads naturally as "nothing here yet" even
though the schema wants a keyed object. This PR is a minimal, local
unblocking fix: it corrects the seeded value in *this* repo's state file so
the nightly can run again.

It does not fix the underlying cause. The plugin's own setup/preflight skill
is what emits `dismissed_gap_flags: []` in the first place, and it will do so
again for any other host repo it bootstraps (or if this repo's state file is
ever regenerated from scratch). That root-cause fix belongs in the
engineering-docs-agent plugin repo, not here, and is tracked separately as
**CCE-66**.

## Takeaway

If a nightly docs-agent run disappears with no output and no visible error,
check `.engineering-docs-agent/state.json` against the plugin's schema before
assuming the failure is upstream (missing PRs, API issues, etc.) — a
malformed state file fails before any of that logic runs, and the exit
happens fast enough (~0.2s) that it's easy to miss in a scrollback of longer
normal runs.
