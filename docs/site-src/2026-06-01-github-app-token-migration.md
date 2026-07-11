---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# GitHub App token: `app-id` → `client-id`, and `JIRA_EMAIL` becomes a Variable

PR #111 touches one workflow, `.github/workflows/docs-agent-nightly.yml` — the
job that runs the engineering-docs-agent's nightly authoring pass and needs
write access to push a `docs-agent/YYYY-MM-DD` branch and open/append to a PR.

## What changed

The `Generate GitHub App installation token` step (`actions/create-github-app-token@v3`)
now authenticates with:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`app-id: secrets.DOCS_AGENT_APP_ID` is gone. `client-id` now reads from
`vars.DOCS_AGENT_APP_CLIENT_ID` — a repo **Variable**, not a Secret.

Separately, `JIRA_EMAIL` moved off the Secrets list too. The job's `env:`
block now reads:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_API_TOKEN` (the actual credential) stays a Secret.
`DOCS_AGENT_APP_PRIVATE_KEY` stays a Secret too — nothing about the
private-key handling changed. Only `client-id`/`app-id` and `JIRA_EMAIL`
moved from Secret to Variable.

## Why

- `app-id` is the deprecated input on `actions/create-github-app-token@v3`;
  `client-id` is upstream's replacement. This is a straight follow-the-API
  migration, not a behavior change to the token's scope or permissions.
- `JIRA_EMAIL` is a basic-auth **username**, not a credential — pairing it
  with `JIRA_API_TOKEN` under Secrets was a misclassification. Repo
  Variables are visible in the Actions UI (unlike Secrets, which are
  write-only after creation), so moving it there makes the workflow easier
  to audit without weakening anything: the actual secret half of the
  Jira basic-auth pair (`JIRA_API_TOKEN`) is untouched.

Neither change alters what the token can do or who can read it — App
installation permissions are still `contents: write`, `pull-requests:
write`, `issues: read` per the job's top-level `permissions:` block.

## Before this lands: repo Variables required

This is a config-and-code pairing, not a code-only change. The workflow
change is inert until the repository has these two Variables set
(Settings → Secrets and variables → Actions → Variables):

- `DOCS_AGENT_APP_CLIENT_ID`
- `JIRA_EMAIL`

Without them, `create-github-app-token@v3` fails to mint a token and the
nightly run fails before checkout. This was called out in the PR body as a
Phase 1.5 verification step — confirm both Variables exist before merging,
or immediately after, before the next scheduled `7 7 * * *` UTC fire.

## A note on where this page lives

At the time of writing, the `core` lens has no `operations` or `archive`
section under `docs/site-src/` — only `images/`. This page is placed as a
flat dated slug at the lens root rather than nested under a subsection that
doesn't exist yet.
