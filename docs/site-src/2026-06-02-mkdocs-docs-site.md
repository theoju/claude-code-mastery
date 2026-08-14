---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs site architecture

The project's markdown documentation is published as a browsable,
versioned site at <https://theoju.github.io/claude-code-self-assessment/>,
built with mkdocs-material and deployed to GitHub Pages. This page
describes how the pieces fit together: the source layout, the mkdocs
scaffold, and the two CI workflows that build and gate it.

Before PR #121, the engineering-docs-agent integration for this repo
ran with `framework: none` — `docs/*.md` was plain markdown rendered
ad hoc by GitHub's blob viewer, and the nightly orchestrator's
publish-verifier stage skipped with `verify_skipped` because there was
no published site to check reachability against. `framework: mkdocs`
in `.engineering-docs-agent/config.yml` closes that gap.

## Source layout

Doc content lives under `docs/site-src/`, which is `docs_dir` in
`mkdocs.yml`. The existing flat `docs/*.md` files (the self-assessment
guide, the ship-pattern summary, the Boris tip reference and
classification docs) moved into this directory verbatim as part of
the migration — no content rewriting, no heading changes.

Navigation is driven by `docs/site-src/SUMMARY.md` rather than an
inline `nav:` block in `mkdocs.yml`, via the `literate-nav` plugin.
Adding a page to the published site means creating the markdown file
under `docs/site-src/` **and** adding a line to `SUMMARY.md`; a file
that exists on disk but isn't listed there won't appear in the site
navigation (mkdocs-awesome-pages can still surface it depending on
ordering, but literate-nav is the source of truth here).

`docs/superpowers/specs/` and `docs/superpowers/plans/` stay in-repo
for plugin lens analysis but are deliberately **not** part of
`docs_dir`, so they're excluded from the published site.

## `mkdocs.yml` scaffold

The scaffold is Material theme + three plugins, no Python-only
extras:

```yaml
plugins:
  - search
  - awesome-pages
  - literate-nav:
      nav_file: SUMMARY.md
```

- **`search`** — built-in full-text search over the published pages.
- **`awesome-pages`** — lets a directory (e.g. a future `archive/`
  subpath under the `core` lens) control its own ordering/title
  without a fully hand-written nav tree.
- **`literate-nav`** — reads `SUMMARY.md` as the nav source instead of
  requiring a `nav:` block in `mkdocs.yml` itself, so adding a page is
  a one-line diff to a docs file rather than a config-file edit.

`markdown_extensions` add `admonition`, `attr_list`, `md_in_html`,
`tables`, `toc` (with permalinks), `pymdownx.highlight`,
`pymdownx.superfences` (including a `mermaid` custom fence), and
`pymdownx.details`. Versions are pinned in `requirements-docs.txt`
(`mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
`mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
`pymdown-extensions==10.11.2`).

Two things the scaffold deliberately leaves out: no
`mkdocstrings`-family plugin (this repo's TypeScript app/scripts
aren't a public API surface worth documenting that way), and no
social-cards / instant-loading / git-revision-date plugins (compelling
but deferred to keep the first-cut PR surface small).

## Two CI workflows, two responsibilities

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/docs-agent-pages.yml` | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow file itself, plus `workflow_dispatch` | `mkdocs build --strict` → write `.nojekyll` → `upload-pages-artifact` → `deploy-pages` |
| `.github/workflows/docs-build-check.yml` | `pull_request` touching the same paths, plus `workflow_dispatch` | `mkdocs build --strict` into a scratch `/tmp/site` dir — never deploys |

They share the strict-build step almost verbatim but exist for
different reasons. `docs-agent-pages.yml` is the one that actually
publishes: it needs `pages: write` and `id-token: write` permissions
and runs the `actions/configure-pages@v6` → `actions/setup-python@v6`
→ build → `actions/upload-pages-artifact@v5` → `actions/deploy-pages@v5`
chain, gated by a `concurrency: group: pages` so overlapping pushes to
`main` don't race each other. `docs-build-check.yml` is a pure PR gate
— `contents: read` only, no deploy step — so a broken internal link or
nav entry fails CI feedback on the PR itself instead of only surfacing
after the merge-triggered Pages build breaks. Its concurrency group is
keyed per-branch (`docs-build-check-${{ github.ref }}`) with
`cancel-in-progress: true`, since only the latest commit on a PR needs
to pass and the build itself is ~30s with the pip cache warm.

Both workflows install from the same pinned `requirements-docs.txt`
via `actions/setup-python@v6` with `cache: pip` keyed on that file, so
a version bump in one place is picked up by both build paths.

`--strict` is the load-bearing flag in both: it turns mkdocs warnings
(broken internal links, pages missing from nav, unresolved cross-refs)
into a nonzero exit rather than a build-time log line — which is what
makes `docs-build-check.yml` useful as a gate at all.

## Config: `.engineering-docs-agent/config.yml`

The host config sets `docs.framework: mkdocs`, `docs.source_dir: docs`,
and `docs.lens_paths.core: docs/site-src/`. On the publishing side,
`publishing.base_url` points at the GitHub Pages URL,
`publishing.build_workflow: docs-agent-pages.yml` tells the
publish-verifier which workflow run to check for the current `main`
HEAD, and `publishing.verify_timeout_seconds: 60` bounds how long it
waits for `base_url` plus each lens page to become reachable. A failed
verification adds `verify_failed` to `partial_reasons` rather than
blocking the run outright.

`docs.agent_editable_paths` is scoped to `docs/**` — the
engineering-docs-agent orchestrator (and this page-author subagent)
can only write inside that tree, which is why the scaffold files
(`mkdocs.yml`, `requirements-docs.txt`, the workflow YAML) needed to
be hand-authored in the originating PR rather than agent-generated on
a later run.

## GitHub Pages prerequisite

`actions/configure-pages@v6`'s `enablement: true` option does **not**
bootstrap Pages on a repo where it has never been turned on — the
workflow's default `GITHUB_TOKEN` lacks the admin scope
`POST /repos/.../pages` needs, so a truly first deploy fails with
`Resource not accessible by integration` even with `pages: write`
declared. Pages has to be switched on once, out of band, by a
personal/admin login (`gh api -X POST repos/<owner>/<repo>/pages -f
build_type=workflow`, or the equivalent Settings → Pages → Source =
"GitHub Actions" UI path) before the first run of
`docs-agent-pages.yml` can succeed. After that, `enablement: true` is
a permanent no-op and every subsequent push-triggered run works
normally.

## See also

- [Self-Assessment](self-assessment.md) and [Ship Pattern](ship-pattern.md)
  are the pages that moved into `docs/site-src/` as part of this
  migration.
- The design spec and archived plan for this work live under
  `docs/superpowers/specs/` and `docs/superpowers/plans/` (unpublished,
  in-repo only — see [Source layout](#source-layout) above).
