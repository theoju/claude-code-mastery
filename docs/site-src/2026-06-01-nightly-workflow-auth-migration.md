---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly workflow: migrate off deprecated secrets to repo Variables

`docs-agent-nightly.yml` (the workflow that drives the engineering-docs-agent's
nightly authoring run) carried two credentials that had drifted out of the
right storage class. PR #111 (CCE-66) moved both to GitHub Actions Variables.

## What changed

**GitHub App token step.** `actions/create-github-app-token@v3` deprecated its
`app-id` input in favor of `client-id`. The workflow's token-generation step
now reads:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

`client-id` is sourced from a repo **Variable** (`vars.DOCS_AGENT_APP_CLIENT_ID`),
not a Secret — the App's client ID isn't sensitive on its own; the private key
stays a Secret and is unaffected.

**Jira sync step.** The `JIRA_EMAIL` env var feeding the nightly's Jira wiring
moved the same direction, at the job level:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_EMAIL` is the basic-auth *username* half of the Jira API credential
pair, not a credential itself — `JIRA_API_TOKEN` remains the actual secret.
Storing the email as a Variable rather than a Secret reflects that.

## Why

Both moves are the same underlying judgment call: not everything read from
`${{ secrets.* }}` is actually secret. `app-id`/`client-id` and an account
email are both identifiers, not bearer credentials — Secrets are masked in
logs and access-restricted for a reason that doesn't apply to either value.
Filing them as Variables instead is more honest about their sensitivity and
keeps the Secrets list limited to things that would actually cause harm if
logged.

The `create-github-app-token@v3` half is also just keeping current with
upstream: `app-id` is a deprecated input name, and `client-id` is the
supported one going forward.

## Rollout note

Both `vars.DOCS_AGENT_APP_CLIENT_ID` and `vars.JIRA_EMAIL` were verified to
exist in the repo's Variables before this PR merged. A GitHub Actions
Variable that doesn't exist resolves to an empty string rather than failing
the workflow parse — so an unverified rename here would have surfaced as a
nightly hard-fail at the app-token step (empty `client-id`) instead of a
merge-time error. Confirm the Variable exists first if you're porting this
pattern to another repo's workflow.

## Scope

Single-file change to `.github/workflows/docs-agent-nightly.yml` — no
application code, no scoring logic, no user-facing dashboard behavior. Filed
as a flat dated note rather than nested under an operations or architecture
section because no such section exists yet under this lens.
