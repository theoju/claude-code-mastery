---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: docs-agent-nightly auth inputs — `client-id` over `app-id`, `JIRA_EMAIL` as a Variable

`docs-agent-nightly.yml` (the workflow that runs the nightly docs-agent
authoring job) changed two of its auth inputs. Neither change touches the
job's behavior — same GitHub App, same Jira account — only how the
credentials are supplied to the workflow.

## What changed

**GitHub App token generation.** `actions/create-github-app-token@v3`
deprecated the `app-id` input in favor of `client-id`. The workflow now
reads the App's client ID from a repo **Variable**, not a Secret:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The private key stays a Secret — it's the actual credential. The client ID
is an App identifier, not sensitive on its own, so Variable is the correct
storage class.

**Jira basic-auth username.** `JIRA_EMAIL` moved from a repo Secret to a
repo Variable, referenced via `vars.` instead of `secrets.`:

```yaml
env:
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
  JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
```

`JIRA_EMAIL` is a basic-auth **username** (an email address used only to
identify the account), not a bearer credential. `JIRA_API_TOKEN` — the
actual token — remains a Secret. Same reasoning as the App client ID:
match the storage class to what's actually sensitive.

## Why

Two separate but same-shaped fixes, landed together as a single-file,
low-risk CI config change (CCE-66):

1. `app-id` is deprecated on `create-github-app-token@v3`; staying on it
   risks a future breaking removal. `client-id` is the supported input.
2. Storing non-sensitive values as Secrets hides them from workflow run
   logs and the Variables tab, which makes the operational setup harder to
   audit — you can't tell at a glance which repo-level values a maintainer
   needs to provision. Moving `JIRA_EMAIL` to a Variable makes it visible
   where it belongs.

Neither change alters what credentials the workflow needs — it changes
where those credentials are declared and how visible they are.

## Operational impact: repo Variables you must provision

If you're setting up (or re-provisioning) `docs-agent-nightly` on a repo,
the following **repo Variables** (Settings → Secrets and variables →
Actions → Variables) must exist before the workflow can run, in addition
to the existing Secrets:

| Name | Kind | Used for |
| --- | --- | --- |
| `DOCS_AGENT_APP_CLIENT_ID` | Variable | `client-id` input to `create-github-app-token@v3` |
| `JIRA_EMAIL` | Variable | Basic-auth username for the Jira wiring |
| `DOCS_AGENT_APP_PRIVATE_KEY` | Secret (unchanged) | `private-key` input to `create-github-app-token@v3` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret (unchanged) | Claude CLI auth |
| `JIRA_API_TOKEN` | Secret (unchanged) | Jira basic-auth token |

If `DOCS_AGENT_APP_CLIENT_ID` or `JIRA_EMAIL` is missing at merge time, the
first affected step (`Generate GitHub App installation token` or the Jira
wiring inside `orchestrator_runner.py`) fails with an empty/unset value
rather than falling back to anything — there's no default.

## Non-breaking

This is not a breaking change for anyone already running the workflow with
the App and Jira account already provisioned under their old names — it's
a rename of *where* two values live (Secret → Variable) and one input
rename (`app-id` → `client-id`), not a change to which App or which Jira
account is used.
