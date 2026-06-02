---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/111
synthesized_into: []
---

# Docs-agent nightly: auth migration (2026-06-01)

PR #111 makes two small changes to `.github/workflows/docs-agent-nightly.yml`
that keep the nightly engineering-docs CI workflow from breaking on future
Action version bumps and tighten secret hygiene. No user-visible dashboard
behaviour changes.

## What changed

### `app-id` → `client-id`

`actions/create-github-app-token@v3` deprecated the `app-id` input in favour
of `client-id`. The edit swaps the key in the token-creation step:

```yaml
# before
- uses: actions/create-github-app-token@v3
  with:
    app-id: ${{ secrets.APP_ID }}

# after
- uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ secrets.APP_CLIENT_ID }}
```

Staying on the deprecated input is safe today, but a future minor bump to the
Action would silently break token creation. The fix costs two lines and removes
the dependency on a deprecated interface before it becomes a live incident.

The companion change lives in the cross-repo plugin PR
`theoju/engineering-docs-agent#91` (merged at `91e9b6c`), which carries the
matching reference on the agent side.

### `JIRA_EMAIL` moved from Secret to Variable

`JIRA_EMAIL` is the basic-auth username for the Atlassian API — a login
address, not a credential. Storing a non-sensitive value as a Secret made it
opaque in CI logs, harder to audit, and an unnecessary entry in the
repository's secret quota.

Moving it to a repository Variable (`vars.JIRA_EMAIL`) means:

- it's visible under *Settings → Variables* without needing secret-management access
- its intent ("this is a username") is self-documenting at a glance
- rotating Jira passwords or tokens doesn't require touching the email entry

## No user-visible impact

This change is purely CI/CD infrastructure. The dashboard scoring, the nightly
docs build output, and every rendered page on the docs site are unchanged. If
the nightly was previously warning about the deprecated `app-id` input, those
warnings will stop; otherwise the only observable effect is the removal of a
future deprecation break.

## Operator checklist

If you fork this repo and run the nightly workflow yourself, update your
repository settings before the next run:

1. Add a repository **Variable** named `JIRA_EMAIL` with your Atlassian account
   email (Settings → Secrets and variables → Actions → Variables tab).
2. Rename the `APP_ID` secret to `APP_CLIENT_ID` — the value (the GitHub App's
   client ID) is the same; only the key name referenced in the workflow changed.
3. Confirm the token-creation step succeeds on the next nightly run by checking
   the Actions log for the `Generate token` step.

No changes to local scoring config or `assessment.config.json` are needed.
