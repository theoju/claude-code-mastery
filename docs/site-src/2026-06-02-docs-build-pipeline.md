---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs build pipeline

The published docs site — [theoju.github.io/claude-code-self-assessment](https://theoju.github.io/claude-code-self-assessment/) —
is built by [MkDocs](https://www.mkdocs.org/) (Material theme) from
`docs/site-src/` and deployed to GitHub Pages. This page covers how the
pipeline is wired: the scaffold, the two GitHub Actions workflows, and the
gotchas that bit the first deploy.

Landed in PR #121 (CCE-81), replacing a `framework: none` engineering-docs-agent
config where `docs/*.md` was just plain markdown GitHub rendered at
`/blob/main/docs/`.

## Scaffold

Three files at the repo root drive the build:

- **`mkdocs.yml`** — `docs_dir: docs/site-src`, `site_dir: site`. Theme is
  `material` with `navigation.tabs`, `navigation.sections`,
  `navigation.indexes`, `navigation.top`, `toc.follow`, `search.suggest`, and
  `content.code.copy` enabled. Three plugins: `search`, `awesome-pages`, and
  `literate-nav` (nav is driven by `docs/site-src/SUMMARY.md` rather than an
  inline `nav:` block in `mkdocs.yml`). Markdown extensions include
  `admonition`, `attr_list`, `md_in_html`, `tables`, `toc` (with permalinks),
  `pymdownx.highlight`, `pymdownx.superfences` (with a `mermaid` custom
  fence), and `pymdownx.details`.
- **`requirements-docs.txt`** — pinned versions:
  `mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
  `mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
  `pymdown-extensions==10.11.2`.
- **`docs/site-src/SUMMARY.md`** — the literate nav. Currently a flat list:
  Home, Self-Assessment, Ship Pattern, a Reference section (Boris Tips, Tip
  Classification), and What's New. New pages need an entry here or
  `literate-nav` won't route them into the site nav (they'd still build, just
  be unreachable from the nav tree).

The existing `docs/*.md` files were migrated into `docs/site-src/` verbatim —
no content rewriting, per the design spec's explicit non-goal. `docs/superpowers/specs/`
and `docs/superpowers/plans/` stay in-repo but unpublished; they're outside
`docs_dir` so mkdocs never touches them.

## Two workflows, two responsibilities

| Workflow | Trigger | Job |
| --- | --- | --- |
| `.github/workflows/docs-build-check.yml` | `pull_request` on paths `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or either workflow file; `workflow_dispatch` | Installs `requirements-docs.txt`, runs `mkdocs build --strict --site-dir /tmp/site`. Never deploys. Gates PRs — the whole reason it exists is so a broken link or nav reference fails review, not the post-merge Pages build. |
| `.github/workflows/docs-agent-pages.yml` | `push` to `main` on the same path filter (minus the build-check workflow itself); `workflow_dispatch` | `actions/checkout` → `actions/configure-pages@v6` → `actions/setup-python@v6` (3.12, pip-cached on `requirements-docs.txt`) → `pip install -r requirements-docs.txt && mkdocs build --strict` → `touch site/.nojekyll` → `actions/upload-pages-artifact@v5` → separate `deploy` job running `actions/deploy-pages@v5`. |

Both run the identical `mkdocs build --strict` command against the same
pinned deps, so a PR that passes the gate builds the same artifact on merge —
`docs-build-check.yml`'s own header comment calls it a mirror of the build
step. `docs-agent-pages.yml` runs with `permissions: pages: write, id-token:
write` (needed by `deploy-pages@v5`); `docs-build-check.yml` only needs
`contents: read` since it never uploads or deploys. The pages job also sets
`concurrency: { group: pages, cancel-in-progress: false }` so overlapping
pushes to `main` queue rather than race; the PR check instead cancels
superseded runs on the same branch (`cancel-in-progress: true`) since only
the latest commit's build matters for review.

`.nojekyll` matters here: without it, GitHub Pages' default Jekyll
processing would mangle any `docs_dir` path starting with an underscore
(mkdocs-material emits some under `assets/`), so the workflow touches it
into the built `site/` output before upload.

## Config wiring

`.engineering-docs-agent/config.yml` declares `framework: mkdocs`,
`source_dir: docs`, and a `core` lens rooted at `docs/site-src/`. The
`publishing` block ties the orchestrator's publish-verifier to this same
pipeline: `base_url: https://theoju.github.io/claude-code-self-assessment/`,
`build_workflow: docs-agent-pages.yml`, `verify_timeout_seconds: 60`. Per the
comment in the config, a failed verification adds `verify_failed` to
`partial_reasons` on the orchestrator run but doesn't block it — the nightly
authoring loop and the Pages build are deliberately decoupled failure
domains. `whats_new_file: docs/site-src/whats-new.md` and
`agent_editable_paths: ["docs/**"]` are also declared here; the latter is
what makes `docs/site-src/2026-06-02-docs-build-pipeline.md` (this page) a
legal write target for the page-author agent.

## The GitHub Pages bootstrap gotcha

The first deploy of `docs-agent-pages.yml` failed even with
`actions/configure-pages@v6`'s `enablement: true` and `permissions: pages:
write` declared: `Resource not accessible by integration`. `configure-pages@v6`'s
`enablement` field does not actually bootstrap Pages on a repo where it has
never been turned on — that call needs admin scope the workflow's
`GITHUB_TOKEN` doesn't carry, and `permissions:` can only narrow the
default token's scopes, never grant new ones. The fix is a one-time, one-off
step outside the workflow: `gh api -X POST repos/<owner>/<repo>/pages -f
build_type=workflow` run by an admin login (or the equivalent UI path,
Settings → Pages → Build and deployment → Source = "GitHub Actions"). Once
that's set, every subsequent push-triggered run works cleanly, and the
`enablement: true` line becomes a permanent no-op — it was removed from the
workflow in a later cleanup (PR #125 / CCE-82). Worth knowing if this
pipeline is ever replicated onto a fresh host repo: bake the `gh api` call
into onboarding rather than rediscovering the 422.

## Verifying a docs change locally

```bash
pip install -r requirements-docs.txt
mkdocs build --strict --site-dir /tmp/site   # matches the CI gate exactly
mkdocs serve                                  # live preview at :8000
```

`--strict` turns warnings (broken internal links, nav entries pointing at
files outside `docs_dir`, unrecognized markdown extensions) into a
non-zero exit — the same behavior both workflows rely on to catch a bad PR
before it merges. A page can exist on disk and still fail this check if
nothing in `SUMMARY.md` or another page's links points at it correctly
relative to `docs_dir`.
