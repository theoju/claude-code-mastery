---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: architecture
---

# Engineering-Docs-Agent Bootstrap

PR #100 wired `theoju/claude-code-self-assessment` into the engineering-docs-agent nightly pipeline. Before this change, the agent had no configuration for this repo and was not running. After, a cron job fires every morning and the agent can begin its doc-gap analysis and page-authoring cycle.

Four files constitute the full contract:

| File | Purpose |
|---|---|
| `.engineering-docs-agent/config.yml` | Tells the agent how this repo is structured and where its authority ends |
| `.engineering-docs-agent/state.example.json` | Template documenting the state schema |
| `.engineering-docs-agent/state.json` | Live state file tracking the last successful run |
| `.github/workflows/docs-agent-nightly.yml` | GitHub Actions workflow that runs the agent on a schedule |

## Config

`.engineering-docs-agent/config.yml` is the primary contract. Everything the agent reads at startup comes from here.

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/site-src/
```

**Framework.** `mkdocs` — the agent knows to validate its output against the mkdocs-Material build (`.github/workflows/docs-agent-pages.yml`) and that `publishing.base_url` is the canonical reachability target.

**Editable boundary.** `docs/**` is the only tree the agent can write into. It will refuse any path outside that glob — so the Next.js app, scripts, and workflow files are never touched.

**Lens.** A single `core` lens mapped to `docs/site-src/`. All agent-authored pages land here. There is no `operations/` or `architecture/` subdirectory under the lens root; the agent falls back to flat dated slugs at the lens root when no matching subdirectory exists.

**Publishing.** The agent's publish-verifier checks that the `docs-agent-pages.yml` build workflow ran successfully for the current HEAD on `main` and that `https://theoju.github.io/claude-code-self-assessment/` plus each authored page is reachable within 60 seconds. A failed verification adds `verify_failed` to `partial_reasons` but does not block the run.

**Voice.** The agent samples `README.md` and `CLAUDE.md` for tone when generating content. This keeps authored pages consistent with the existing docs voice rather than defaulting to generic technical prose.

**Sources.** Only `git` is enabled (`host: github`). Jira integration is disabled (`jira.enabled: false`) — flip that and set `project_keys` if you want gap flags to link out to CCE tickets.

**Notifications.** Both Slack and email are off. The agent's run output surfaces only through GitHub Actions summaries and PR descriptions.

## State

The agent tracks its last successful run in `.engineering-docs-agent/state.json`:

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

`head_sha` is the commit the agent processed on its last clean run. On the next run, the agent walks commits from that SHA forward to build its PR summaries — so the state file is effectively the diff cursor. `pr_number: 0` in the seed state means no prior agent PR exists; the agent creates a fresh one on the first run.

`dismissed_gap_flags` is an object (not an array — note the shape differs from `state.example.json`) for gap flags you've acknowledged and don't want re-surfaced. Leave it empty to see all gaps.

The state file is committed to the repo and updated by the agent as part of each nightly PR. Do not manually edit `head_sha` unless you're deliberately re-seeding the diff cursor.

## Nightly Workflow

`.github/workflows/docs-agent-nightly.yml` is the CI trigger. Key design decisions:

**Schedule.** Fires at `07:07 UTC` daily — the off-minute `:07` avoids the GitHub Actions top-of-hour queue pileup. Also accepts `workflow_dispatch` with an optional `reason` string for manual runs.

**Concurrency.** `cancel-in-progress: false`. If a previous run is still in flight when the cron fires, the new run queues rather than cancelling the existing one. Doc authoring is idempotent but not fast; cancelling mid-run leaves an orphaned branch.

**GitHub App token.** The workflow uses `actions/create-github-app-token@v3` to mint an installation token from `DOCS_AGENT_APP_CLIENT_ID` (var) and `DOCS_AGENT_APP_PRIVATE_KEY` (secret). This token is used for both the checkout and the `gh pr create` calls — the default `GITHUB_TOKEN` cannot push to protected branches or trigger downstream workflows.

**Plugin vendoring.** The agent plugin lives at `theoju/engineering-docs-agent`, not in this repo. The workflow checks it out into `.docs-agent-plugin/` and invokes `python3 .docs-agent-plugin/scripts/orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"`. This means the plugin version is pinned to `main` at run time — no explicit SHA pin here. If the plugin introduces a breaking change, this workflow picks it up on next nightly run.

**OAuth token validation.** Before the main run, the workflow validates `CLAUDE_CODE_OAUTH_TOKEN`:

- Must be non-empty
- Must start with `sk-ant-oat` (OAuth token). A `sk-ant-api` prefix (console API key) causes an explicit error with a remediation hint: run `claude setup-token` to generate a valid OAuth token.
- Must be at least 32 characters (sanity check for truncated paste)

**Runtime dependencies.** Python 3.11 with `pyyaml` and `jsonschema`. The workflow comment notes this is a `framework: mkdocs` host, so the mkdocs toolchain itself is not installed here — the docs build runs in the separate `docs-agent-pages.yml` workflow.

**Forensics.** After every run (including failures), the workflow uploads `$RUNNER_TEMP/docs-agent-debug/` as a GitHub Actions artifact named `docs-agent-subagent-forensics-<run_id>`, retained for 14 days. This is the primary debugging surface for failed or partial authoring runs.

**Run summary.** The final step appends a structured summary to `$GITHUB_STEP_SUMMARY` including the trigger, optional dispatch reason, HEAD SHA, and the current contents of `state.json`. Check the Actions run summary first when diagnosing whether a nightly run actually updated the state.

## Required Secrets and Variables

| Name | Type | Required | Purpose |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret | Yes | Claude CLI authentication (`sk-ant-oat...`) |
| `DOCS_AGENT_APP_CLIENT_ID` | Variable | Yes | GitHub App client ID for token minting |
| `DOCS_AGENT_APP_PRIVATE_KEY` | Secret | Yes | GitHub App private key for token minting |
| `JIRA_API_TOKEN` | Secret | No | Jira integration (unused while `jira.enabled: false`) |
| `JIRA_EMAIL` | Variable | No | Jira integration (unused while `jira.enabled: false`) |

Set these under **Settings → Secrets and variables → Actions** before the first scheduled run. The workflow's OAuth token validation step will fail loudly on the first nightly run if `CLAUDE_CODE_OAUTH_TOKEN` is missing or malformed.

## What the Agent Writes

Under the current config, the agent can only write to `docs/**`. In practice it authors:

- Lens pages at `docs/site-src/` (flat dated slugs, since no subdirectory sections are defined for the `core` lens)
- `docs/site-src/whats-new.md` (the `whats_new_file` entry point updated with each nightly run's summary)

Each nightly run opens a pull request from a `docs-agent/YYYY-MM-DD` branch. Review and merge as with any other PR — the agent does not auto-merge.
