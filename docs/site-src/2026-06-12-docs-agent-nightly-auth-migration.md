---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# docs-agent-nightly: auth configuration migration (2026-06-12)

Two one-line substitutions in `.github/workflows/docs-agent-nightly.yml` — one
for the GitHub App token step, one for the Jira email env var. No behavior
changes at runtime; both substitutions improve hygiene and align the workflow
with current upstream conventions.

## What changed

### 1. GitHub App token: `app-id` → `client-id`

```diff
  uses: actions/create-github-app-token@v3
  with:
-   app-id: ${{ secrets.DOCS_AGENT_APP_ID }}
+   client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`actions/create-github-app-token` updated its input schema to prefer
`client-id` over the older `app-id` field. The value moved from a repository
**secret** (`secrets.DOCS_AGENT_APP_ID`) to a repository **variable**
(`vars.DOCS_AGENT_APP_CLIENT_ID`). A GitHub App's client ID is not sensitive —
it is visible in the App's public settings page — so storing it as a secret
was unnecessary. Using a variable makes it inspectable in the repo's
*Settings → Variables* UI without needing to rotate or re-enter it.

### 2. Jira email: secret → variable

```diff
  env:
    CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
-   JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
+   JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

An email address used as a Jira API username is not a credential. Promoting it
from a secret to a variable follows least-privilege hygiene: secrets are
encrypted at rest and masked in logs, which is the right treatment for tokens
and private keys but adds unnecessary friction for a value that carries no
confidentiality requirement. The variable is now visible and editable in
*Settings → Variables* without a secret rotation flow.

## What did not change

- The `JIRA_API_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` values remain secrets — both are
  genuine credentials.
- `DOCS_AGENT_APP_PRIVATE_KEY` remains a secret — the RSA private key must stay
  encrypted.
- Workflow scheduling, concurrency settings, permissions, steps, and all other
  environment variables are unchanged.
- There is no user-visible behavior impact: the App token is generated the same
  way; the Jira integration receives the same email value.

## Repository settings checklist

If you are onboarding a fork or a new host repo, set these values before the
first nightly run:

| Setting | Kind | Key | Notes |
|---|---|---|---|
| GitHub App client ID | **Variable** | `DOCS_AGENT_APP_CLIENT_ID` | From the App's *General* page |
| GitHub App private key | **Secret** | `DOCS_AGENT_APP_PRIVATE_KEY` | PEM, generated in the App settings |
| Jira email | **Variable** | `JIRA_EMAIL` | The account used for the Jira API token |
| Jira API token | **Secret** | `JIRA_API_TOKEN` | Generated at id.atlassian.net |
| Claude OAuth token | **Secret** | `CLAUDE_CODE_OAUTH_TOKEN` | `sk-ant-oat…` from `claude setup-token` |
