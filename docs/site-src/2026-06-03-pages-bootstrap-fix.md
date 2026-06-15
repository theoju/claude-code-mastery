---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# Decision: Drop `enablement: true` from the Pages Deploy Workflow

**PR:** #125 · **CCE:** CCE-82 · **Date:** 2026-06-03

## What changed

PR #125 removes the `enablement: true` line from
`.github/workflows/docs-agent-pages.yml`. The workflow's
`actions/configure-pages@v6` step is still present — it is still
needed to configure the Pages artifact environment — but the
`enablement` field is gone.

A vitest assertion in
`scripts/__tests__/docs-mkdocs-scaffold.test.mjs` now acts as a
regression guard:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

If a future contributor re-adds the line, that test fails CI before
the change reaches `main`.

## Why `enablement: true` was a no-op

`actions/configure-pages@v6` advertises the `enablement` input as a
way to bootstrap GitHub Pages on a repository that has never enabled
it. In practice this fails silently on any repo whose Pages source
has not already been initialized. The action calls
`POST /repos/<owner>/<repo>/pages` to set `build_type: workflow`, but
`GITHUB_TOKEN` does not carry the admin scope that endpoint requires —
even with `permissions: pages: write` declared in the workflow. The
`permissions:` block can only _restrict_ a token's default scopes, not
expand them past their ceiling. The result: the very first deploy
attempt on a fresh repo exits with
`Resource not accessible by integration`, and on every subsequent run
after Pages is already enabled the field is a silent no-op.

The field name is genuinely misleading. It implies the action can
enable Pages on your behalf. It cannot.

## What actually bootstraps Pages

You must call the API once from a token that has the admin scope —
either a personal access token or an org-level fine-grained token with
repository administration write:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or via the GitHub UI: **Settings → Pages → Build and deployment →
Source → GitHub Actions**.

`build_type=workflow` is durable. Once set, every subsequent run of
`docs-agent-pages.yml` deploys cleanly via
`actions/deploy-pages@v5`'s artifact upload path. This is also what
disables branch-deploy publishing — only the workflow-upload path
reaches `theoju.github.io/claude-code-self-assessment/`.

## Where the canonical fix lives

The engineering-docs-agent plugin PR (theoju/engineering-docs-agent#103,
also tagged CCE-82) landed the durable fix for all future host
onboardings: the plugin's `setup_scaffold` script (when it exists) or
its onboarding documentation now includes the `gh api` call as an
explicit step. This consumer-side PR mirrors that fix by removing the
no-op line from the already-onboarded host repo's workflow and wiring
the regression guard.

## Affected files

| File | Change |
| ---- | ------ |
| `.github/workflows/docs-agent-pages.yml` | `enablement: true` removed from `actions/configure-pages@v6` step |
| `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` | Assertion flipped to `not.toMatch(/enablement:\s*['"]?true['"]?/)` |
| `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` | One-line resolution footer added to the POST-IMPLEMENTATION CORRECTION block |
| `CLAUDE.md` | Gotcha bullet shortened; durable guidance delegated to the plugin's CLAUDE.md |

## If you're onboarding a new host repo

1. Run `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`
   from a personal/admin `gh` login **before** the first workflow
   dispatch.
2. The workflow in this repo is the reference shape: `configure-pages@v6`
   (no `enablement`), `mkdocs build --strict`, `upload-pages-artifact@v5`,
   `deploy-pages@v5`.
3. The CI test in `docs-mkdocs-scaffold.test.mjs` will catch a
   regression if `enablement: true` ever re-appears.
