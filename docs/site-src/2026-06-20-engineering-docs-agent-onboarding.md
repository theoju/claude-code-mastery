---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Onboarding to engineering-docs-agent (CCE-57)

PR #100 wires this repo into the [engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin. The result: a nightly GitHub Actions workflow that runs Tier-1 doc agents (source-collector, pr-summarizer, page-author, content-validator, gap-detector, notifier) and opens a PR with any authored or updated pages under `docs/site-src/`.

## What PR #100 added

Three artefacts land at the repo root:

| Path | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host config consumed by the plugin orchestrator |
| `.engineering-docs-agent/state.json` | Seeded run-state (tracks the last merged PR the agent processed) |
| `.engineering-docs-agent/state.example.json` | Template for `state.json` — committed as the reference shape |
| `.github/workflows/docs-agent-nightly.yml` | The nightly run itself |

### Host config

The plugin reads `.engineering-docs-agent/config.yml` to discover the docs layout and behaviour:

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

`framework: mkdocs` tells the orchestrator that the docs site is built by mkdocs-Material (published at `https://theoju.github.io/claude-code-self-assessment/` via `docs-agent-pages.yml`). The `framework_build` lint and `publish-verifier` stages run accordingly. The single lens, `core`, maps to `docs/site-src/` — that is where the page-author agent writes new pages.

> **Historical context:** PR #100 was originally scoped to `framework: none`, relying on CCE-64 to land that value as a first-class config option and avoiding a synthetic mkdocs scaffold. The workflow's install step still carries a comment referencing the original `framework=none` choice (`# framework=none host (CCE-64): no mkdocs/docusaurus toolchain needed`). That comment is stale: the config was subsequently upgraded to `framework: mkdocs` when the mkdocs-Material site was established (CCE-81/CCE-82, PR #121/PR #125). The `framework: mkdocs` value in the file as read is the current truth.

### State file shape

Both `state.json` and `state.example.json` carry the same structure:

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "<commit-sha>",
    "pr_number": 0
  },
  "dismissed_gap_flags": {}
}
```

`state.json` is seeded with the SHA of the commit that introduced the onboarding files (`6c782ead…`) and `pr_number: 0`. The orchestrator updates `last_successful_run` after each successful nightly run, so the source-collector knows which commits are new on the next pass. `dismissed_gap_flags` starts empty — it accumulates gap-detector suppressions over time.

## Nightly workflow structure

`.github/workflows/docs-agent-nightly.yml` fires daily at **07:07 UTC** (off-minute scheduling per GitHub Actions guidance) and is also `workflow_dispatch`-able with an optional `reason` field shown in the run summary.

```
schedule: "7 7 * * *"
concurrency: docs-agent-nightly (never cancel-in-progress)
timeout: 60 minutes
```

The workflow requires three permissions: `contents: write` (commit + push the `docs-agent/YYYY-MM-DD` branch), `pull-requests: write` (open the nightly PR), and `issues: read` (gap-detector reads linked issues).

### Steps in order

1. **Generate GitHub App installation token** — `actions/create-github-app-token@v3` using `DOCS_AGENT_APP_CLIENT_ID` (var) and `DOCS_AGENT_APP_PRIVATE_KEY` (secret). This is the CCE-45 App-token fix; the older plugin template used a plain `GITHUB_TOKEN` that couldn't push to protected branches.

2. **Checkout host repo** — `fetch-depth: 0` so the source-collector can walk the full commit graph. Uses the App token so the pushed branch is attributed to the bot identity.

3. **Checkout plugin** — `theoju/engineering-docs-agent@main` vendored into `.docs-agent-plugin/` at runner workspace root. The host repo is not the plugin; the orchestrator scripts live in the plugin and are invoked here.

4. **Set up Python 3.11 + install deps** — only `pyyaml` and `jsonschema` are required (orchestrator deps). No mkdocs toolchain is installed in this step; the framework build runs in the separate `docs-agent-pages.yml` workflow on push to main.

5. **Install claude CLI** — `npm install -g @anthropic-ai/claude-code`, then fails loudly if `which claude` returns nothing.

6. **Assert OAuth token is configured and well-formed** (CCE-49) — validates `CLAUDE_CODE_OAUTH_TOKEN` is non-empty, starts with `sk-ant-oat` (not `sk-ant-api`, which is a console API key and not what the CLI reads), and is at least 32 characters. Fails with a specific `::error::` message for each failure mode.

7. **Configure git identity** — sets `user.name = engineering-docs-agent[bot]` and the `noreply` email so commits are attributed to the bot.

8. **Run nightly authoring** — `python3 .docs-agent-plugin/scripts/orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"`. Subagent debug output goes to `$DOCS_AGENT_DEBUG_DIR` (`$RUNNER_TEMP/docs-agent-debug`). `GH_TOKEN` is set from the App token (not `GITHUB_TOKEN`) so the orchestrator's `gh` calls inherit the bot's write access.

