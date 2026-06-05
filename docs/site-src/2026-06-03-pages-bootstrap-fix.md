---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
---

# Pages bootstrap fix — CCE-82 consumer side (PR #125)

**No behavioral change.** Workflow, tests, and docs only.

## Background

During the CCE-81 incident (PR #121), GitHub Pages had to be bootstrapped
manually for the first deploy of the mkdocs docs site. The root cause — that
`actions/configure-pages@v6 enablement: true` cannot actually create a Pages
instance on first run because the default `GITHUB_TOKEN` lacks the required
admin scope — is documented in `CLAUDE.md` and the mkdocs upgrade design spec.

The durable fix lives on the plugin side (CCE-82,
`theoju/engineering-docs-agent#103`): the plugin's setup scaffold now includes
the `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` call
that must be run once by a repo admin before the first deploy.

## What PR #125 changes on this consumer repo

**Removed `enablement: true`** from `.github/workflows/docs-agent-pages.yml`.
Once Pages exists (any path), that field is a silent no-op — it does nothing
and implies a capability the token doesn't have. The line is gone.

**Flipped the vitest assertion** in `docs-mkdocs-scaffold.test.mjs` from a
positive match (`toMatch(/enablement: true/)`) to a regression guard
(`not.toMatch(/enablement: true/)`). The line can't silently creep back into
the workflow through a template regeneration.

**Appended a one-line `Resolved by` footer** to the POST-IMPLEMENTATION
CORRECTION block in
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`, closing the
documentation trail from the incident.

**Shortened the `CLAUDE.md` Pages-bootstrap gotcha bullet** to defer to the
plugin's own CLAUDE.md as the durable, maintained source rather than
duplicating the full runbook here.

## Operational note for future host onboardings

Before the first deploy of any new repo that uses `framework: mkdocs`, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

from an admin-scoped `gh` login. This is the only step that actually creates
the Pages resource. After it exists, every subsequent push-triggered run of
`docs-agent-pages.yml` deploys cleanly via `deploy-pages@v5`.

The engineering-docs-agent plugin is expected to bake this call into its
`setup_scaffold` script (filed as a plugin tech-debt followup in the PR #121
description).
