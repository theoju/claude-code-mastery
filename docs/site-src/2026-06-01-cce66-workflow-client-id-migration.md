---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# CCE-66: `app-id` → `client-id` migration for docs-agent nightly workflow

PR #111 updated `.github/workflows/docs-agent-nightly.yml` to track the current
`actions/create-github-app-token@v3` input contract and moved one non-secret
configuration value to the correct storage surface. Both changes are two-line
edits with no logic impact on nightly runs.

## What changed

### 1. `app-id` → `client-id` in `actions/create-github-app-token@v3`

The `app-id` input is deprecated upstream. Workflows that continue to use it
will eventually break when the action drops backward compatibility. The
replacement is `client-id`, which maps to the same GitHub App client identifier
but uses the current field name.

Before:

```yaml
- uses: actions/create-github-app-token@v3
  with:
    app-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

After:

```yaml
- uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The companion plugin-side change landed in `theoju/engineering-docs-agent` PR #91
at the same time. Both sides must be on `client-id` together — a mixed state
where the workflow uses the new field while the plugin references the old one
(or vice versa) is harmless today but confusing to audit.

### 2. `JIRA_EMAIL` from Secrets → Variables

`JIRA_EMAIL` is the username half of a Jira Basic-auth pair (the password
is `JIRA_API_TOKEN`, which stays in Secrets). A username is not a credential.
Storing it in Secrets was unnecessarily restrictive: Secrets values are
masked in logs even when that masking serves no security purpose, and they
cannot be inspected after creation (making debugging harder). Variables are
the correct surface for non-sensitive configuration.

The variable was verified present in the repo's Variables before the PR
merged; no gap in nightly runs occurred.

## Repository variables required

Future operators onboarding a new repo environment need these three values
set before the nightly workflow will run:

| Surface           | Name                      | What it holds                                      |
| ----------------- | ------------------------- | -------------------------------------------------- |
| Repository Vars   | `DOCS_AGENT_APP_CLIENT_ID` | GitHub App client ID for `create-github-app-token` |
| Repository Vars   | `JIRA_EMAIL`              | Jira basic-auth username (non-sensitive)           |
| Repository Secrets | `DOCS_AGENT_APP_PRIVATE_KEY` | GitHub App private key (PEM format)            |
| Repository Secrets | `JIRA_API_TOKEN`          | Jira API token (password half of basic-auth)       |

`DOCS_AGENT_APP_CLIENT_ID` was already a Variable before this PR; `JIRA_EMAIL`
moved from Secrets to Variables in this change.

## No user-visible impact

The docs site build, nightly page generation, and the Jira integration all
behave identically. This is a pure CI infrastructure tidy-up: deprecated input
removed, storage surface corrected.
