---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Workflow App Token Migration (CCE-66)

**PR #111** — two-line edit to `.github/workflows/docs-agent-nightly.yml` to follow a breaking change in `actions/create-github-app-token@v3`. No logic or behaviour of the nightly docs-agent job changes; only how the app token is minted and how the Jira email is stored.

## What changed

| Before | After | Why |
|--------|-------|-----|
| `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` | `app-id` is deprecated in `create-github-app-token@v3`; `client-id` is the replacement input |
| `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` | A basic-auth username carries no sensitive value — Variables are the correct GitHub home for non-credential config |

The companion change in the plugin repo is PR #91, merged at `91e9b6c`.

## Pre-merge verification checklist

Before merging a similar migration (or re-provisioning the workflow from scratch), confirm each repo Variable and Secret is present in the right store.

**Repository Variables** (`Settings → Secrets and variables → Variables`):

| Name | Value |
|------|-------|
| `DOCS_AGENT_APP_CLIENT_ID` | The GitHub App's Client ID (visible on the App's settings page — _not_ the Installation ID) |
| `JIRA_EMAIL` | The Atlassian account email used for Jira basic-auth (`designitright.atlassian.net`) |

**Repository Secrets** (`Settings → Secrets and variables → Actions`):

| Name | Value |
|------|-------|
| `DOCS_AGENT_APP_PRIVATE_KEY` | PEM-encoded private key for the GitHub App |
| `JIRA_API_TOKEN` | Atlassian API token (the actual credential) |

If `DOCS_AGENT_APP_CLIENT_ID` is absent from Variables, the workflow fails at the token-mint step with `Input required and not supplied: client-id` — a cryptic error that looks like an auth failure. Check Variables before the private key.

## Why `client-id` not `app-id`

`actions/create-github-app-token@v3` renamed the input. The client ID is a stable, non-secret identifier for the GitHub App (visible on its public settings page); there is no reason to store it as a Secret. Moving it to a Variable also makes the distinction between "config" and "credential" obvious in the repository settings UI.

## Context

- **Ticket**: CCE-66
- **Affected file**: `.github/workflows/docs-agent-nightly.yml`
- **Companion PR**: plugin repo PR #91 (`91e9b6c`)
- **Dashboard behaviour**: unchanged — pure CI/CD housekeeping
