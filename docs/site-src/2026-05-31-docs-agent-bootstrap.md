---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Docs agent bootstrap (CCE-57)

PR #100 wires the `claude-code-self-assessment` repository into the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin. After this change, a nightly GitHub Actions job runs the agent on a
schedule and the docs site at
`https://theoju.github.io/claude-code-self-assessment/` is populated
automatically.

## What was added

Three files land in the repository:

| File | Purpose |
| ---- | ------- |
| `.engineering-docs-agent/config.yml` | Agent configuration: repo identity, lens definitions, output paths, mkdocs framework declaration |
| `.engineering-docs-agent/state.example.yml` | Reference state file showing the shape the agent writes after each run |
| `.github/workflows/docs-agent-nightly.yml` | Scheduled workflow that invokes the agent; runs at midnight UTC and on push to `main` |

## How the pipeline works

1. **Nightly trigger** — `docs-agent-nightly.yml` fires on `schedule`
   (cron) and on `push` to `main`. It checks out the repo, authenticates to
   the agent plugin, and dispatches the agent run.
2. **Agent run** — the engineering-docs-agent reads `config.yml`, pulls the
   latest PR summaries from the GitHub API, and calls the `page-author`
   subagent for any lens page that needs a create or edit pass.
3. **Publish** — the agent's `docs-agent-pages.yml` workflow (in the plugin
   repo) builds the mkdocs site from `docs/site-src/` and deploys it to
   GitHub Pages via `deploy-pages@v5`.

The nightly run is independent of `npm run assess`. It touches only
`docs/site-src/` and the mkdocs config — never `app/data/`, scorer scripts,
or the rubric.

## Config file structure

`.engineering-docs-agent/config.yml` declares:

```yaml
framework: mkdocs
repo: theoju/claude-code-self-assessment
lenses:
  - name: core
    src: docs/site-src
    nav_root: docs/site-src/core
```

The `framework: mkdocs` declaration is the key field. It tells the agent
to produce `mkdocs.yml`-compatible nav entries and to emit pages as
plain Markdown under `docs/site-src/`. A missing or wrong value here
causes the build-check workflow to fail on the first PR that touches the
site.

## One-time GitHub Pages setup

`actions/configure-pages@v6` with `enablement: true` does **not**
bootstrap Pages on a fresh repo — the workflow token lacks the admin
scope required. Before the first deploy, run:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
```

This is a one-time step. Once Pages is provisioned, all subsequent
nightly runs publish cleanly and the `enablement: true` line is a
silent no-op. The `docs-agent-nightly.yml` workflow already has this
call documented in its header comment.

## Where to look if the nightly fails

- **Build check**: `.github/workflows/docs-build-check.yml` runs on
  every PR and is the fastest signal — a bad page or broken nav entry
  surfaces here first.
- **Nightly logs**: Actions tab → `docs-agent-nightly` → the most recent
  run. The agent emits one log line per page it writes or skips.
- **State file**: `.engineering-docs-agent/state.yml` (written by the
  agent, gitignored locally) records the last-processed PR number per
  lens. If the nightly skips pages it shouldn't, check whether this
  file's cursor advanced past the target PRs.

A future `operations/` section under the core lens would be a more
natural home for infrastructure notes like this one. For now this page
lives flat at the lens root.
