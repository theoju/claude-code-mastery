---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Workflow: `client-id` migration and `JIRA_EMAIL` de-secreting (PR #111 / CCE-66)

Two CI configuration changes landed together in PR #111 — neither touches
product behavior, but both affect what you need in your repository's
Variables and Secrets settings before the nightly docs-agent workflow runs
cleanly.

## `app-id` → `client-id` in `actions/create-github-app-token@v3`

The `app-id` input on `actions/create-github-app-token@v3` is deprecated
upstream. The docs-agent nightly workflow (`docs-agent-pages.yml`) was
updated to use the replacement `client-id` input instead:

```yaml
# before
- uses: actions/create-github-app-token@v3
  with:
    app-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}

# after
- uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The repository variable name (`DOCS_AGENT_APP_CLIENT_ID`) is unchanged —
only the YAML key in the workflow step changes.

The companion change on the plugin side landed in
[`theoju/engineering-docs-agent` PR #91](https://github.com/theoju/engineering-docs-agent/pull/91),
which carries the matching update for the plugin's own workflow templates.

## `JIRA_EMAIL` moved from Secrets to Variables

`JIRA_EMAIL` was previously stored as a repository _secret_. It is a
basic-auth username — the email address used as the Jira API account
identity — and carries no credential value on its own. It was moved to a
repository _variable_ to reflect that:

```yaml
# before
jira-email: ${{ secrets.JIRA_EMAIL }}

# after
jira-email: ${{ vars.JIRA_EMAIL }}
```

This follows least-privilege hygiene: secrets should be reserved for values
that grant access on their own (tokens, private keys, webhook URLs). An
email address paired with a separate API token does not meet that bar.

## Pre-merge verification requirement

Both repository-level Variables must be present **before** the workflow
runs, or the token-creation step will fail with a missing-input error. PR
#111 confirmed they were in place before merge:

| Variable                  | Type     | Value stored              |
| ------------------------- | -------- | ------------------------- |
| `DOCS_AGENT_APP_CLIENT_ID` | Variable | GitHub App client ID      |
| `JIRA_EMAIL`               | Variable | Jira account email address |

The repository secret `DOCS_AGENT_APP_PRIVATE_KEY` remains a secret (it is
an actual credential) and is unaffected by this change.

If you are onboarding a new fork or host repository, set both variables
under Settings → Secrets and variables → Actions → Variables before
enabling the nightly workflow.
