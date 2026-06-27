---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: architecture
---

# Docs-agent bootstrap (CCE-57)

PR #100 registers `theoju/claude-code-self-assessment` as a host in the
engineering-docs-agent ecosystem. This page records what was put in place,
which pipeline stages run on every nightly cycle, and how to verify the
integration after a fresh setup.

## What was bootstrapped

Three files establish the host contract:

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host config — framework, source dirs, lens paths, publishing target |
| `.engineering-docs-agent/state.json` | Mutable run state — last successful SHA + PR number, updated by each nightly run |
| `.engineering-docs-agent/state.example.json` | Committed template with `REPLACE_WITH_SEED_COMMIT_SHA` placeholder; seed on first clone |

The nightly automation lives in `.github/workflows/docs-agent-nightly.yml` and
runs on a `cron: "7 7 * * *"` schedule (07:07 UTC daily, off-minute per GitHub
Actions guidance to avoid the :00 pileup). It also accepts `workflow_dispatch`
with an optional `reason` field that appears in the run summary.

## Host config

`.engineering-docs-agent/config.yml` as committed:

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  verify_timeout_seconds: 60
```

**Framework history.** PR #100 initially set `framework: none` after CCE-64
added it as a first-class value (engineering-docs-agent PR #84), removing a
synthetic mkdocs scaffold (`mkdocs.yml`, `requirements-docs.txt`) that had
been added only to satisfy the plugin's original enum. The config was
subsequently updated to `framework: mkdocs` when the real mkdocs site was
stood up (CCE-81/CCE-82). The nightly workflow still carries stale comments
referencing `framework=none`; those comments are artifacts of the initial
bootstrap, not the current config.

**Lens.** The single `core` lens maps to `docs/site-src/`. Every markdown
file under that directory is agent-editable. `agent_editable_paths` covers
`docs/**` at the top level, so subdirectories like `docs/superpowers/` are
also in-scope.

**Publishing.** `base_url` is set and `build_workflow` names
`docs-agent-pages.yml`. This enables the publish-verifier stage: after the
nightly PR merges, the verifier checks that the Pages build workflow ran for
the current `main` HEAD and that `base_url` plus each lens page are reachable
within 60 seconds.

## Nightly workflow structure

The workflow vendors the plugin's scripts rather than installing it as a
package. It checks out `theoju/engineering-docs-agent@main` into
`.docs-agent-plugin/` on the runner, then invokes the orchestrator directly:

```bash
python3 .docs-agent-plugin/scripts/orchestrator_runner.py \
  --repo-root "$GITHUB_WORKSPACE"
```

**Token wiring.** The workflow uses a GitHub App token (not `GITHUB_TOKEN`)
generated from `DOCS_AGENT_APP_CLIENT_ID` + `DOCS_AGENT_APP_PRIVATE_KEY`:

```yaml
- name: Generate GitHub App installation token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.DOCS_AGENT_APP_CLIENT_ID }}
    private-key: ${{ secrets.DOCS_AGENT_APP_PRIVATE_KEY }}
```

The App token is passed to `actions/checkout@v5` so that commits pushed by the
bot carry the App's identity, not the default `github-actions` actor. Git
identity is set to `engineering-docs-agent[bot]`.

**Claude auth.** `CLAUDE_CODE_OAUTH_TOKEN` is validated at runtime before the
orchestrator step. The validator rejects console API keys (`sk-ant-api…`) and
tokens shorter than 32 characters, printing an actionable error. Only
`sk-ant-oat…` prefixes pass.

**Required permissions:**

| Scope | Reason |
| --- | --- |
| `contents: write` | commit + push `docs-agent/YYYY-MM-DD` branch |
| `pull-requests: write` | `gh pr create` + append commits to existing nightly PR |
| `issues: read` | gap-detector reads linked issues (no writes) |

**Forensics.** Subagent debug output is uploaded unconditionally (`if: always()`)
to `docs-agent-subagent-forensics-<run_id>` with a 14-day retention window.
If a nightly run produces unexpected output, start there before digging into
workflow logs.

## Pipeline stages: active vs. skipped

| Stage | Status | Notes |
| --- | --- | --- |
| pr-summarizer | ✅ active | scans merged PRs since last successful run |
| gap-detector | ✅ active | reads linked issues (read-only) |
| page-author | ✅ active | writes/edits pages under `docs/site-src/` |
| lint (tier1) | ✅ active | default tier1 rules against authored markdown |
| framework_build lint | ⏭ — | skipped when `framework: none` was set; currently runs for `mkdocs` |
| publish-verifier | ✅ active | `base_url` is non-null; checks Pages build and URL reachability |

## State file

`.engineering-docs-agent/state.json` is the handshake between runs. The plugin
reads `last_successful_run.head_sha` to determine which PRs to summarize (only
PRs merged after that SHA). After a successful nightly cycle, the plugin
commits an updated state file back to `main`.

`state.example.json` ships a placeholder SHA (`REPLACE_WITH_SEED_COMMIT_SHA`)
and `pr_number: 0`. To seed a fresh checkout, copy it to `state.json` and
replace the SHA with the commit you want the agent to start from — typically
the merge commit of the bootstrap PR itself.

Current committed value in `state.json`:

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "6c782ead5731960d3a0a9dd5b4e2ffcb9e1c2135",
    "pr_number": 0
  },
  "dismissed_gap_flags": {}
}
```

`dismissed_gap_flags` starts empty (`{}`). The gap-detector appends entries
here when a gap is acknowledged and should not re-fire.

## Post-merge smoke test

After PR #100 merges, verify the integration with these steps:

1. **Branch protection.** Confirm that `docs-agent/YYYY-MM-DD` branches are
   allowed to push. The App token needs write access; if the branch-protection
   ruleset restricts push to `main` only, the nightly commit step fails.

2. **Secrets and vars.** In repo Settings → Secrets and variables → Actions,
   confirm:
   - Secret `CLAUDE_CODE_OAUTH_TOKEN` — `sk-ant-oat…` prefix, >100 chars
   - Secret `DOCS_AGENT_APP_PRIVATE_KEY` — PEM block for the GitHub App
   - Variable `DOCS_AGENT_APP_CLIENT_ID` — numeric App client ID
   - (Optional) Secret `JIRA_API_TOKEN` + Variable `JIRA_EMAIL` — only needed
     if `sources.jira.enabled: true`

3. **Manual trigger.** Fire the workflow via:
   ```bash
   gh workflow run docs-agent-nightly.yml \
     --field reason="smoke test after bootstrap"
   ```
   Then watch it:
   ```bash
   gh run watch $(gh run list --workflow docs-agent-nightly.yml \
     --limit 1 --json databaseId -q '.[0].databaseId')
   ```

4. **Confirm state update.** After a successful run, `state.json` on `main`
   should carry the current `HEAD` SHA and a `pr_number` matching the nightly
   PR the agent opened (or `0` if no PRs were in scope).

5. **Review the nightly PR.** If PRs were in scope, the agent opens a PR
   targeting `main` from a `docs-agent/YYYY-MM-DD` branch. Review authored
   pages, approve, and merge. The publish-verifier runs after merge and
   confirms the Pages deployment reached the live URL.

## Notifications

`notifications.slack.enabled: false` and `notifications.email.enabled: false`
in the committed config. No alerts fire out of the box. Flip either to `true`
and set the corresponding webhook secret to enable nightly run summaries.
