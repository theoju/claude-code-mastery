---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# docs-agent-nightly: App-token `client-id` migration + `JIRA_EMAIL` moved to a repo variable

PR #111 touches two auth-adjacent lines in the nightly docs-agent workflow,
`.github/workflows/docs-agent-nightly.yml`. Neither change alters what the
workflow does — it's a config-surface reclassification, not a behavior
change — but both are the kind of thing that hard-fails a scheduled run if
the corresponding repo Variable isn't set before the fix merges.

## What changed

**App-token input: `app-id` → `client-id`.** The "Generate GitHub App
installation token" step (`actions/create-github-app-token@v3`) now passes
`client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` instead of the deprecated
`app-id` input. `app-id` was backed by a secret
(`DOCS_AGENT_APP_ID`); `client-id` is backed by a repo Variable
(`DOCS_AGENT_APP_CLIENT_ID`). The `private-key` input is untouched — it stays
on `secrets.DOCS_AGENT_APP_PRIVATE_KEY`, which is the actual credential.

**`JIRA_EMAIL`: secret → variable.** The job's `env:` block now reads
`JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}` rather than pulling it from `secrets`.
`JIRA_API_TOKEN` stays a secret alongside it — that's the credential;
`JIRA_EMAIL` is just the basic-auth username (an Atlassian account email),
which isn't sensitive on its own.

## Why

`actions/create-github-app-token@v3` deprecated the `app-id` input upstream
in favor of `client-id`; this PR follows that upstream move rather than
carrying a deprecated input forward. The `JIRA_EMAIL` move is a
classification fix in the same spirit: GitHub's Secrets vs. Variables split
is meant to track "is this a credential," and an email address used as a
basic-auth username isn't one, so it belongs on the more visible Variables
surface. A companion change landed on the plugin side in
engineering-docs-agent PR #91.

## Operational note

Both `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL` need to exist as repo
**Variables** (Settings → Secrets and variables → Actions → Variables tab),
not secrets, before this merges. If either is missing, the next scheduled
run of `docs-agent-nightly` fails at the "Generate GitHub App installation
token" step (client-id case) or runs with the Jira integration silently
mis-authenticated (email case) — check the run's `app-token` step output
first if a nightly run starts failing around this change.

There's no code-path change beyond the two `env`/`with` value swaps: the
rest of the job (checkout, plugin checkout, Python setup, orchestrator
invocation, forensics upload) is unaffected.
