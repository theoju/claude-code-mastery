---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: migrate `docs-agent-nightly` auth inputs from secrets to vars

**Date:** 2026-06-17  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Files changed:** `.github/workflows/docs-agent-nightly.yml`

## What changed

Two authentication inputs in the `docs-agent-nightly` workflow were reclassified from GitHub Secrets to GitHub Variables (repository `vars`):

| Input | Before | After | Reason |
|---|---|---|---|
| `DOCS_AGENT_APP_CLIENT_ID` | `secrets.DOCS_AGENT_APP_CLIENT_ID` | `vars.DOCS_AGENT_APP_CLIENT_ID` | Upstream `actions/create-github-app-token@v3` deprecated `app-id`; the replacement input is `client-id`, and a client ID is a non-secret identifier |
| `JIRA_EMAIL` | `secrets.JIRA_EMAIL` | `vars.JIRA_EMAIL` | A Jira email is a basic-auth username, not a credential — storing it as a secret was a misclassification |

`JIRA_API_TOKEN` and `DOCS_AGENT_APP_PRIVATE_KEY` remain under `secrets`, which is correct: they are actual credentials.

The concrete diff in `.github/workflows/docs-agent-nightly.yml`:

```yaml
# GitHub App token step — before
uses: actions/create-github-app-token@v3
with:
  app-id: ${{ secrets.DOCS_AGENT_APP_CLIENT_ID }}     # deprecated input name
  private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}

# After
uses: actions/create-github-app-token@v3
with:
  client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}     # upstream-required input name
  private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

```yaml
# JIRA_EMAIL env var — before
env:
  JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}

# After
env:
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

## Why it matters

**`app-id` deprecation.** The upstream action `actions/create-github-app-token@v3` stopped accepting `app-id` as an input name; the required input is now `client-id`. Using the deprecated name causes the step to fail or produce unexpected behavior depending on the action version in use. The rename is a required conformance fix, not a preference.

**Secret misclassification.** GitHub Secrets are for values that must be redacted in logs and never exposed — API keys, tokens, private keys. A Jira email address is a username used in basic auth. Storing it under `secrets` grants it protection it doesn't need, adds friction when rotating (secrets require re-entry through the UI; vars can be updated in bulk), and signals to future maintainers that the value is sensitive when it is not. Moving it to `vars` aligns intent with implementation.

Both repository variables (`DOCS_AGENT_APP_CLIENT_ID` under `vars`, `JIRA_EMAIL` under `vars`) were confirmed present in the repo before this PR merged. No manual secret rotation or re-entry was required — only the workflow reference changed.

## No user-visible impact

The docs-agent nightly pipeline behavior is unchanged. The GitHub App still authenticates with the same private key; the Jira integration still uses the same token. The only difference is where GitHub resolves the client ID and email from during a workflow run.

## Companion change

The plugin side of this wiring was updated in `theoju/engineering-docs-agent` PR #91. That PR aligned the plugin's own workflow to the same `client-id` / `vars` convention. This PR closes the loop on the host repo's workflow copy.

## Decision rationale

Use `vars` for identifiers and usernames that do not need log redaction. Use `secrets` only for tokens, passwords, and private keys. When an upstream action renames a required input, update the call site at the same time — leaving a deprecated input name in place is a latent breakage waiting for the action to drop backward compatibility.
