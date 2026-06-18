---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: migrate `app-id` → `client-id` and `JIRA_EMAIL` secret → variable

**Date:** 2026-06-01  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Companion:** engineering-docs-agent plugin PR #91

## Context

`docs-agent-nightly.yml` mints a short-lived GitHub App installation token at
the start of every run so the agent can push branches and open PRs under the
bot identity rather than a personal access token. Token minting uses
`actions/create-github-app-token@v3`.

The step also injects `JIRA_EMAIL` into the job environment so the Jira
integration can construct Basic-auth headers when creating or transitioning
tickets.

Before this change the relevant lines read:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    app-id: ${{ secrets.DOCS_AGENT_APP_ID }}        # deprecated input
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

```yaml
env:
  JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}             # stored as a secret
```

## Decision

**Replace `app-id` with `client-id`** and **move `JIRA_EMAIL` from repository
secrets to repository variables.**

After the change:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

```yaml
env:
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

## Rationale

| Change | Reason |
| --- | --- |
| `app-id` → `client-id` | `app-id` is a deprecated input in `actions/create-github-app-token@v3`. Continued use of a deprecated field risks silent misrouting or a hard break on a future major version bump of the action. `client-id` is the current canonical input. |
| Secret → variable for `JIRA_EMAIL` | `JIRA_EMAIL` is an Atlassian account email address used as the username half of HTTP Basic auth. It is not a credential — it identifies an account but cannot authenticate one without the API token. Storing it as a repository secret was a misclassification of its sensitivity. Repository variables (`vars.*`) are the correct store for non-sensitive configuration that should still be kept out of the source tree. |

The `DOCS_AGENT_APP_CLIENT_ID` variable follows the same logic: the GitHub App
client ID is a public identifier (it appears in the App's settings page), not
a secret. Moving it to `vars.*` matches GitHub's own guidance on App-token
wiring.

## Pre-merge verification

Both repository variables must exist before the first workflow run that uses
them, or the `app-token` step exits non-zero and the whole job fails immediately.

Confirm with:

```bash
gh variable list --repo theoju/claude-code-self-assessment
# Expected entries:
#   DOCS_AGENT_APP_CLIENT_ID   <app-client-id>
#   JIRA_EMAIL                 <atlassian-account-email>
```

Setting them if absent:

```bash
gh variable set DOCS_AGENT_APP_CLIENT_ID --body "<client-id>" \
  --repo theoju/claude-code-self-assessment

gh variable set JIRA_EMAIL --body "<email>" \
  --repo theoju/claude-code-self-assessment
```

`DOCS_AGENT_APP_PRIVATE_KEY` and `JIRA_API_TOKEN` remain repository secrets —
they are actual credentials.

## Current state of the workflow

After PR #111 the token-generation step in
`.github/workflows/docs-agent-nightly.yml` reads:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The `JIRA_EMAIL` env var is injected at the job level:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

No other job steps were changed; this was a pure credential-classification
and input-name migration with no behavioral effect.
