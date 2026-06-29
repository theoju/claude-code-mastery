---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Engineering-docs-agent bootstrap (CCE-57)

PR #100 onboards this repository onto the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin.
After it merged, the agent runs on a nightly schedule and automatically syncs
documentation updates for every PR that lands — no manual intervention required.

## What was added

| File | Purpose |
| ---- | ------- |
| `.engineering-docs-agent/config.yml` | Plugin config: `framework: mkdocs`, core lens rooted at `docs/site-src/`, agent-editable paths declared |
| `.engineering-docs-agent/state.json` | Live agent state (updated each nightly run) |
| `.engineering-docs-agent/state.example.json` | Example state file checked in for reference |
| `.github/workflows/docs-agent-nightly.yml` | GitHub Actions workflow that triggers the agent on a nightly schedule |

## Why `framework: mkdocs`, not `framework: none`

During the design phase, CCE-64 introduced `framework: none` as a valid config
value for repos that publish docs without a static-site generator. A synthetic
mkdocs scaffold was briefly included in the PR but removed once that option
existed. The final config retains `framework: mkdocs` because this repo _does_
publish a mkdocs-Material site to GitHub Pages (see
`.github/workflows/docs-agent-pages.yml`). Using `framework: none` here would
have been a transitional workaround, not the correct long-term setting.

## Config snapshot

```yaml
# .engineering-docs-agent/config.yml
framework: mkdocs
lenses:
  core:
    root: docs/site-src/
agent_editable_paths:
  - docs/site-src/
```

The `core` lens root at `docs/site-src/` means the agent writes and edits pages
under that directory only. Paths outside `agent_editable_paths` are never
touched by the agent — the enforcement happens at the orchestrator level before
any write tool is called.

## How the nightly loop works

1. The `docs-agent-nightly.yml` workflow fires on a cron schedule (and can be
   triggered manually via `workflow_dispatch`).
2. The engineering-docs-agent reads merged PRs since the last run from
   `state.json`, summarizes each one, and dispatches page-author agents for any
   doc targets identified.
3. Page-author agents write or edit pages under `docs/site-src/` and open a PR
   with the changes.
4. The `docs-build-check.yml` workflow verifies every PR with `mkdocs build
   --strict` before merge.

The loop is fully automated after this bootstrap. The only ongoing maintenance
is keeping `.engineering-docs-agent/config.yml` current if the `docs/site-src/`
structure changes.

## Decision record

- **What**: bootstrap engineering-docs-agent on this repo (CCE-57)
- **When**: 2026-05-31 (PR #100)
- **Framework**: `mkdocs` — matches the published GitHub Pages site
- **Lens root**: `docs/site-src/` — all agent-authored pages live here
- **Alternative considered**: `framework: none` (CCE-64) — rejected in favor of
  the accurate value since mkdocs is already in use