9. **Upload subagent forensics** (CCE-41, `if: always()`) — uploads `$DOCS_AGENT_DEBUG_DIR/**` as `docs-agent-subagent-forensics-<run_id>`, retained for 14 days. Fires even on failure so you can inspect what the subagents produced before the run aborted.

10. **Run summary** (`if: always()`) — appends trigger, reason, HEAD SHA, and the current `state.json` contents to `$GITHUB_STEP_SUMMARY`. If `state.json` is absent or invalid JSON, prints `(invalid or empty state)` rather than silently omitting it.

### Secrets and vars required

| Name | Kind | Used by |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | claude CLI authentication (must start with `sk-ant-oat`) |
| `DOCS_AGENT_APP_PRIVATE_KEY` | secret | GitHub App token generation |
| `DOCS_AGENT_APP_CLIENT_ID` | var | GitHub App token generation |
| `JIRA_API_TOKEN` | secret | CCE-53 Jira wiring (gap-detector / notifier) |
| `JIRA_EMAIL` | var | CCE-53 Jira wiring |

`JIRA_API_TOKEN` and `JIRA_EMAIL` are wired into the `author` job's `env` block and passed through to the orchestrator. The host config has `jira.enabled: false` by default — flip that and set `project_keys` in the config if you want the notifier to create Jira issues for detected gaps.

## Why framework: none was the original choice (historical)

When PR #100 was drafted, `framework: none` was selected over a synthetic mkdocs scaffold for two reasons:

1. **Accuracy** — at the time, this repo had no SSG build step for its docs. Adding a fake mkdocs config would have misrepresented the repo's shape and caused the `framework_build` lint stage to check for a build that never ran.
2. **CCE-64 dependency** — `framework: none` wasn't a recognised value in the plugin until CCE-64 landed it. PR #100 was blocked on that merge.

With `framework: none` the orchestrator skips the framework build lint and publish-verifier stages cleanly, running only the Tier-1 authoring agents. That's the configuration captured in the workflow comments, which remain as-is (stale but historically accurate for the PR's original intent).

## Post-merge smoke-test steps

After PR #100 merges to main:

1. **Trigger a manual run**: go to Actions → `docs-agent-nightly` → Run workflow. Pass any string as `reason` (e.g. `"post-onboarding smoke test"`).
2. **Watch the token validation step** — if `CLAUDE_CODE_OAUTH_TOKEN` is missing or starts with `sk-ant-api`, it will fail here with a clear error. Rotate or re-paste the secret before re-running.
3. **Confirm the orchestrator step exits 0** — the run summary step appends `state.json` to the job summary. After a successful first run the `head_sha` and `pr_number` fields should be updated from the seeded values.
4. **Check for the forensics artifact** — even on success, the upload step fires. Open the artifact to confirm the debug directory structure if you need to trace what the subagents did.
5. **Check for an open PR** — a successful authoring pass opens a `docs-agent/YYYY-MM-DD` PR. Review its diff and merge if the content looks right. On the very first run the diff may be empty (no new PRs since the seed SHA) — that is expected.
