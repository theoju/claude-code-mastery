---
title: "docs-agent-nightly: app-id → client-id, JIRA_EMAIL moved to Variables"
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# docs-agent-nightly: app-id → client-id, JIRA_EMAIL moved to Variables

PR #111 changed how `.github/workflows/docs-agent-nightly.yml` authenticates
and how it reads the Jira username. Two things moved, for two different
reasons:

1. The GitHub App token step (`actions/create-github-app-token@v3`) now
   passes `client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` instead of the
   deprecated `app-id: ${{ secrets.DOCS_AGENT_APP_ID }}`. `app-id` is a
   deprecated input on `create-github-app-token@v3`; `client-id` is the
   supported replacement.
2. `JIRA_EMAIL` moved from a repo **Secret** to a repo **Variable**
   (`vars.JIRA_EMAIL`, wired into the `author` job's `env:` block). It's a
   basic-auth username, not a credential — it doesn't belong next to
   `JIRA_API_TOKEN`, which stays a secret.

Neither change is breaking in the sense of altering behavior — the workflow
still authenticates the same way and hits the same Jira instance. It's
breaking in the sense that **the workflow will not run until the two new
repo Variables exist**. `create-github-app-token@v3` fails closed if
`client-id` is empty, and an unset `vars.JIRA_EMAIL` means Jira calls go out
with a blank username.

## What you need to provision before this merges

If you're re-provisioning `docs-agent-nightly` (new host repo, or recovering
from a wiped Actions config), set these under **Settings → Secrets and
variables → Actions → Variables** (not Secrets):

| Variable                    | Value                                            |
| ---------------------------- | ------------------------------------------------ |
| `DOCS_AGENT_APP_CLIENT_ID`   | The GitHub App's client ID (not the numeric App ID) |
| `JIRA_EMAIL`                 | The Jira basic-auth username/email                |

`DOCS_AGENT_APP_PRIVATE_KEY` and `JIRA_API_TOKEN` remain Secrets — they're
still credentials, just referenced via `secrets.*` as before. Only the
non-sensitive values moved to `vars.*`.

## Why file this as a flat dated page

There's no `operations/` or `architecture/` section under the `core` lens
yet — only `images/` exists alongside the top-level pages. This page is
filed at the lens root as a dated note rather than forced into a section
that doesn't exist. If an `operations/` section gets established later,
this is a natural first candidate to fold in, alongside a fuller runbook
for re-provisioning the nightly workflow end-to-end (App registration,
private key, Jira credentials, the two Variables above).
