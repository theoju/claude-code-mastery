---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly workflow auth migration: `app-id` → `client-id`, `JIRA_EMAIL` → repo variable

`docs-agent-nightly.yml` (the workflow that drives the engineering-docs-agent's
nightly authoring run) changed how it authenticates as a GitHub App and how it
supplies the Jira account email. Neither change touches application code or
scoring behavior — this is an onboarding/CI-config change, tracked as CCE-66.

## What changed

**GitHub App token input.** The "Generate GitHub App installation token" step
uses `actions/create-github-app-token@v3`. It now passes:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`client-id` reads from a repo **Variable** (`DOCS_AGENT_APP_CLIENT_ID`), not a
secret. `app-id` (the previous input) is deprecated upstream by
`actions/create-github-app-token@v3`; `client-id` is its replacement. The
private key stays a secret, since it's the actual credential.

**`JIRA_EMAIL`.** The `author` job's env block now reads:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_EMAIL` moved from a secret to a repo variable. It's a basic-auth
username (the Atlassian account email), not a credential — `JIRA_API_TOKEN`
is the actual secret half of that pair. Storing a non-sensitive value as a
secret just hides it from run logs/summaries for no security benefit, so it
was reclassified.

## Why now

Both changes mirror a companion change already merged in the
engineering-docs-agent plugin repo (PR #91, same CCE-66 ticket) — this repo's
nightly workflow is derived from that plugin's dogfooded workflow (see the
top-of-file comment in `docs-agent-nightly.yml`), so the two are meant to
track each other rather than drift.

## Onboarding impact

This is the part that matters if you're setting up (or re-setting-up) the
nightly workflow on a repo: it now requires two repo **Variables**, not
secrets, to exist before the workflow can authenticate:

- `DOCS_AGENT_APP_CLIENT_ID`
- `JIRA_EMAIL`

`DOCS_AGENT_APP_PRIVATE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, and `JIRA_API_TOKEN`
remain repo **Secrets**. If either variable is missing, the "Generate GitHub
App installation token" step or the Jira-touching steps in the orchestrator
run will fail — check repo Settings → Secrets and variables → Actions →
Variables before assuming a token/permissions issue.

Not breaking in the sense of changing runtime behavior once configured; it
does change what a fresh clone or fork needs to provision before the nightly
run can succeed.
