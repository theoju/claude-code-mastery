---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: Migrate docs-agent-nightly to `client-id` and move `JIRA_EMAIL` to repo variables

**Date:** 2026-06-09  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Companion plugin PR:** theoju/engineering-docs-agent#91

## What changed

Two inputs in `.github/workflows/docs-agent-nightly.yml` were renamed:

| Before | After | Location |
|---|---|---|
| `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` | `actions/create-github-app-token@v3` step |
| `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` | workflow env block |

No behavior changes. The token the nightly workflow receives is identical; only the input names and their storage location changed.

## Why

### `app-id` → `client-id`

`actions/create-github-app-token@v3` deprecated the `app-id` input in favor of `client-id`. Keeping the old name risks a workflow break on the next patch release of the action. The migration is the upstream-recommended upgrade path.

### `JIRA_EMAIL` out of secrets

`JIRA_EMAIL` is a basic-auth username, not a credential. Storing it in secrets is unnecessary and slightly misleading — secrets imply rotation, auditing, and masking that add no value for a plain email address. Repo variables (`vars.*`) are the right home: visible in the UI, not masked in logs, and readable without the implicit "this is sensitive" signal.

## Onboarding prerequisite

If you fork this repo or set up a new environment, the nightly workflow requires **two repo variables** (not secrets) to be present before the first run:

| Variable | Description |
|---|---|
| `DOCS_AGENT_APP_CLIENT_ID` | GitHub App client ID (previously stored as secret `DOCS_AGENT_APP_ID`) |
| `JIRA_EMAIL` | Atlassian account email used for Jira basic auth |

The GitHub App private key (`DOCS_AGENT_APP_PRIVATE_KEY`) remains a **secret** — that one is a real credential.

Set both under **Settings → Secrets and variables → Actions → Variables** before enabling the workflow. Missing either variable causes the `create-github-app-token` step to fail at workflow start with a missing-input error.

## Decision rationale

- Follow the upstream action's migration guide without deferring to accumulate deprecation debt.
- Apply least-privilege secrets hygiene: only put values in secrets that need to be secrets.
- Keep the companion plugin change (theoju/engineering-docs-agent#91) in sync so both sides of the nightly pipeline use the same input names.
