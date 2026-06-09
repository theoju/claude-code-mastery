---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs site architecture — mkdocs on GitHub Pages

The published documentation for this project lives at
<https://theoju.github.io/claude-code-self-assessment/>. It is built by
[MkDocs](https://www.mkdocs.org/) with the
[Material theme](https://squidfunk.github.io/mkdocs-material/) and deployed to
GitHub Pages on every push to `main`.

## What changed in PR #121

Before PR #121 the engineering-docs-agent config carried `framework: none`,
which caused the nightly agent to skip the publish-verifier stage entirely
(`verify_skipped`). PR #121 executed the documented upgrade path: flip the
framework, scaffold the required files, migrate existing docs, add CI gates.

| Item | Before | After |
| --- | --- | --- |
| `framework` in `.engineering-docs-agent/config.yml` | `none` | `mkdocs` |
| Published URL | — | `https://theoju.github.io/claude-code-self-assessment/` |
| Docs source root | `docs/*.md` (flat) | `docs/site-src/` |
| PR gate | none | `mkdocs build --strict` |
| Deploy trigger | — | push to `main` via artifact upload |

## File layout

```
mkdocs.yml                        # build config (theme, plugins, extensions)
requirements-docs.txt             # five pinned dependencies (mkdocs-material, etc.)
docs/site-src/                    # docs_dir — all source markdown lives here
  images/                         # committed assets (screenshot, etc.)
  SUMMARY.md                      # literate-nav nav file
  *.md                            # flat date-prefixed pages at lens root
.github/workflows/
  docs-agent-pages.yml            # push-to-main deploy via upload-pages-artifact
  docs-build-check.yml            # PR gate: mkdocs build --strict
.engineering-docs-agent/
  config.yml                      # framework: mkdocs, base_url, build_workflow, lens_paths
```

## mkdocs.yml highlights

The config at `mkdocs.yml` sets `docs_dir: docs/site-src` and `site_dir: site`. Three plugins run on every build:

- **search** — built-in full-text search.
- **awesome-pages** — respects `.pages` order files for sidebar ordering.
- **literate-nav** — drives the nav from `docs/site-src/SUMMARY.md` rather than
  the top-level `nav:` key, so the engineering-docs-agent can update navigation
  by editing one Markdown file.

`pymdownx.superfences` is configured with a Mermaid fence so diagram blocks
render in-browser without a separate build step.

## CI workflows

### `docs-build-check.yml` (PR gate)

Runs `mkdocs build --strict` on every pull request. `--strict` turns warnings
into errors, which catches broken relative links, missing `docs_dir` assets, and
nav references to non-existent files before they reach `main`. This is the
consumer-tool verification that a `test -f` check cannot provide — a file can
exist on disk while still violating mkdocs's validity contract.

### `docs-agent-pages.yml` (deploy)

Triggers on push to `main`. Builds the site with `mkdocs build` and uploads the
`site/` directory as a GitHub Pages artifact via `actions/upload-pages-artifact`,
then deploys with `actions/deploy-pages`. The artifact-upload path is required
because the repo uses `build_type=workflow` (see [First-deploy setup](#first-deploy-setup)
below) — static files pushed to `main` do not appear at the Pages URL.

## Engineering-docs-agent config

`.engineering-docs-agent/config.yml` now reads:

```yaml
framework: mkdocs
base_url: https://theoju.github.io/claude-code-self-assessment/
build_workflow: docs-agent-pages.yml
lens_paths:
  core: docs/site-src/
```

With `framework: mkdocs` set, the nightly agent's publish-verifier stage runs
after each lens-page write, checking that the deployed URL reflects the new
content rather than exiting early with `verify_skipped`.

## First-deploy setup

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
GitHub Pages on a first deploy. The field name implies it does, but the action
calls `POST /repos/.../pages`, which requires the admin scope — a scope
`GITHUB_TOKEN` cannot hold regardless of what you put in `permissions:`. The
very first run failed with `Resource not accessible by integration`.

**Recovery**: before the first deployment, run the following from a personal
GitHub CLI login with repo admin rights:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

This sets `build_type=workflow` on the repository permanently. After that, all
push-triggered runs of `docs-agent-pages.yml` succeed and the `enablement: true`
line is a silent no-op (it was deleted from the workflow as a follow-up). The
equivalent UI path is **Settings → Pages → Build and deployment → Source →
GitHub Actions**.

`build_type=workflow` also means branch-deploy publishing is disabled — the only
path to the Pages URL is via the `deploy-pages` artifact upload in
`docs-agent-pages.yml`. That is the correct behavior for a mkdocs build, but
worth knowing if static files committed to `main` don't appear at the URL.

## Test coverage

PR #121 added three vitest test files (21 cases) covering:

- **Path migration** — every `docs/*.md` file that existed before the upgrade
  now resolves under `docs/site-src/` and all relative links in the migrated
  files are valid.
- **Scaffold existence and content** — `mkdocs.yml` exists, declares the
  expected plugins, and sets `docs_dir: docs/site-src`; `requirements-docs.txt`
  lists the five pinned dependencies.
- **Config contract** — `.engineering-docs-agent/config.yml` has `framework:
  mkdocs`, a non-empty `base_url`, a `build_workflow` that names an existing
  workflow file, and `lens_paths.core` pointing at `docs/site-src/`.

## Operational notes

- **`mkdocs build --strict` is the canonical verification step.** Always run it
  (or let CI run it) after editing navigation or adding cross-page links. A
  passing `test -f` on a linked file is not sufficient.
- **`docs/site-src/images/` is the canonical location for committed image
  assets.** The `.gitignore` rule `dashboard-*.png` keeps ad-hoc screenshots
  out; name committed assets around it (e.g. `mastery-dashboard.png`).
- **New lens pages go under `docs/site-src/` as flat date-prefixed slugs** until
  subdirectory structure is established. The `available_sections[core]` currently
  contains only `images`; add subdirectories (`architecture/`, `operations/`,
  `archive/`) as volume warrants and update `SUMMARY.md` to match.
