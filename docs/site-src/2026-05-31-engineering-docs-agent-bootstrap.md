---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-Docs-Agent Bootstrap

PR #100 (CCE-57) enrolls this repository as a plugin host for the
engineering-docs-agent. After the PR merges, the nightly CI workflow can
produce lens pages, What's New entries, and automated PRs without any
per-run manual setup.

## What was added

Three files land in the repo alongside a new CI workflow:

| File | Purpose |
| ---- | ------- |
| `.engineering-docs-agent/config.yml` | Plugin host config — sets `framework: none` |
| `.engineering-docs-agent/agent-state.json` | Seeded agent state file |
| `.engineering-docs-agent/agent-state.template.json` | State template for reset / re-init |
| `.github/workflows/docs-agent-nightly.yml` | Nightly CI workflow with all required fixes bundled |

## `framework: none`

The host config uses `framework: none`, a first-class config value introduced
in CCE-64. Before CCE-64, the only way to enroll a plain-markdown repo was to
install a synthetic mkdocs scaffold — adding a build-tool dependency the repo
doesn't need and never had. CCE-64 made `none` a valid value so the config
accurately reflects the repo's shape. PR #100 removes the originally-planned
scaffold entirely; `framework: none` is the correct long-term setting here.

## Nightly workflow

`.github/workflows/docs-agent-nightly.yml` bundles fixes from four earlier CCE
tickets:

| Fix | Ticket | What it does |
| --- | ------ | ------------ |
| App-token wiring | CCE-45 | Authenticates with the correct GitHub App token on each run |
| OAuth validation | CCE-49 | Validates OAuth scopes before the agent run starts |
| Forensics upload | CCE-41 | Uploads agent run artifacts on failure for post-mortem inspection |
| Jira wiring | CCE-53 | Connects agent PR output to the CCE Jira project |

All four fixes were merged and tested upstream in the plugin repo before this
PR wired them into this host for the first time.

## What it enables

Once the nightly workflow is smoke-tested and branch protection is in place, the
agent can:

- Produce and update **lens pages** (like this one) under `docs/site-src/`
- Write **What's New entries** in `docs/site-src/whats-new.md` from merged PRs
- Open **automated PRs** against `main` with documentation changes

Post-merge tasks — per-host runbook, branch protection setup, first nightly
smoke-test — live in the plugin repo and are tracked there rather than here.
