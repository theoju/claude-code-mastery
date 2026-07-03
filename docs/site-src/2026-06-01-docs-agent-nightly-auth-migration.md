---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: migrate docs-agent-nightly auth inputs off deprecated fields

## Context

`.github/workflows/docs-agent-nightly.yml` mints its GitHub App installation
token via `actions/create-github-app-token@v3` and authenticates against Jira
via basic auth (`JIRA_EMAIL` + `JIRA_API_TOKEN`). Both inputs were originally
wired to repo **Secrets**:

- `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}` — the field `actions/create-github-app-token@v3`
  deprecated upstream in favor of `client-id`.
- `JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}` — an email address used as a basic-auth
  *username*, not a credential. It doesn't need Secret-level access
  restrictions.

## Decision

PR #111 moved both inputs to repo **Variables**:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

```yaml
env:
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`private-key` and `JIRA_API_TOKEN` stay on Secrets — they're genuine
credentials. Only the App's `client-id` and the Jira account's email moved.

This mirrors the companion change already merged in the
`engineering-docs-agent` plugin itself (plugin PR #91), so the workflow's auth
shape now matches the plugin it vendors in via the "Check out
engineering-docs-agent plugin" step.

## Consequences

- **Both `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL` must exist as repo
  Variables before the nightly run**, or the "Generate GitHub App
  installation token" step hard-fails at the top of the job — before
  checkout, before the orchestrator runs at all. Verify with:

  ```bash
  gh variable list --repo <owner>/<repo>
  ```

- `secrets.DOCS_AGENT_APP_ID` is no longer read anywhere in this workflow;
  it's safe to delete once you've confirmed `DOCS_AGENT_APP_CLIENT_ID` is set,
  but leaving the old secret in place is harmless (unread inputs don't fail
  the run).
- No change to `DOCS_AGENT_APP_PRIVATE_KEY`, `JIRA_API_TOKEN`, or
  `CLAUDE_CODE_OAUTH_TOKEN` — those remain Secrets, and the token-format
  assertion step (`Assert OAuth token is configured and well-formed`) is
  unaffected.
- **Onboarding note for any future repo running this workflow**: the same
  two Variables need to be seeded before the first scheduled or
  `workflow_dispatch` run, the same way `DOCS_AGENT_APP_PRIVATE_KEY` and
  `JIRA_API_TOKEN` need to be seeded as Secrets.

## References

- Workflow: `.github/workflows/docs-agent-nightly.yml`
- PR #111 (this repo)
- Companion change: `theoju/engineering-docs-agent` PR #91
