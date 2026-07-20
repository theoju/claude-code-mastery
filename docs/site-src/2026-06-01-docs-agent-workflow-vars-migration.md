---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: repo Variables, not Secrets, for non-sensitive workflow config

**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111) · **Jira:** CCE-66

## Context

`.github/workflows/docs-agent-nightly.yml` — the nightly docs-agent run —
authenticates as a GitHub App and talks to Jira. Two of its inputs were
mis-classified:

- The App-token step (`actions/create-github-app-token@v3`) was passing
  `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}`. Upstream deprecated the
  `app-id` input in favor of `client-id`.
- `JIRA_EMAIL` was stored as a repo **Secret**, even though it's a
  basic-auth *username* (paired with `JIRA_API_TOKEN`, which is the actual
  credential) — not sensitive on its own.

## Decision

1. Swap the App-token step to `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}`.
2. Move `JIRA_EMAIL` from a Secret to a repo **Variable**, referenced as
   `${{ vars.JIRA_EMAIL }}`.

Current shape in `docs-agent-nightly.yml`:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
steps:
  - name: Generate GitHub App installation token
    id: app-token
    uses: actions/create-github-app-token@v3
    with:
      client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
      private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`DOCS_AGENT_APP_PRIVATE_KEY` and `JIRA_API_TOKEN` stay Secrets — those are
actual credentials. `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL` are
identifiers, not credentials, so they belong in Variables.

## Why this shape

- **Upstream forced the first half.** `actions/create-github-app-token@v3`
  deprecated `app-id`; staying current means moving to `client-id`.
- **The second half is a classification fix, not a functional change.**
  Secrets and Variables are both settable per-repo, but Secrets are
  redacted in logs and encrypted at rest — machinery that a basic-auth
  username doesn't need and that makes debugging a misconfigured value
  harder (you can't just look at it). Variables are the right home for
  config that's non-sensitive but still per-repo (App client-id, a Jira
  account email).
- **Matches the companion plugin PR.** `engineering-docs-agent` PR #91 made
  the equivalent change in its own workflow template, so the two stay
  consistent — this repo's nightly workflow is derived from that plugin's
  battle-tested version (see the header comment in
  `docs-agent-nightly.yml`).

## Convention going forward

When adding a new input to `docs-agent-nightly.yml` (or any workflow),
classify it before wiring it in:

| Question                                            | Answer → |
| ---------------------------------------------------- | -------- |
| Does exposure of this value grant access to anything? | Secret   |
| Is it just an identifier/config value (an ID, an email, a flag)? | Variable |

Both required repo Variables (`DOCS_AGENT_APP_CLIENT_ID`, `JIRA_EMAIL`) were
confirmed set before this PR merged — the workflow has no fallback if
either is missing, so a future onboarding of this workflow to a new repo
needs both configured under **Settings → Secrets and variables → Actions →
Variables** ahead of the first scheduled run.

## Scope

Confined to CI workflow configuration — one file, no application code
touched. `docs-agent-nightly.yml` is currently the only workflow file in
this repo (the rest of the test suite runs via `package.json` scripts,
locally and elsewhere in CI), so this decision applies narrowly today but
sets the pattern for any workflow files that follow.
