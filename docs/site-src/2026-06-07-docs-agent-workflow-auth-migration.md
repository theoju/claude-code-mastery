---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Docs-agent nightly workflow: auth and credential migration (2026-06-07)

PR #111 updates two credential references in the docs-agent nightly workflow
(`.github/workflows/docs-agent-pages.yml`). No logic changed — this is a pure
configuration update that aligns the workflow with the companion plugin release
(engineering-docs-agent#91) and best-practice secrets-vs-variables separation.
Tracked under **CCE-66**.

## What changed

| Before | After |
| --- | --- |
| GitHub App auth parameter: `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` |
| Jira email: `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` | `JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` |

Both changes move non-sensitive configuration out of repository **Secrets** and
into repository **Variables** (`vars.*`). The GitHub App's client ID and your
Jira email address are not credentials — they identify the app and the actor,
but they don't authorize anything on their own. Keeping them in Secrets
conflates identification with authorization and makes rotation harder to audit.

## Why the auth parameter name changed

The `create-github-app-token` action (used to generate a short-lived
installation token for the nightly workflow) updated its input schema: the field
that previously accepted an app numeric ID (`app-id`) now takes the app's
`client-id` string. This reflects GitHub's own naming shift in the Apps API.
The accompanying secret value is different in kind (a human-readable client ID
string vs. a numeric app ID), so the backing store moves from `secrets.*` to
`vars.*` at the same time.

## What you need to do when onboarding a new host repo

1. Under **Settings → Secrets and variables → Actions → Variables**, add:
   - `DOCS_AGENT_APP_CLIENT_ID` — the GitHub App's client ID (find it on the
     app's settings page under "About" → "Client ID").
   - `JIRA_EMAIL` — the Jira account email the workflow posts comments as.

2. Under **Settings → Secrets and variables → Actions → Secrets**, ensure:
   - `DOCS_AGENT_APP_PRIVATE_KEY` — the PEM-encoded private key (stays a
     secret; this is what actually authorizes token generation).
   - `JIRA_API_TOKEN` — the Jira API token (stays a secret).

3. Remove any legacy `DOCS_AGENT_APP_ID` and `JIRA_EMAIL` entries from Secrets
   if they exist — they are no longer read by the workflow.

## Non-breaking

Existing repos that had `secrets.DOCS_AGENT_APP_ID` set will see the workflow
fail to authenticate after pulling this change, because the old secret name is
no longer referenced. Update the Variables store before merging to
`main` on any repo running the nightly workflow.

## References

- PR #111: [github.com/theoju/claude-code-self-assessment/pull/111](https://github.com/theoju/claude-code-self-assessment/pull/111)
- Companion plugin PR: engineering-docs-agent#91
- Jira ticket: CCE-66
