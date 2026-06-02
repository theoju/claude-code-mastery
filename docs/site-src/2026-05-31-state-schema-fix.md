---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/102
synthesized_into: []
---

# State schema fix — `dismissed_gap_flags` must be an object

**PR #102 · 2026-05-31**

## What happened

The bootstrap PR that initialised `.engineering-docs-agent/state.json` seeded
`dismissed_gap_flags` as an empty JSON array (`[]`). The orchestrator performs
strict JSON-schema validation on startup and exits with code 2 immediately —
within ~0.2 s — when the field doesn't match the expected type. Every nightly
subagent dispatch was blocked until the field was corrected.

## The contract

`dismissed_gap_flags` is a map keyed by `"{owner}/{name}#{pr}"` strings. A map
is always an **object**, never an array:

```json
// ✅ correct — empty object
{
  "dismissed_gap_flags": {}
}

// ❌ wrong — empty array; fails strict schema validation
{
  "dismissed_gap_flags": []
}
```

Once the field carries real entries it looks like:

```json
{
  "dismissed_gap_flags": {
    "theoju/claude-code-self-assessment#101": true,
    "theoju/claude-code-self-assessment#99": true
  }
}
```

The key structure (`owner/repo#pr`) means it is inherently an object — there
is no meaningful ordered position for these entries, only named presence.

## Remediation

If the orchestrator exits immediately with code 2 and the last log line
references schema validation, open `.engineering-docs-agent/state.json` and
check `dismissed_gap_flags`. Replace any `[]` with `{}`:

```bash
# one-liner if you prefer
node -e "
  const fs = require('fs');
  const f = '.engineering-docs-agent/state.json';
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (Array.isArray(s.dismissed_gap_flags)) {
    s.dismissed_gap_flags = {};
    fs.writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
    console.log('fixed');
  } else {
    console.log('already correct');
  }
"
```

After the fix, re-run the orchestrator. It should pass schema validation and
proceed to dispatch subagents normally.

## Root cause and follow-up

The setup skill's `state.example.json` emitted `[]` for this field. **CCE-66**
tracks the upstream fix so newly bootstrapped repos get `{}` from the start.
Until CCE-66 lands, verify `dismissed_gap_flags` is `{}` whenever you
initialise a new docs-agent state file by hand or via the setup skill.
