---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: Migrate GitHub App Token to `client-id`, Move `JIRA_EMAIL` to Variables

**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111) · **Date:** 2026-06-01 · **Breaking:** No

## Context

The docs-agent nightly workflow uses `actions/create-github-app-token@v3` to mint a short-lived GitHub App token. That action deprecated its `app-id` input parameter; continuing to pass `app-id` risks a hard failure on the next upstream version bump.

Separately, `JIRA_EMAIL` was stored as a repository _Secret_. It is a Jira basic-auth username — not a credential. Secrets are encrypted at rest and redacted from logs, which is appropriate for tokens and passwords but misleading for a plain email address. Keeping a non-sensitive value in Secrets adds unnecessary rotation friction and obscures which values are actually sensitive.

## Decision

Two-line change to the nightly workflow:

1. **Rename `app-id:` → `client-id:`** in the `actions/create-github-app-token@v3` step. No value changes; only the parameter name updates to match the upstream API.

2. **Move `JIRA_EMAIL` from repository Secrets to repository Variables.** Reference in the workflow updates from `${{ secrets.JIRA_EMAIL }}` to `${{ vars.JIRA_EMAIL }}`.

## Pre-merge requirement

Before merging this change, both of the following must exist in the repository settings:

- **Variables → `JIRA_EMAIL`** — set to the Jira account email used for basic-auth.
- **Secrets → `GITHUB_APP_CLIENT_ID`** (or whichever secret name the workflow references for `client-id:`) — unchanged from the prior `app-id` secret if the value is already present.

The workflow will fail on the next nightly run if either value is missing from its new location.

## Consequences

- **No user-visible behavior change.** The token minting and Jira authentication steps produce the same outputs as before.
- **Clearer credential classification.** Repository Variables are visible to maintainers and not redacted in logs, which is the correct treatment for a username. Secrets remain reserved for actual credentials (tokens, passwords, private keys).
- **Future-proof against upstream deprecation.** `client-id` is the current parameter name in `actions/create-github-app-token@v3`; the old `app-id` alias may be removed in a future minor version.
