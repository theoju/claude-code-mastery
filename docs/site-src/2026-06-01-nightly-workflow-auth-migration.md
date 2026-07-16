---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly docs-agent workflow: auth migration (PR #111)

`.github/workflows/docs-agent-nightly.yml` — the workflow that runs the
engineering-docs-agent orchestrator every night at 07:07 UTC — needed two
small auth-related fixes. Neither changes application code or user-facing
behavior; both are configuration corrections in the single workflow file.
Recorded here because both require repo Variables to exist before the next
scheduled run, and a missing Variable hard-fails the run at the app-token
step with no partial output.

## What changed

**1. `app-id` → `client-id` for GitHub App token generation.**
`actions/create-github-app-token@v3` deprecated the `app-id` input. The
"Generate GitHub App installation token" step now reads:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

**2. `JIRA_EMAIL` moved from a Secret to a Variable.**
`JIRA_EMAIL` is a plain account email used as the basic-auth username against
the Atlassian API — not a credential — so it doesn't belong in Secrets. It's
now sourced from `vars` alongside the App client ID:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_API_TOKEN` (the actual bearer credential) stays in Secrets. Only the
email moved.

## Why

`app-id` was already deprecated upstream; leaving it in place would have
worked until Actions removed the input outright, at which point the nightly
run fails opaquely at the token-generation step with no docs authored that
night. `JIRA_EMAIL` isn't sensitive — it's visible anyway in any Jira ticket
or comment the workflow creates — so keeping it in Secrets bought no security
benefit and cost repo-admin visibility (Variables show their value in the UI,
Secrets don't).

## Before merging a change like this

Both `client-id` and `JIRA_EMAIL` are read via `vars.*`, not `secrets.*`, so
they must exist as **repository Variables** (Settings → Secrets and
variables → Actions → Variables) before the workflow runs, or the run fails
at the "Generate GitHub App installation token" step with no fallback:

- `DOCS_AGENT_APP_CLIENT_ID`
- `JIRA_EMAIL`

If you're porting this pattern to another workflow, check whether an input
you're passing as a Secret is actually a non-sensitive identifier (a
username, an email, a numeric ID) — Secrets are for values that grant access
by themselves, not for values that are merely paired with a token that does.

## Scope

This was a single-file, workflow-only change
(`.github/workflows/docs-agent-nightly.yml`). No scoring logic, dashboard
code, or scripts under `scripts/` were touched. It doesn't affect
`npm run assess`, the Next.js app, or any of the twelve scoring dimensions —
it only affects the nightly docs-agent's ability to authenticate before it
starts writing.
