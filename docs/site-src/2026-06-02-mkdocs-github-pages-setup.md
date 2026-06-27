---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: mkdocs + GitHub Pages setup (CCE-81)

**Date:** 2026-06-02  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)  
**Status:** Merged

## What was decided

Upgrade the engineering-docs-agent integration from `framework: none`
to `framework: mkdocs`, publishing a Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>. The config in
`.engineering-docs-agent/config.yml` had explicitly documented the
upgrade path:

> If you later scaffold mkdocs and add a deploy workflow, swap
> framework to mkdocs and fill in base_url + build_workflow.

This PR executes that path after three independent pre-execution
validation agents caught real blockers before implementation: broken
`.claude/` cross-tree links, missed path references in
`.claude/commands/`, and a missing CI PR gate.

## What changed

### CI workflows

Two new workflows were added:

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| **Pages deploy** | `.github/workflows/docs-agent-pages.yml` | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow itself | Runs `mkdocs build --strict`, uploads `site/` as a Pages artifact, deploys via `deploy-pages@v5` |
| **PR build gate** | `.github/workflows/docs-build-check.yml` | pull request touching the same paths | Runs `mkdocs build --strict` only — no deploy. Cancels superseded runs on the same PR branch |

The PR gate is critical: without it, broken cross-references land on
`main` and the post-merge Pages workflow is the first thing that
catches them, too late for review feedback. The gate takes ~30 s with
pip cache warm.

### Source migration

Existing flat `docs/*.md` files moved into `docs/site-src/` (the
`docs_dir` declared in `mkdocs.yml`). Nine broken relative cross-tree
links were repaired as part of the move. Navigation is driven by
`docs/site-src/SUMMARY.md` via the `literate-nav` plugin.

### Config flip

Five fields changed in `.engineering-docs-agent/config.yml`:

| Field | Before | After |
|---|---|---|
| `docs.framework` | `none` | `mkdocs` |
| `publishing.base_url` | `null` | `https://theoju.github.io/claude-code-self-assessment/` |
| `publishing.build_workflow` | `null` | `docs-agent-pages.yml` |
| `publishing.url_map_rule` | — | `standard` |
| `publishing.verify_timeout_seconds` | — | `60` |

With `framework: mkdocs`, the nightly's `publish-verifier` stage no
longer skips with `verify_skipped`.

### Path-reference updates

Six source files updated to the new `docs/site-src/` paths: `README.md`,
`CLAUDE.md`, `app/data/rubric.json`, `.claude/commands/self-assessment.md`,
`.claude/commands/refresh-insights.md`, and the self-assessment skill.

### Tests

21 new unit tests were added across three files:

- `scripts/__tests__/docs-path-migration.test.mjs` — verifies moved
  file paths are correct
- `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` — scaffold
  integrity (mkdocs.yml keys, requirements-docs.txt content)
- `scripts/__tests__/docs-config-mkdocs.test.mjs` — `.engineering-docs-agent/config.yml`
  contract

## mkdocs stack

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

`mkdocs.yml` sets `docs_dir: docs/site-src` and `site_dir: site`.
The Material theme enables `navigation.tabs`, `navigation.sections`,
`navigation.indexes`, `navigation.top`, `toc.follow`, `search.suggest`,
and `content.code.copy`. `docs/superpowers/specs/` is intentionally
excluded from the site nav — it stays in-repo for plugin lens analysis
but is not published.

## Post-merge incident: `configure-pages@v6 enablement: true` is a no-op

The workflow originally included `enablement: true` in the
`actions/configure-pages@v6` step. It does **not** bootstrap GitHub
Pages on first deploy.

**What happened:** the very first workflow run failed with:

```
Resource not accessible by integration
```

**Why:** the workflow `GITHUB_TOKEN` lacks the admin scope required to
call `POST /repos/.../pages`. The `permissions:` block in a workflow can
only _restrict_ the default token's scopes, never expand them. So
`enablement: true` is silently ignored on all subsequent runs once Pages
exists, and fails fatally on the first run before Pages has been
bootstrapped.

**Fix — run this once from an admin login before the first deploy:**

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or use the UI: Settings → Pages → Build and deployment → Source →
"GitHub Actions". Either sets `build_type=workflow`, which is durable
— once set, all push-triggered runs of `docs-agent-pages.yml` work
cleanly.

`build_type=workflow` also disables branch-deploy publishing: the only
path to `theoju.github.io/<repo>/` is via `deploy-pages@v5`'s artifact
upload. That is the desired behavior for a mkdocs build, but worth
knowing if you expect static files on `main` to appear automatically.

The misleading `enablement: true` line was removed in PR #125 (CCE-82).
A negative regression test now guards against re-adding it:
`docs-config-mkdocs.test.mjs` asserts the workflow does not contain
`enablement:`.

## Durable onboarding note

For any future host repo being onboarded with `framework: mkdocs`, run
the `gh api` call above from an admin login **before** the first Pages
deploy. The engineering-docs-agent plugin's `setup_scaffold` script
should bake this in (filed as a plugin-side follow-up in the PR #121
description). Until then, the step is manual. This is recorded in
`CLAUDE.md` under "Conventions" and in the spec at
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` →
"Post-implementation correction".
