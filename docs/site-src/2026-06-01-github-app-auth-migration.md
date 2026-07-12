---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# GitHub App auth migration in the docs-agent nightly workflow

`CCE-66` · PR [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)

`.github/workflows/docs-agent-nightly.yml` is this repo's only GitHub Actions
workflow (everything else runs Vitest/Playwright via `package.json` scripts).
It authenticates as a GitHub App to open the nightly `docs-agent/YYYY-MM-DD`
PR, and separately calls the Jira REST API to post status. PR #111 changed
how two of that job's inputs are supplied — not what they authenticate as.

## What changed

**1. `app-id` → `client-id` on the App token step.**

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`actions/create-github-app-token@v3` deprecated the `app-id` input in favor
of `client-id`. The value also moved from a repo **secret** to a repo
**variable** (`vars.DOCS_AGENT_APP_CLIENT_ID`) — an App's client ID isn't a
credential by itself (the `private-key` input, still a secret, is what
actually authenticates), so there's no confidentiality reason to hide it.

**2. `JIRA_EMAIL` moved from secret to variable.**

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_EMAIL` is used as the basic-auth *username* against the Jira REST API,
not the credential — `JIRA_API_TOKEN` is the credential and stays a secret.
Reclassifying it as a repo variable makes it visible in the repo's Settings →
Variables tab rather than buried in the write-only Secrets list.

Both are two-line config edits to the same file; no step logic changed.

## Why

Both changes were forced or motivated from outside this repo:

- `app-id` is deprecated upstream in `actions/create-github-app-token@v3`.
  Staying on it risks a future breaking removal.
- `JIRA_EMAIL` was reclassified as non-sensitive during a companion change in
  the `engineering-docs-agent` plugin (its PR #91), which owns the
  orchestrator script this workflow invokes (`orchestrator_runner.py`).
  Keeping the two repos' auth shape consistent avoids a silent mismatch
  between how the plugin's own CI authenticates and how a host repo's does.

## Rollout care

A repo-variable rename is a hard-fail-at-runtime risk if the new variable
doesn't exist yet — unlike a missing secret, GitHub Actions doesn't
distinguish "unset variable" from "empty string" until the step actually
runs and the downstream API call rejects it. Both `DOCS_AGENT_APP_CLIENT_ID`
and `JIRA_EMAIL` were confirmed present as repo Variables *before* this PR
merged, specifically to avoid the nightly cron (`7 7 * * *`, daily) hitting
a first-run failure with no one watching.

## Where this fits

This page is filed as a flat dated page at the `core` lens root because no
`operations` (or equivalent CI/workflow) section exists yet under this lens
— only `images/`. If a section for CI/workflow-auth changes gets
established later, this page (and similar future auth-plumbing changes to
`docs-agent-nightly.yml`) belongs there instead of at the root.
