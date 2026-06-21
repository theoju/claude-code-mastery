---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: Upgrade docs site to mkdocs-Material (CCE-81)

**Date:** 2026-06-02  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)  
**Ticket:** CCE-81  
**Status:** Shipped

## What changed

The engineering-docs-agent integration was running with `framework: none` in
`.engineering-docs-agent/config.yml`. In that stance the `publish-verifier`
stage of the nightly agent run always skipped with `verify_skipped` — there was
no live site to verify against, so the nightly did read/write work on markdown
but never confirmed delivery.

PR #121 flips the integration to `framework: mkdocs` and publishes a
[Material-theme docs site](https://theoju.github.io/claude-code-self-assessment/)
on GitHub Pages. The `publish-verifier` stage now runs end-to-end on every
nightly.

## What was scaffolded

**`mkdocs.yml`** — Material theme with three plugins:

- `search` (built-in)
- `awesome-pages` — directory-level `.pages` ordering
- `literate-nav` — navigation driven by `docs/site-src/SUMMARY.md`

`docs_dir` is `docs/site-src`; `site_dir` is `site`. The build runs
`mkdocs build --strict`, which rejects broken cross-references at build time
rather than silently 404ing at runtime.

**`requirements-docs.txt`** — five pinned dependencies:

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

**`.github/workflows/docs-agent-pages.yml`** — push-to-main deploy pipeline.
Path filter limits runs to changes under `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or the workflow itself. Sequence: install Python 3.12
with pip cache → `pip install -r requirements-docs.txt` → `mkdocs build
--strict` → upload artifact → `actions/deploy-pages@v5`. A `.nojekyll` file
is written into `site/` so GitHub Pages serves the artifact as-is without
Jekyll processing.

**`.github/workflows/docs-build-check.yml`** — PR-level `mkdocs build
--strict` gate. Same path filter as the deploy workflow. Runs on the same
paths plus changes to either workflow file. Cancels superseded runs on the same
PR branch (`cancel-in-progress: true`). Without this gate, broken links would
only be caught post-merge by the Pages deploy — too late for review feedback.

**Nine broken relative links repaired** — the existing `docs/site-src/*.md`
pages contained relative links to `docs/superpowers/specs/` and `.claude/`
paths. Both are outside `docs/site-src/` (the `docs_dir`), so `mkdocs build
--strict` rejects them. They were rewritten to absolute GitHub blob URLs.

**`.engineering-docs-agent/config.yml` updated** — three fields populated that
activate the publish-verifier:

```yaml
publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
```

and `framework: mkdocs` at the top.

## Why mkdocs-Material

The engineering-docs-agent plugin's dogfood repo uses the same stack (mkdocs +
Material + awesome-pages + literate-nav). Reusing that proven combination keeps
the plugin's own CI scripts and theme assumptions aligned with what the host
deploys. The scaffold was authored by hand — the plugin's `setup_scaffold`
script does not exist in the installed version (only `setup_discover.py` ships,
which is read-only). The Material theme was chosen for search, navigation tabs,
and code-copy UX without requiring a separate JS build step.

## Onboarding gotcha: GitHub Pages first deploy

`actions/configure-pages@v6` with `enablement: true` **does not** auto-bootstrap
GitHub Pages on a first deploy. Despite the field name, the workflow's
`GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages`. The very first run fails with
`Resource not accessible by integration` even with `permissions: pages: write`
declared (those permissions can only restrict the default token's scopes, never
expand them).

**Before the first workflow run, bootstrap Pages with:**

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

or via **Settings → Pages → Source = GitHub Actions** in the repo UI.
`build_type=workflow` is durable — once set, all subsequent push-triggered runs
of `docs-agent-pages.yml` work automatically. The `enablement: true` line was
removed from the workflow in this PR; it was a silent no-op after bootstrap.

This incident is documented in `CLAUDE.md` under "actions/configure-pages@v6
enablement: true does NOT actually bootstrap GitHub Pages on a first deploy".

## What the nightly agent now does

With `framework: mkdocs` and `build_workflow: docs-agent-pages.yml` set, the
nightly engineering-docs-agent run:

1. Reads merged PRs since the last run.
2. Writes or edits lens pages under `docs/site-src/` (the core lens root).
3. Appends a `whats-new.md` entry.
4. Opens a `docs-agent/YYYY-MM-DD` PR.
5. Runs the **publish-verifier** stage: checks that `docs-agent-pages.yml`
   completed for the current HEAD on `main` and that `base_url` plus each lens
   page is reachable within 60 seconds. A failed verification adds
   `verify_failed` to `partial_reasons` but does not block the run.

The verifier step previously always emitted `verify_skipped`. It now runs.

## Test coverage

PR #121 added 21 vitest test cases across three new test files:

- `scripts/__tests__/docs-path-migration.test.mjs` — verifies the nine link rewrites landed correctly
- `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` — scaffold integrity (mkdocs.yml shape, requirements.txt pins, workflow trigger paths)
- `scripts/__tests__/docs-config-mkdocs.test.mjs` — config contract (`framework`, `base_url`, `build_workflow` all populated and consistent)
