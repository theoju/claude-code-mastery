---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# docs-agent-nightly workflow migration (2026-06-01)

**PR #111 · CCE-66** — Two-line hygiene edit to `.github/workflows/docs-agent-nightly.yml`. No logic or step order changed.

## What changed

| Field | Before | After |
| --- | --- | --- |
| GitHub App token input | `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` |
| Jira email source | `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` |

### 1. GitHub App token: `app-id` → `client-id`

`actions/create-github-app-token@v3` deprecated the `app-id` input in favour of `client-id`. The value moved from an encrypted repository secret (`DOCS_AGENT_APP_ID`) to a repository variable (`DOCS_AGENT_APP_CLIENT_ID`). The App client ID is not sensitive — it appears in the App's public settings page — so storing it in the secrets store was never necessary.

### 2. Jira email: `secrets` → `vars`

An Atlassian account email is a basic-auth username, not a credential. It was stored under `secrets.JIRA_EMAIL` as a side-effect of initial provisioning, not because it needs encryption. Moving it to `vars.JIRA_EMAIL` makes the value visible in the repository's Variables UI, simplifies rotation, and keeps the secrets store for actual secrets (tokens, private keys).

## Required repository configuration

Before the next workflow run, ensure these two repository-level items exist:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `DOCS_AGENT_APP_CLIENT_ID` | GitHub App client ID (from the App's settings page) |
| Variable | `JIRA_EMAIL` | Atlassian account email used for Jira API calls |

The companion plugin PR (`theoju/engineering-docs-agent#91`) was already merged before this workflow change landed.

## Files affected

Only `.github/workflows/docs-agent-nightly.yml` — no application code, scoring logic, or test fixtures were touched.
