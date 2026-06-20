---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Workflow: `app-id` → `client-id` and `JIRA_EMAIL` secret → variable (PR #111)

Two one-line changes to `.github/workflows/docs-agent-nightly.yml`, both
hygiene-only — no user-visible product behavior changed.

## What changed

### `actions/create-github-app-token@v3`: `app-id` → `client-id`

The `app-id` input was deprecated upstream. The workflow's token-generation
step now reads the repo variable `DOCS_AGENT_APP_CLIENT_ID` via the current
`client-id` input:

```yaml
# before
app-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}

# after (PR #111)
client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
```

The repo variable name (`DOCS_AGENT_APP_CLIENT_ID`) did not change — only the
input key passed to the action. Continuing to use `app-id` risks breakage when
a future version of `actions/create-github-app-token` drops the deprecated
input entirely.

### `JIRA_EMAIL`: secret → repo variable

Atlassian basic-auth uses an email address as the username. An email address
is not a credential — it has no intrinsic secret value, and storing it as a
GitHub secret consumes a secret slot unnecessarily. PR #111 moved it from
`secrets.JIRA_EMAIL` to `vars.JIRA_EMAIL`:

```yaml
# before
JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}

# after (PR #111)
JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

The corresponding `JIRA_API_TOKEN` remains a secret because it is an actual
credential. `DOCS_AGENT_APP_PRIVATE_KEY` likewise stays secret (RSA private
key). Only the email address was reclassified.

## Prerequisite

Companion plugin PR #91 (merged at `91e9b6c` in `theoju/engineering-docs-agent`)
is the prerequisite: it established the `DOCS_AGENT_APP_CLIENT_ID` repo
variable name and confirmed both `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL`
were present as repo variables before this workflow change merged.

## Where to look

The live workflow is at `.github/workflows/docs-agent-nightly.yml`. The
relevant blocks after PR #111:

- **Token generation step** (line 44–49): `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}`
- **Job-level `env` block** (line 39–43): `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}`

When onboarding a new fork, set both as **repository variables** (not secrets)
under Settings → Secrets and variables → Variables. `JIRA_API_TOKEN` goes
under Secrets.
