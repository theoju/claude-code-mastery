---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Jira auth migration: `app-id` → `client-id`, and why `JIRA_EMAIL` moved to Variables

`.github/workflows/docs-agent-nightly.yml` generates its GitHub App
installation token with `actions/create-github-app-token@v3`. As of PR #111,
that step's `with:` block reads:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

## What changed

Two independent fixes landed in the same PR, both touching how the nightly
job authenticates:

1. **`app-id` → `client-id`.** `actions/create-github-app-token@v3` deprecated
   the `app-id` input in favor of `client-id`, which is the maintained
   equivalent field for identifying the GitHub App. The workflow now reads
   the App's client ID from a repo **Variable**, `DOCS_AGENT_APP_CLIENT_ID`,
   rather than a secret.
2. **`JIRA_EMAIL` moved from Secrets to Variables.** The workflow's `env:`
   block sets `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` — no longer
   `secrets.JIRA_EMAIL`. `JIRA_API_TOKEN` stays a secret (`secrets.JIRA_API_TOKEN`);
   it's the actual bearer credential. `JIRA_EMAIL` is just the Atlassian
   account email used as the basic-auth username, which isn't sensitive on
   its own — storing it as a secret was needlessly hiding a value that's
   fine to see in workflow logs and run summaries.

Neither change touches `DOCS_AGENT_APP_PRIVATE_KEY`, which stays a secret
(`secrets.DOCS_AGENT_APP_PRIVATE_KEY`) — that's the actual private key
material for the GitHub App and is exactly the kind of value Secrets exist
to protect.

## Why

`app-id` is deprecated upstream in `actions/create-github-app-token@v3`;
`client-id` is what the action now expects. Nothing about the App's identity
or permissions changed — this is a field-rename migration to stay on the
maintained input.

The `JIRA_EMAIL` reclassification is a credential-hygiene cleanup: Secrets
and Variables in GitHub Actions aren't just two flavors of "config" — Secrets
are masked in logs and redacted from run output, Variables aren't. Using a
Secret for a value that isn't actually secret (a login email visible in any
Atlassian UI) buys no protection and costs auditability, since the value
never shows up anywhere for debugging.

## Setup requirement

This is CI/workflow-only config — no dashboard scoring, signals, or
user-facing behavior changed. But the nightly workflow now depends on two
repo **Variables** existing before it runs:

- `DOCS_AGENT_APP_CLIENT_ID`
- `JIRA_EMAIL`

If either is unset, the run fails at the token-generation or environment
step rather than silently falling back to the old secret-based values.
`JIRA_API_TOKEN` and `DOCS_AGENT_APP_PRIVATE_KEY` remain repo **Secrets** and
are unaffected by this migration.
