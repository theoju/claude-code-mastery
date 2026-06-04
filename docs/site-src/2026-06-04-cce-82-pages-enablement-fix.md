---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
---

# CCE-82: `enablement: true` removed from `configure-pages` workflow

**Date:** 2026-06-04  
**Ticket:** CCE-82  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)

## What changed

`docs-agent-pages.yml` previously passed `enablement: true` to the
`actions/configure-pages@v6` step. That line has been removed.

The `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` spec now
includes a post-implementation correction note recording the full incident.
`CLAUDE.md` carries the manual bootstrap command and the explanation so future
contributors don't repeat the onboarding failure.

## Why `enablement: true` doesn't work

Despite the parameter name, `enablement: true` does **not** bootstrap GitHub
Pages on a repository's first deploy. The default `GITHUB_TOKEN` lacks the
admin scope required to call `POST /repos/.../pages` — the API returns
`Resource not accessible by integration` even when
`permissions: pages: write` is declared in the workflow. (`permissions:` can
only restrict the token's default scopes, never expand them.)

Once Pages already exists on a repository, `enablement: true` becomes a
silent no-op on every subsequent run. Both states — first deploy and all
subsequent runs — are wrong in different ways, which is why the line is
misleading rather than merely inert.

The confusion surfaced during the v0.9.20 / PR #121 / CCE-81 onboarding
cycle, where the first deploy failed and the parameter implied it should have
handled setup automatically.

## Manual bootstrap (required on first deploy)

Before the first Pages deploy, run this from an account with repo-admin
access:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

`build_type=workflow` is the key detail: it tells GitHub that the source is a
GitHub Actions artifact upload rather than a branch. The setting is durable —
once applied, all subsequent push-triggered runs of `docs-agent-pages.yml`
work cleanly without any further setup.

The equivalent UI path: **Settings → Pages → Build and deployment → Source →
GitHub Actions**.

## Implications of `build_type=workflow`

Setting `build_type=workflow` disables branch-deploy publishing. Static files
committed to `main` will **not** appear at
`<owner>.github.io/<repo>/` automatically. The only publication path is
through `deploy-pages@v5`'s artifact upload — which is exactly what the
`docs-agent-pages.yml` workflow does and what you want for mkdocs builds.

If you later wonder why pushing a file to `main` doesn't update the published
site, this is why: the deploy is gated on the workflow run, not the push.

## Relationship to the plugin-side fix

This is the consumer-side change. The durable fix — updating the
`engineering-docs-agent`'s scaffold template and host-onboarding docs — landed
in `theoju/engineering-docs-agent` PR #103 (CCE-82). If you're onboarding a
new host repo using the plugin's `framework: mkdocs` config, the `gh api` call
above should be run before the first deploy regardless of what the workflow
template says.
