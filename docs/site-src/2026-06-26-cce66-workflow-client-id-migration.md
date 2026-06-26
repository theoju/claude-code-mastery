---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# CCE-66: Migrate `app-id` → `client-id` and move `JIRA_EMAIL` to repository variables

**Date:** 2026-06-26  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Companion plugin PR:** engineering-docs-agent #91 (`91e9b6c`)

## What changed

Two credential-plumbing adjustments in `.github/workflows/docs-agent-nightly.yml`, both non-functional:

1. **`app-id` → `client-id`** in the `actions/create-github-app-token@v3` step:

   ```yaml
   - name: Generate GitHub App installation token
     id: app-token
     uses: actions/create-github-app-token@v3
     with:
       client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
       private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
   ```

   Before this PR the same step passed `app-id:` instead of `client-id:`. The renamed input is the current interface in `create-github-app-token@v3`; `app-id` is deprecated upstream and risks a hard break on future action updates.

2. **`JIRA_EMAIL` moved from `secrets.*` to `vars.*`**:

   ```yaml
   env:
     JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
   ```

   `JIRA_EMAIL` is a basic-auth username — plain text that identifies the service account, not a credential. Storing a username as a GitHub secret is over-classification: it consumes secret quota, masks the value in logs where seeing it would help debug auth failures, and trains readers to treat non-secret values as secrets. Repository variables are the correct home.

## Why it matters

Neither change alters runtime behavior today. Both protect against future failure modes:

- Continuing to use the deprecated `app-id` input means the next upstream action bump silently (or loudly) breaks token generation, taking the entire nightly docs run offline.
- Keeping `JIRA_EMAIL` in secrets creates secrets sprawl — auditing "what are our real secrets?" becomes harder when usernames share space with API tokens.

## Prerequisites verified before merge

- Repository variable `DOCS_AGENT_APP_CLIENT_ID` was confirmed present.
- Repository variable `JIRA_EMAIL` was confirmed present (moved from secrets).
- The companion plugin PR (#91, `91e9b6c`) was merged first, establishing the `client-id` convention on the plugin side.

## No action required for existing deployments

If you forked this repo and run your own nightly, update your workflow in the same way: rename the `app-id:` input to `client-id:`, add a `DOCS_AGENT_APP_CLIENT_ID` repository variable (Settings → Secrets and variables → Variables), and remove the `JIRA_EMAIL` repository secret once you've added it as a variable.
