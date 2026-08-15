---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Nightly workflow auth migration: `app-id` → `client-id`, `JIRA_EMAIL` secret → Variable

`docs-agent-nightly.yml` authenticates two ways before it can touch this repo
or Jira: a GitHub App installation token for `git push` / `gh pr create`, and
Jira basic auth for the gap-detector's ticket lookups. PR #111 (CCE-66)
changed how both credentials are wired in, ahead of an upstream deprecation
that would otherwise have hard-failed the run.

## What changed

**GitHub App token.** The `Generate GitHub App installation token` step
(`actions/create-github-app-token@v3`) now passes `client-id:
${{ vars.DOCS_AGENT_APP_CLIENT_ID }}` instead of the deprecated `app-id`
secret input. `client-id` is a repo **Variable**, not a secret — a GitHub App's
client ID isn't sensitive on its own; it only becomes a credential once paired
with the `private-key` input, which stays a secret
(`secrets.DOCS_AGENT_APP_PRIVATE_KEY`) unchanged by this PR.

**`JIRA_EMAIL`.** The job's `env:` block now reads `JIRA_EMAIL:
${{ vars.JIRA_EMAIL }}` instead of `secrets.JIRA_EMAIL`. `JIRA_EMAIL` is the
basic-auth *username* half of the Jira credential pair, not the credential
itself — the actual secret is `JIRA_API_TOKEN`, which stays a secret. Treating
a username as a secret was a misclassification, not a security requirement.

You can see both landed in `.github/workflows/docs-agent-nightly.yml`: the
`app-token` step's `with:` block and the `author` job's `env:` block.

## Why

`actions/create-github-app-token@v3` deprecated the `app-id` input in favor of
`client-id` upstream. Keeping `app-id` would have kept working until the input
was removed outright — moving now is a proactive fix rather than a reactive
one, done on this repo's own schedule instead of a future nightly's.

The `JIRA_EMAIL` change is a classification fix independent of the upstream
deprecation: an email address used only as a basic-auth username doesn't carry
the same blast radius as an API token, and GitHub Variables are the right
home for values that need to be visible in workflow logs and PR diffs without
being secret.

## Pre-merge verification

Both replacement Variables — `DOCS_AGENT_APP_CLIENT_ID` and `JIRA_EMAIL` —
were confirmed to already exist as repo Variables *before* this PR merged.
That ordering matters: `docs-agent-nightly` runs unattended on a cron
(`7 7 * * *`), and an unset Variable at the `app-token` step fails the run
before any authoring work starts, with no PR opened and no forensics to
diagnose from beyond the run log. Verifying first turned this into a
same-day config change instead of a nightly outage.

## If you're touching CI auth here next

- Repo Variables (`vars.*`) are for values that need to be *readable*, not
  values that merely aren't rotated often. If a value is only ever consumed
  by a step and never needs to appear in a diff or a log for debugging,
  default to `secrets.*`.
- `private-key` (`secrets.DOCS_AGENT_APP_PRIVATE_KEY`) and `JIRA_API_TOKEN`
  are the two credentials that actually gate access in this workflow. Neither
  changed in this PR — don't conflate an `app-id`→`client-id` rename or a
  `JIRA_EMAIL` reclassification with a credential rotation.
- Before merging any change to the `app-token` step or the `env:` block, check
  that every `vars.*` reference already exists in the repo's Variables
  settings. The workflow fails loud and early at that step, but "loud and
  early" on an unattended cron still means a missed night.
