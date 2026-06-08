---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Workflow credential migration: `app-id` → `client-id` and `JIRA_EMAIL` to Variable

PR #111 made two small but forward-looking changes to
`.github/workflows/docs-agent-nightly.yml`. No application logic changed;
this is purely a credential-storage cleanup.

## What changed

### `app-id` → `client-id` for `actions/create-github-app-token@v3`

The nightly workflow uses `actions/create-github-app-token@v3` to mint a
short-lived token for the docs-agent. The action's `app-id` input — previously
read from a GitHub Secret — is deprecated upstream and will be removed in a
future release. PR #111 switches to the replacement `client-id` input and
backs it with a **repository Variable** rather than a Secret.

```yaml
# before
- uses: actions/create-github-app-token@v3
  with:
    app-id: ${{ secrets.DOCS_APP_ID }}
    private-key: ${{ secrets.DOCS_APP_PRIVATE_KEY }}

# after
- uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_APP_PRIVATE_KEY }}
```

The private key stays in Secrets because it is an actual credential. The
client ID is a non-sensitive identifier, so a Variable is the correct home.

### `JIRA_EMAIL` from Secret to Variable

`JIRA_EMAIL` is a basic-auth username — it identifies the Atlassian account
that the workflow authenticates as, but carries no secret material on its own.
Storing it in Secrets was unnecessarily restrictive (it obscures the value in
logs without adding security). PR #111 moves it to a repository Variable:

```yaml
# before
JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}

# after
JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

## What you need to do if you fork this repo

If you maintain a fork, make the matching changes in your repository settings:

1. **Remove** the `DOCS_APP_ID` and `JIRA_EMAIL` entries from **Settings →
   Secrets and variables → Actions → Secrets**.
2. **Add** `DOCS_APP_CLIENT_ID` and `JIRA_EMAIL` under **Settings → Secrets
   and variables → Actions → Variables**.
3. The `DOCS_APP_PRIVATE_KEY` secret stays in Secrets — do not move it.

Keeping a deprecated `app-id` Secret around doesn't break anything until
`actions/create-github-app-token` drops the parameter, but it will cause the
workflow to fail silently at that point rather than surfacing a schema error
upfront.

## Companion change

Plugin-side PR #91 in
[theoju/engineering-docs-agent](https://github.com/theoju/engineering-docs-agent/pull/91)
landed the matching update on the plugin's own workflow at the same time.
If you run the engineering-docs-agent in a separate repo, that PR covers
the plugin side — make sure both changes are applied together.
