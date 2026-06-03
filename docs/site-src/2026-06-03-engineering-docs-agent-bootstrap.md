---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# engineering-docs-agent bootstrap — PR #100

PR #100 (CCE-57 / CCE-64) onboards this repo onto the shared
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
infrastructure. The agent authors and updates lens pages on a nightly schedule,
so documentation stays in sync with merged PRs without manual intervention.

The initial scaffold used `framework: none`; PR #121 later flipped this to
`framework: mkdocs` once the docs site was live. The wiring described here
underpins both phases.

---

## What was added

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host-side plugin config: lens paths, voice samples, agent-editable paths, publishing target. |
| `.engineering-docs-agent/state.json` | Mutable run state (last successful HEAD SHA, dismissed gap flags). Written by the agent after each successful nightly run; committed back to `main` via the nightly PR. |
| `.github/workflows/docs-agent-nightly.yml` | GitHub Actions workflow that checks out the plugin, installs deps, and runs the orchestrator on the daily schedule. |

The `config.yml` declares one lens:

```yaml
docs:
  lens_paths:
    core: docs/site-src/
```

All pages the agent is allowed to write or modify fall under `docs/**`
(`agent_editable_paths`). Pages outside that tree are off-limits regardless of
what the orchestrator requests.

---

## Nightly workflow

The workflow fires at **07:07 UTC daily** (off-minute scheduling per GitHub
Actions' guidance on avoiding the `:00` pileup) and on `workflow_dispatch`.

High-level steps:

1. **Generate GitHub App token** — uses `actions/create-github-app-token@v3`
   with `DOCS_AGENT_APP_CLIENT_ID` / `DOCS_AGENT_APP_PRIVATE_KEY`. The App
   token (not `GITHUB_TOKEN`) is what allows the agent to push the
   `docs-agent/YYYY-MM-DD` branch and open a PR.
2. **Check out this repo and the plugin** — the plugin (`theoju/engineering-docs-agent`)
   is vendored into `.docs-agent-plugin/` on the runner; it is never installed
   as a dependency.
3. **Install runtime deps** — `pyyaml` and `jsonschema` only; no mkdocs
   toolchain was needed at `framework: none`.
4. **Assert OAuth token** — validates that `CLAUDE_CODE_OAUTH_TOKEN` starts
   with `sk-ant-oat` (the OAuth form the Claude CLI reads) and is at least 32
   chars. Exits non-zero with a clear error if it looks like a console API key
   (`sk-ant-api`) or is missing entirely.
5. **Run the orchestrator** —
   `python3 .docs-agent-plugin/scripts/orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"`
   scans recently merged PRs, dispatches subagents to author affected lens
   pages, and opens a PR with the resulting changes.
6. **Upload forensics** — subagent debug output is always uploaded as an
   artifact (`docs-agent-subagent-forensics-<run_id>`, 14-day retention) so
   failures are diagnosable without re-running.
7. **Run summary** — appends trigger, HEAD SHA, and the post-run `state.json`
   contents to the GitHub Actions job summary.

### Required secrets and variables

| Name | Kind | Notes |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret | OAuth token for the Claude CLI (`sk-ant-oat…`). Generate with `claude setup-token`. |
| `DOCS_AGENT_APP_CLIENT_ID` | Variable | GitHub App client ID for the docs-agent App. |
| `DOCS_AGENT_APP_PRIVATE_KEY` | Secret | GitHub App private key (PEM). |
| `JIRA_API_TOKEN` | Secret | Optional; only needed if `jira.enabled: true` in `config.yml`. Currently disabled. |
| `JIRA_EMAIL` | Variable | Optional companion to `JIRA_API_TOKEN`. |

The workflow uses a **GitHub App token rather than `GITHUB_TOKEN`** because
`GITHUB_TOKEN`-triggered pushes do not fire other GitHub Actions workflows
(including `docs-build-check.yml` on the resulting PR). The App token bypasses
that restriction.

---

## Triggering a manual run

```bash
gh workflow run docs-agent-nightly.yml --field reason="manual bootstrap test"
```

The `reason` field is shown in the job summary and is otherwise cosmetic. Check
the run output:

```bash
gh run list --workflow=docs-agent-nightly.yml --limit 5
gh run view <run-id> --log
```

If the run opens a PR, it will be on a branch named `docs-agent/YYYY-MM-DD`.
Review and merge it like any other PR — `docs-build-check.yml` runs
`mkdocs build --strict` against it automatically.

---

## State file contract

`.engineering-docs-agent/state.json` is committed and updated by the agent:

```json
{
  "version": "1",
  "last_successful_run": {
    "head_sha": "<40-char SHA of the main HEAD the agent processed>",
    "pr_number": 0
  },
  "dismissed_gap_flags": {}
}
```

`pr_number: 0` means the previous run produced no changes (gap flags dismissed
or nothing to write). A non-zero value is the PR the agent opened. The
orchestrator uses `last_successful_run.head_sha` to compute the incremental PR
range on the next run, so it doesn't re-author pages for already-processed
merges.

---

## Note on the plugin template

The workflow was derived from the engineering-docs-agent dogfood workflow
directly, **not** from `templates/workflow-run.yml` in the plugin repo. The
plugin template was stale at bootstrap time (deprecated `ANTHROPIC_API_KEY` env
var, missing App-token wiring from CCE-45, token validation from CCE-49, and
forensics upload from CCE-41). Refreshing the plugin template is tracked as
plugin tech-debt. If you're onboarding a new host repo, copy from this file
rather than the plugin's template until that debt is cleared.
