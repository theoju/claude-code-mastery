---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: adopt MkDocs for the published docs site

## Context

Before PR #121 (CCE-81), `.engineering-docs-agent/config.yml` declared
`framework: none` and `publishing.base_url: null`. Docs lived as flat
markdown under `docs/`, browsable only through GitHub's own file-tree
renderer — relative links only resolved correctly when read inside the
GitHub UI, and there was no published, standalone site. The nightly
engineering-docs-agent orchestrator ran on schedule, but its
publish-verifier stage skipped with `verify_skipped` in
`partial_reasons` every time, because there was no built site to verify
a URL against.

The config file itself documented the intended escape hatch: flip
`framework` to `mkdocs`, add a Pages deploy workflow, and fill in
`base_url` + `build_workflow` once a real site exists.

## Decision

Adopt MkDocs with the Material theme as the docs framework, publish the
build to GitHub Pages at
`https://theoju.github.io/claude-code-self-assessment/`, and flip
`.engineering-docs-agent/config.yml` (`.engineering-docs-agent/config.yml`) to
`framework: mkdocs` with the matching `publishing.base_url` and
`publishing.build_workflow: docs-agent-pages.yml`.

The scaffold (`mkdocs.yml`) pins a minimal plugin set — `search`,
`awesome-pages`, and `literate-nav` (nav ordering delegated to
`docs/site-src/SUMMARY.md`) — plus a small, deliberately narrow
`markdown_extensions` list (`admonition`, `attr_list`, `md_in_html`,
`tables`, `toc` with permalinks, `pymdownx.highlight` /
`pymdownx.superfences` for mermaid fences, `pymdownx.details`).
Dependency versions are pinned in `requirements-docs.txt` (`mkdocs==1.6.1`,
`mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
`mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`) so a future
Material release can't silently change rendering behavior underneath the
site.

Two CI workflows split build-time verification from deploy:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/docs-agent-pages.yml` | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow itself; also `workflow_dispatch` | `mkdocs build --strict` → `actions/upload-pages-artifact@v5` → `actions/deploy-pages@v5` |
| `.github/workflows/docs-build-check.yml` | `pull_request` on the same path filter; also `workflow_dispatch` | `mkdocs build --strict --site-dir /tmp/site` only — no deploy |

`docs-build-check.yml` exists because, without a PR-time gate, a broken
link would only surface after merge, on the post-merge Pages run — too
late for review feedback. Both workflows run the same `--strict` build,
which fails on broken internal links and missing nav references, so a
regression can't reach the published site silently.

## Migration mechanics

The existing flat `docs/*.md` files (and the `docs/images/` directory)
moved into `docs/site-src/` via `git mv`, which is the directory
`.engineering-docs-agent/config.yml` now declares as `lens_paths.core` —
narrowing agent lens analysis to the published tree and keeping
`docs/superpowers/` (design specs and plans) out of it. The move required
repairing nine relative links that had only worked under GitHub's
renderer, and rewriting cross-tree references (into `docs/superpowers/`)
as absolute GitHub blob URLs, since `mkdocs build --strict` rejects link
targets that resolve outside `docs_dir`.

## Consequences

**Positive:** the project now has a real, browsable, search-indexed docs
site with a PR-time link-integrity gate. The nightly orchestrator's
publish-verifier stage can complete instead of permanently
short-circuiting on `verify_skipped`.

**Operational gotcha (resolved):** the first push-triggered run of
`docs-agent-pages.yml` failed at the `configure-pages` step —
`actions/configure-pages@v6`'s `enablement: true` does not actually
bootstrap a Pages site on a repo where Pages has never been enabled; the
workflow's default `GITHUB_TOKEN` lacks the admin scope
`POST /repos/.../pages` requires, and a workflow's `permissions:` block
can only narrow that token's scopes, never expand them. Recovery required
a one-off `gh api -X POST .../pages -f build_type=workflow` call from an
admin login. That bootstrap is now scripted rather than a manual
recovery step — see the CLAUDE.md Conventions entry on
`actions/configure-pages@v6` for the full incident writeup, and note
the current `.github/workflows/docs-agent-pages.yml` no longer carries
an `enablement: true` line (it was a no-op after the first successful
Pages enablement, and a footgun before it).

**Deliberately deferred (non-goals of the originating design):** no
information-architecture restructuring beyond the flat verbatim move; no
automated content rewriting during migration; no `mkdocstrings` (the
dashboard's TypeScript isn't a public API surface mkdocs tooling
targets); no custom domain. `docs/superpowers/` stays unpublished and
in-repo for plugin lens analysis rather than moving onto the site.

## Alternatives considered

- **Stay on `framework: none`** (status quo) — rejected. The
  publish-verifier stage would keep skipping indefinitely, and docs would
  stay readable only via GitHub's own renderer, with no search and no
  link-integrity gate at PR time.
- **Publish `docs/superpowers/` alongside `docs/site-src/`** — deferred,
  not rejected outright. Specs and plans are working documents for
  plugin lens analysis; publishing them raises IA and staleness
  questions better answered once the site has a few real
  engineering-docs-agent-authored cycles behind it.
