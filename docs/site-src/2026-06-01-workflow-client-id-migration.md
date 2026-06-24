---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: Migrate `docs-agent-nightly` to `client-id` and Repo Variables

**Ticket:** CCE-66  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Date:** 2026-06-01  
**Breaking:** No

## Context

`.github/workflows/docs-agent-nightly.yml` authenticates as the docs-agent GitHub App using
`actions/create-github-app-token@v3`. That action deprecated the `app-id` input in favour of
`client-id` in a recent major revision. Continuing to pass `app-id` risks a breakage the next
time the action version is pinned forward.

Separately, `JIRA_EMAIL` was stored as a repo **Secret**. Secrets are encrypted at rest and
masked in logs — appropriate for credentials. A Jira email address is a basic-auth username,
not a credential; storing it in Secrets adds operational friction (it must be re-entered as an
encrypted value, cannot be inspected after creation) with no security benefit.

## Decision

Two targeted edits to `.github/workflows/docs-agent-nightly.yml`:

| Line | Before | After |
|------|--------|-------|
| App token step | `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` | `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` |
| `JIRA_EMAIL` env var | `${{ secrets.JIRA_EMAIL }}` | `${{ vars.JIRA_EMAIL }}` |

The App client ID also moves from Secrets to repo **Variables** (`vars.DOCS_AGENT_APP_CLIENT_ID`),
consistent with the upstream companion change in the engineering-docs-agent plugin (PR #91,
`91e9b6c`).

## Rationale

- **`client-id` is the current `actions/create-github-app-token@v3` API.** The deprecated
  `app-id` input maps to the same value but may be removed in a future release. Aligning now
  eliminates the risk.
- **Repo Variables vs. Secrets is a semantic contract, not just a policy preference.** GitHub
  Actions distinguishes Variables (visible, inspectable in settings) from Secrets (encrypted,
  never echoed). A username belongs in Variables; using Secrets for it is a mis-categorization
  that obscures what the repo is actually protecting.
- **No behaviour change.** `create-github-app-token@v3` issues the same installation token
  regardless of which input name is used while both are accepted. The `JIRA_EMAIL` value that
  reaches the Atlassian API call is identical — only its storage category changes.

## Required repo configuration

After this change, the workflow requires:

| Kind | Name | Value |
|------|------|-------|
| Variable | `DOCS_AGENT_APP_CLIENT_ID` | GitHub App client ID (e.g. `Iv1.…`) |
| Variable | `JIRA_EMAIL` | Jira account email for basic-auth (e.g. `you@example.com`) |
| Secret | `DOCS_AGENT_APP_PRIVATE_KEY` | GitHub App RSA private key (PEM) |
| Secret | `JIRA_API_TOKEN` | Jira API token |
| Secret | `CLAUDE_CODE_OAUTH_TOKEN` | Claude OAuth token (`sk-ant-oat…`) |

The private key and API tokens remain Secrets. Only the two non-sensitive identifiers are
promoted to Variables.

## Status

Merged. The workflow at `.github/workflows/docs-agent-nightly.yml` lines 42 and 48 reflect the
post-migration state (`vars.JIRA_EMAIL` and `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}`).
