---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: docs-agent-nightly workflow auth migration

**Date:** 2026-06-25  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Companion:** [theoju/engineering-docs-agent#91](https://github.com/theoju/engineering-docs-agent/pull/91)  
**Jira:** CCE-66  
**Breaking:** No

## What changed

Two configuration updates to `.github/workflows/docs-agent-nightly.yml`, 2 additions and 2 deletions total:

1. **`app-id` → `client-id`** in the `actions/create-github-app-token@v3` step. The `app-id` input is deprecated upstream; `client-id` is the replacement.
2. **`JIRA_EMAIL`: `secrets.JIRA_EMAIL` → `vars.JIRA_EMAIL`**. The value is an Atlassian account email used as the Basic-auth username. It is not a credential.

## Why

### `app-id` deprecation

`actions/create-github-app-token@v3` renamed its primary input from `app-id` to `client-id`. The old name still works in v3 but triggers a deprecation warning in CI logs. Staying on `app-id` past the deprecation window risks silent breakage on a future major version bump. The change is mechanical: rename the key, keep the secret reference (`secrets.GITHUB_APP_ID`) unchanged.

### `JIRA_EMAIL` belongs in Variables, not Secrets

GitHub Secrets are for credentials — values that would cause harm if leaked (tokens, passwords, private keys). `JIRA_EMAIL` is an Atlassian account email address used as the username half of a Basic-auth pair. It is:

- Not a password or token
- Not sensitive on its own — the corresponding API token (`JIRA_API_TOKEN`) in Secrets carries the real credential weight
- Already visible in Jira notification emails and Atlassian user profiles

Storing it in Secrets is semantically wrong and adds unnecessary friction: Secrets are masked in logs, making debugging Basic-auth failures harder. GitHub Variables (`vars.JIRA_EMAIL`) is the correct home for non-sensitive configuration values. The API token remains in Secrets.

## Decision rationale

Both changes are correctness fixes, not preference choices:

- The upstream API changed; staying on the deprecated input is a latent break.
- The wrong GitHub store for `JIRA_EMAIL` doesn't introduce a security risk, but it misrepresents the sensitivity classification of that value and obscures logs needlessly.

No behavior changes. The docs-agent-nightly workflow continues to authenticate with the same GitHub App and the same Jira credentials after this migration.

## Migration checklist (for forks or sibling repos)

If you run a similar workflow that uses `actions/create-github-app-token`:

1. Replace `app-id: ${{ secrets.GITHUB_APP_ID }}` with `client-id: ${{ secrets.GITHUB_APP_CLIENT_ID }}` (or whichever secret holds the client ID).
2. Audit your `secrets.*` references for non-sensitive values (usernames, project keys, display names, email addresses). Move them to `vars.*`.
3. Keep actual credentials (`*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`) in Secrets.
