---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Nightly workflow auth migration (CCE-66)

**Date:** 2026-06-01  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Scope:** CI/infrastructure — no user-visible dashboard behaviour change.

## What changed

Two lines in `.github/workflows/docs-agent-nightly.yml`:

1. **GitHub App token generation** — the workflow now reads the App client ID from the repository variable `vars.DOCS_AGENT_APP_CLIENT_ID` instead of a previously hardcoded or secret-stored value. Token generation uses the client-id-based flow, matching the current GitHub App credential convention.

2. **Jira email** — `JIRA_EMAIL` is now sourced from `vars.JIRA_EMAIL` (a repository-level variable) rather than being hardcoded or stored as a secret.

## Why

Both changes align the nightly workflow with updated credential conventions across the monorepo and the `engineering-docs-agent` plugin:

- **Client-id-based App tokens** are the preferred pattern for GitHub App auth going forward; secret-based alternatives add rotation overhead and sprawl.
- **Repository variables for non-sensitive config** (like an email address) reduce unnecessary secret usage and make the value visible in the Actions UI without requiring secret rotation ceremonies.

Together they reduce secret sprawl and make the credential surface easier to audit and maintain.

## Impact on you

None, if you're using the dashboard locally. The nightly workflow runs in CI to rebuild the published docs site (`theoju.github.io/claude-code-self-assessment/`). The scoring engine, the dashboard at `localhost:3737`, and all `npm run assess` / `npm run dev` flows are unaffected.

If you're operating a fork that runs this workflow, update your repository:

| Variable | Kind | Value |
| --- | --- | --- |
| `DOCS_AGENT_APP_CLIENT_ID` | Repository variable (`vars.*`) | Your GitHub App's client ID |
| `JIRA_EMAIL` | Repository variable (`vars.*`) | The Jira account email for API calls |

No secrets need to be removed — the workflow simply no longer reads them for these two fields. Existing `DOCS_AGENT_APP_PRIVATE_KEY` and any other secrets remain in place.
