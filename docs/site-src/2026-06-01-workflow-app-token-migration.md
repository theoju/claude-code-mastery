---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Workflow: App Token Migration (`app-id` → `client-id`, `JIRA_EMAIL` reclassification)

**Date:** 2026-06-01  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Companion:** [theoju/engineering-docs-agent#91](https://github.com/theoju/engineering-docs-agent/pull/91)

## What changed

Two lines in `.github/workflows/docs-agent-nightly.yml`:

1. **`app-id` → `client-id`** in the `actions/create-github-app-token@v3` step.  
   Before:
   ```yaml
   with:
     app-id: ${{ secrets.DOCS_AGENT_APP_ID }}
     private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
   ```
   After:
   ```yaml
   with:
     client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
     private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
   ```

2. **`JIRA_EMAIL` moved from a Secret to a Variable.**  
   Before: `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}`  
   After: `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}`

## Why

### `app-id` deprecation

`actions/create-github-app-token@v3` deprecated the `app-id` input in favour of `client-id`. Continuing to use the old field would eventually cause the token-creation step to hard-fail on every nightly run. The `client-id` value comes from the GitHub App's settings page (under "General" → "Client ID") — it is distinct from the numeric App ID and is now the canonical identifier the action expects.

Because `client-id` is not a secret (it's visible in the GitHub App's public profile), the natural storage class is a repository **Variable** (`vars.DOCS_AGENT_APP_CLIENT_ID`), not a Secret.

### `JIRA_EMAIL` reclassification

`JIRA_EMAIL` is the username half of Jira basic authentication — it is an email address, not a credential. Storing it as a Secret was unnecessarily restrictive: Secrets are masked in logs and unavailable to fork PRs, which adds friction with zero security benefit for a non-sensitive value. Moving it to a Variable (`vars.JIRA_EMAIL`) aligns storage class with sensitivity level. The credential half (`JIRA_API_TOKEN`) remains a Secret.

## Repository configuration required before the workflow runs

The workflow now depends on two repository **Variables** (Settings → Secrets and variables → Variables) in addition to the existing Secrets. Verify these are present before merging or manually dispatching:

| Name | Type | Value |
|------|------|-------|
| `DOCS_AGENT_APP_CLIENT_ID` | Variable | The GitHub App's Client ID (from the App's General settings page) |
| `JIRA_EMAIL` | Variable | The Atlassian account email used for Jira basic auth |

The following Secrets remain unchanged:

| Name | Type |
|------|------|
| `DOCS_AGENT_APP_PRIVATE_KEY` | Secret |
| `JIRA_API_TOKEN` | Secret |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret |

If `DOCS_AGENT_APP_CLIENT_ID` is missing, the "Generate GitHub App installation token" step fails immediately with a missing-input error and the run exits before any authoring work starts.

## Non-breaking

This change is fully non-breaking for the workflow's authoring behaviour. Token scope, permissions, and all downstream steps are identical. The only observable difference is the input name used to identify the GitHub App and the storage class of the Jira email.
