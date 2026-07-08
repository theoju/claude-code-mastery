---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs site architecture

The published docs site at
[theoju.github.io/claude-code-self-assessment](https://theoju.github.io/claude-code-self-assessment/)
is built by [MkDocs](https://www.mkdocs.org/) with the
[Material](https://squidfunk.github.io/mkdocs-material/) theme. Source lives
under `docs/site-src/`; everything under `docs/superpowers/` (specs, plans)
stays in-repo but unpublished — it's design history for plugin lens
analysis, not user-facing documentation.

This page describes how the pieces fit together: the mkdocs config, the two
GitHub Actions workflows that build/gate/publish it, and how the
engineering-docs-agent plugin is wired to write into it.

## Source layout

`mkdocs.yml` pins `docs_dir: docs/site-src` and `site_dir: site` (the build
output, gitignored). Navigation order is explicit rather than
alphabetical — the `literate-nav` plugin reads it from `docs/site-src/SUMMARY.md`
instead of inferring it from the filesystem:

```
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
    - [Boris Tips](boris-tips-reference-2026-05-10.md)
    - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

The theme (`theme.name: material`) enables `navigation.tabs`,
`navigation.sections`, `navigation.indexes`, `navigation.top`, `toc.follow`,
`search.suggest`, and `content.code.copy` — no analytics, no social cards,
no instant-loading; those were cut as non-goals to keep the first version's
surface small. `markdown_extensions` adds `admonition`, `attr_list`,
`md_in_html`, `tables`, permalinked `toc`, `pymdownx.highlight`, and
`pymdownx.superfences` with a custom `mermaid` fence — so mermaid diagrams
in migrated design docs render as diagrams, not code blocks. Plugin set is
deliberately minimal: `search`, `awesome-pages`, `literate-nav`. There's no
`mkdocstrings` — the dashboard's TypeScript isn't a public API surface, and
mkdocstrings is Python-only anyway.

Versions are pinned in `requirements-docs.txt` (`mkdocs==1.6.1`,
`mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
`mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`) so a future
mkdocs-material release can't silently change how `pymdownx.superfences`
renders.

## Two workflows, two responsibilities

The build/gate/publish path is split across two workflows that never
overlap in trigger:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/docs-build-check.yml` | `pull_request` on `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow file itself | `pip install -r requirements-docs.txt` then `mkdocs build --strict --site-dir /tmp/site`. Never deploys. |
| `.github/workflows/docs-agent-pages.yml` | `push` to `main` on the same path filter, plus `workflow_dispatch` | `mkdocs build --strict` → writes `site/.nojekyll` → `upload-pages-artifact` → `deploy-pages`. |

The PR-level gate exists so a broken link or missing `SUMMARY.md` reference
fails review, not the next nightly's post-merge deploy — `mkdocs build
--strict` treats unresolved links and orphaned nav entries as hard errors.
Both workflows share the same `paths:` filter, so a commit touching only
`scripts/` or `app/` never triggers either one.

`docs-agent-pages.yml` runs as two jobs, `build` then `deploy`, gated by a
`pages` concurrency group (`cancel-in-progress: false`) so overlapping
pushes serialize rather than race. The `deploy` job needs
`permissions: pages: write` and `id-token: write` on top of the default
`contents: read` — that's the OIDC token GitHub Pages deployment uses.

One gotcha worth carrying forward: `actions/configure-pages@v6`'s
`enablement: true` option looks like it bootstraps Pages on a repo's first
deploy, but it doesn't — the workflow's `GITHUB_TOKEN` can't call
`POST /repos/.../pages` (that needs admin scope, and `permissions:` blocks
can only restrict the default token, never grant it beyond what GitHub
issues). The current workflow doesn't carry the `enablement:` line for this
reason; Pages was bootstrapped once, out of band, via
`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`. See the
CLAUDE.md Conventions section for the full incident and the durable fix.

## How the engineering-docs-agent plugin is wired in

`.engineering-docs-agent/config.yml` points the plugin at this scaffold:

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

`lens_paths.core: docs/site-src/` is the important scoping decision — it
keeps the nightly's lens analysis (and this page-author agent) confined to
the published tree and out of `docs/superpowers/specs/`, which is design
history, not a lens page. `agent_editable_paths: ["docs/**"]` is broader
than `lens_paths` on purpose: it's the write-permission boundary (specs and
plans stay agent-writable for maintenance edits) while `lens_paths` is the
narrower "these are the pages a nightly lens-fill targets" set.

With `framework: mkdocs` and a real `base_url`, the plugin's
publish-verifier stage actually runs: after `build_workflow` completes for
the current `main` HEAD, it checks `base_url` plus each lens page resolves
within `verify_timeout_seconds` (60s here). Before this PR, `framework: none`
and `base_url: null` meant that stage always short-circuited with
`verify_skipped` in `partial_reasons` — there was nothing to verify against.

## What did and didn't move

The four pre-existing flat docs files (`self-assessment.md`,
`ship-pattern.md`, `boris-tips-reference-2026-05-10.md`,
`tip-classification-2026-05-10.md`) and `docs/images/` moved to
`docs/site-src/` verbatim — content untouched, only image references and
the two path strings inside `app/docs/ship-pattern/page.tsx` (the render
path and the on-page display string) updated to match. `docs/superpowers/`
did not move; it's excluded from the site by the `lens_paths` scoping
above, not by any mkdocs-level ignore rule — the files are simply never
referenced from `SUMMARY.md` or any lens page, so `literate-nav` never
surfaces them and no route resolves for them on the built site.

There's no IA restructuring in this version — the published site is
intentionally flat (`index.md`, `self-assessment.md`, `ship-pattern.md`, a
`Reference` group, `whats-new.md`). Introducing dedicated
`architecture/` or `operations/` sections is a candidate follow-up once
enough dated pages like this one accumulate at the lens root to justify
the reorganization.
