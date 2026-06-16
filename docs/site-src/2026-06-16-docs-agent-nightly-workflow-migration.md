---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly workflow migration: `app-id` → `client-id` and `JIRA_EMAIL` to Variables

**Date:** 2026-06-16  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Workflow:** `.github/workflows/docs-agent-nightly.yml`

## What changed

Two independent configuration corrections landed together in PR #111:

| Field | Before | After | Storage tier |
|---|---|---|---|
| GitHub App token input | `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` | Secret → **Variable** |
| Jira account email | `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` | Secret → **Variable** |

The `private-key` input to `actions/create-github-app-token@v3` remains a Secret — it is a real credential.

## Why

### `app-id` deprecation

`actions/create-github-app-token@v3` deprecated the `app-id` input in favour of `client-id`. Leaving the deprecated form in place would eventually hard-fail nightly workflow runs as the upstream action enforces the migration. The `client-id` value is a non-sensitive GitHub App identifier; it belongs in repository Variables rather than Secrets.

The companion plugin PR (#91 at `91e9b6c`) confirmed both repository Variables (`DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL`) were present before merge.

### `JIRA_EMAIL` is not a secret

`JIRA_EMAIL` is a plain Atlassian account email used as the basic-auth username in Jira API calls — not a credential. Storing it in Secrets added unnecessary secret sprawl without any security benefit. GitHub Variables are the correct tier for non-sensitive CI configuration values.

## Post-migration state

After PR #111, the `author` job environment block reads:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

And the token step:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The distinction between the three repository Secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `JIRA_API_TOKEN`, `DOCS_AGENT_APP_PRIVATE_KEY`) and the two Variables (`DOCS_AGENT_APP_CLIENT_ID`, `JIRA_EMAIL`) now reflects the actual sensitivity of each value.

## Operational notes

If a nightly run fails with a token-related error after this change, verify that both Variables exist under **Settings → Secrets and variables → Actions → Variables** (not Secrets). A common mistake during onboarding is adding `DOCS_AGENT_APP_CLIENT_ID` as a Secret instead of a Variable, which causes `vars.DOCS_AGENT_APP_CLIENT_ID` to resolve as an empty string and the `actions/create-github-app-token` step to reject the token request.

The `JIRA_API_TOKEN` stays in Secrets — it is the actual API credential for Jira writes (transitions, comments). Do not move it.

---

> **Note:** No `operations/` directory currently exists under the core lens docs. Consider creating `docs/site-src/operations/` to house future CI/CD runbook-style notes like this one.
