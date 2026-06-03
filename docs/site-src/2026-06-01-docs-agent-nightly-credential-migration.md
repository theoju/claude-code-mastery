---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Nightly workflow credential migration — `client-id` and `vars.JIRA_EMAIL`

PR #111 (CCE-66) made two small edits to
`.github/workflows/docs-agent-nightly.yml`. Neither change affects
dashboard behavior or scoring; both are operational conventions that
future workflow maintainers need to know.

## What changed

| Field | Before | After |
| --- | --- | --- |
| GitHub App auth key | `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` |
| Jira service-account email | `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` |

### GitHub App authentication — `app-id` → `client-id`

The `actions/create-github-app-token` action updated its field name from
`app-id` to `client-id` in a recent major version. The nightly workflow
was pinned to the old name, causing auth failures once the action
version advanced. The fix is a one-field rename and a corresponding
variable rename in the repository's **Variables** settings
(`vars.DOCS_AGENT_APP_CLIENT_ID`).

If you are onboarding this workflow to a new repository, set
`DOCS_AGENT_APP_CLIENT_ID` under **Settings → Secrets and variables →
Actions → Variables** (not Secrets). The value is the GitHub App's
numeric client ID, visible on the app's settings page.

### Jira email — secret → variable

`JIRA_EMAIL` holds the service-account email used to authenticate
against the Jira REST API. Because an email address is not sensitive
credential material, it was moved from **Secrets** to **Variables**
(`vars.JIRA_EMAIL`). The actual API token (`JIRA_API_TOKEN`) remains a
secret.

To reconfigure on a new repository:

1. **Variables** → add `JIRA_EMAIL` = `<service-account>@example.com`
2. **Secrets** → confirm `JIRA_API_TOKEN` is present (unchanged)
3. **Variables** → confirm `DOCS_AGENT_APP_CLIENT_ID` is present

## No user-visible impact

The migration is purely CI configuration. The docs-agent nightly build,
the dashboard, and all scoring behavior are unaffected. The only
observable difference is that the workflow run succeeds where it
previously would have failed on authentication with the stale `app-id`
field name.
