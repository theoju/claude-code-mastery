---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly workflow: GitHub App token migration + JIRA_EMAIL reclassification

`.github/workflows/docs-agent-nightly.yml` (the workflow that drives the
engineering-docs-agent's nightly authoring run) changed two things in PR #111:

1. The GitHub App installation-token step now authenticates with
   `client-id` instead of `app-id`.
2. `JIRA_EMAIL` moved from a repo **Secret** to a repo **Variable**.

## What changed

The "Generate GitHub App installation token" step
(`actions/create-github-app-token@v3`) reads:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

It used to pass `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}`. Upstream deprecated
the `app-id` input on `create-github-app-token@v3` in favor of `client-id`, so
this workflow had to move with it.

Separately, the job env block now reads `JIRA_EMAIL` from `vars` rather than
`secrets`:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

## Why

- **`client-id` migration**: `actions/create-github-app-token@v3` deprecated
  `app-id`. Continuing to pass `app-id` would have broken the token-generation
  step — and without a token, `actions/checkout@v5` can't authenticate as the
  App and every downstream step (commit, push, `gh pr create`) fails.
- **`JIRA_EMAIL` reclassification**: `JIRA_EMAIL` is a basic-auth *username*
  paired with `JIRA_API_TOKEN`, not a credential in its own right — knowing an
  account's email address doesn't grant access to anything. It was filed as a
  repo Secret by default caution, but it belongs with the other non-sensitive
  identifiers as a repo Variable. `JIRA_API_TOKEN` stays a Secret.

Both `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL` had to exist as repo
Variables *before* this PR merged — an unmerged variable would hard-fail the
app-token step (or silently pass an empty `JIRA_EMAIL` to the Jira client) on
the very next scheduled run at `07:07 UTC`.

## Related change

A companion migration landed in the engineering-docs-agent plugin repo
itself (PR #91) — the plugin's own nightly workflow needed the same
`client-id` swap, since it authenticates against the same GitHub App.

## Notes for future workflow docs

This is the first decision doc for a `.github/workflows/` change in this
repo's docs site. There's no dedicated `operations/` or `archive/` lens
section yet, so this page lives as a flat dated slug at the `core` lens
root. If workflow/ops-focused decision docs keep accumulating, route them
into a dedicated section instead of continuing to flatten them here.
