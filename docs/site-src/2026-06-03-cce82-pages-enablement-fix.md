---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# CCE-82: Drop misleading `enablement: true` from Pages workflow

**Date:** 2026-06-03  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)  
**Ticket:** CCE-82

## Decision

Remove `enablement: true` from the `configure-pages@v6` step in `.github/workflows/docs-agent-pages.yml`. Add a vitest assertion that guards against re-introduction. Shorten the CLAUDE.md gotcha bullet to point at the plugin's CLAUDE.md as the durable reference rather than duplicating the full explanation here.

## Context

`configure-pages@v6` documents an `enablement: true` field that is supposed to bootstrap GitHub Pages on first deploy. It does not work with the default `GITHUB_TOKEN`. The token's permissions block `POST /repos/.../pages` even when `permissions: pages: write` is declared in the workflow — `permissions:` can only restrict the default token's scopes, never expand them. The actual bootstrap requires a personal/admin token via `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` run once by a human.

The line was carried into `docs-agent-pages.yml` from the action's own documentation during the CCE-81 onboarding of the docs site. The CCE-81 incident already performed the manual bootstrap, so after that point `enablement: true` had no effect on any deploy. It was dead configuration, and its presence misleadingly suggested it was doing something.

## What changed

- **`docs-agent-pages.yml`**: Removed the `enablement: true` field from the `configure-pages@v6` step.
- **Vitest regression guard**: Flipped an existing assertion so that CI fails if `enablement: true` re-appears in the workflow file.
- **`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`**: Added a one-line resolution footer to close the POST-IMPLEMENTATION CORRECTION block that tracked this finding.
- **`CLAUDE.md`**: Shortened the `enablement: true` gotcha bullet — it now names the root cause and points at the plugin's CLAUDE.md for the durable onboarding procedure, rather than repeating it inline.

## Why now

The durable fix lives in the engineering-docs-agent plugin (`~/Projects/engineering-docs-agent`), which will bake the `gh api` bootstrap call into its `setup_scaffold` step for all future host repos. This consumer-side PR is a drive-by cleanup of the one already-onboarded host: remove the dead line before it confuses a future contributor, and lock it out with a test.

## Onboarding note (for future host repos)

Before the first deploy of a new repo under this workflow, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

from a personal/admin `gh` login. Equivalent UI path: Settings → Pages → Build and deployment → Source → GitHub Actions. Once Pages exists, every push-triggered run of `docs-agent-pages.yml` deploys cleanly and `enablement: true` would be meaningless regardless.

`build_type=workflow` disables branch-deploy publishing. The only path to `<owner>.github.io/<repo>/` is via `deploy-pages@v5`'s artifact upload, which is the correct channel for mkdocs builds.
