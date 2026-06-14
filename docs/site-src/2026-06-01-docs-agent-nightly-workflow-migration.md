---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
doc_kind: decision
---

# Decision: Migrate docs-agent nightly workflow to `client-id` and repo variables (CCE-66)

**Date:** 2026-06-01  
**PR:** [#111](https://github.com/theoju/claude-code-self-assessment/pull/111)  
**Scope:** `.github/workflows/docs-agent-nightly.yml` — two-line CI/CD config change, no user-visible docs-site behavior change.

---

## What changed

Two edits to the nightly workflow:

1. **`app-id` → `client-id`** on `actions/create-github-app-token@v3`.  
   The `app-id` input is deprecated upstream and must be replaced with `client-id`. The value moves to the repository variable `DOCS_AGENT_APP_CLIENT_ID` (previously it was also a variable, but keyed as `app-id` in the action call).

   ```yaml
   # before
   uses: actions/create-github-app-token@v3
   with:
     app-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}

   # after (PR #111)
   uses: actions/create-github-app-token@v3
   with:
     client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
   ```

2. **`JIRA_EMAIL` moved from `secrets` to `vars`**.  
   `JIRA_EMAIL` is a basic-auth username — not a credential — and belongs in repository variables rather than secrets.

   ```yaml
   # before
   JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}

   # after (PR #111)
   JIRA_EMAIL: ${{ vars.JIRA_EMAIL }}
   ```

Both changes are reflected in the current workflow at lines 42 and 48.

---

## Why

### `client-id` deprecation

`actions/create-github-app-token@v3` deprecated `app-id` in favor of `client-id`. Sticking with `app-id` risks a breaking removal in a future minor bump of the action. The companion plugin PR #91 landed the identical migration on the `engineering-docs-agent` side; PR #111 closes the loop on the host repo.

### `JIRA_EMAIL` classification

GitHub Secrets are encrypted and masked in logs — appropriate for tokens, API keys, and passwords. A Jira email address is a basic-auth username: non-sensitive, already visible in API calls, and simpler to manage as a plain repository variable. Keeping it in Secrets adds friction (masked values can't be inspected or audited without a secret update) without any security benefit.

---

## Operational prerequisites

Before the nightly workflow runs successfully, two repository-level variables must exist:

| Variable | Where | Purpose |
|---|---|---|
| `DOCS_AGENT_APP_CLIENT_ID` | Repository **Variables** | GitHub App client ID for token generation |
| `JIRA_EMAIL` | Repository **Variables** | Jira basic-auth username |

And the following secrets must remain set:

| Secret | Purpose |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude CLI authentication (`sk-ant-oat…`) |
| `DOCS_AGENT_APP_PRIVATE_KEY` | GitHub App private key (signs the installation token) |
| `JIRA_API_TOKEN` | Jira API token (actual credential — stays in secrets) |

If `DOCS_AGENT_APP_CLIENT_ID` is missing or keyed incorrectly, the `Generate GitHub App installation token` step fails immediately and all subsequent steps (checkout, orchestrator run, PR creation) are skipped.

---

## Decision rationale

This is a pure conformance change: upstream deprecated the old input name, and secret/variable classification follows GitHub's own guidance (secrets for credentials, variables for non-sensitive config). No alternative was evaluated because there is no meaningful alternative — the action's deprecation path is authoritative, and the classification change has no tradeoffs.

---

## References

- `actions/create-github-app-token` upstream deprecation notice (v3 changelog)
- Companion plugin PR: `theoju/engineering-docs-agent` PR #91
- CCE-66 (Jira)
