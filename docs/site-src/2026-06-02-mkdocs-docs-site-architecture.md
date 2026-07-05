---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# MkDocs Docs Site Architecture

This page describes how the published docs site — the one you're reading —
is built and deployed. It replaced a `framework: none` setup where
`docs/*.md` was flat markdown rendered only by GitHub's blob viewer, with
no published site to link to and no `publish-verifier` signal for the
nightly engineering-docs-agent run.

## Component map

| Component                                | Role                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `mkdocs.yml`                               | Site config: Material theme, plugin list, markdown extensions                                        |
| `requirements-docs.txt`                    | Pinned Python deps for the mkdocs build                                                              |
| `docs/site-src/`                           | The published site's source tree (`docs_dir` in `mkdocs.yml`)                                        |
| `docs/site-src/SUMMARY.md`                 | Literate-nav ordering — hand-authored, not alphabetical                                              |
| `.github/workflows/docs-agent-pages.yml`   | Builds + deploys the site to GitHub Pages on push to `main`                                          |
| `.github/workflows/docs-build-check.yml`   | PR-level `mkdocs build --strict` gate — catches broken links before merge, never deploys             |
| `.engineering-docs-agent/config.yml`       | Tells the nightly authoring agent where the published site lives and how to verify it                |

## Build config: `mkdocs.yml`

```yaml
site_name: Claude Code Self-Assessment
site_url: https://theoju.github.io/claude-code-self-assessment/
docs_dir: docs/site-src
site_dir: site

theme:
  name: material

plugins:
  - search
  - awesome-pages
  - literate-nav:
      nav_file: SUMMARY.md
```

`docs_dir: docs/site-src` is the load-bearing line: mkdocs treats everything
under it as the site, and `mkdocs build --strict` rejects any link that
resolves *outside* that tree. That's why `docs/superpowers/specs/` and
`docs/superpowers/plans/` — design history that stays in-repo for plugin
lens analysis — are deliberately **not** under `docs/site-src/` and don't
ship to the published site.

The plugin set is intentionally minimal: `search`, `awesome-pages`, and
`literate-nav` (nav order comes from `SUMMARY.md` rather than alphabetical
directory order). `markdown_extensions` add `admonition`, `tables`,
`pymdownx.superfences` (with a `mermaid` custom fence), and
`pymdownx.details` — no `mkdocstrings`, since the dashboard's TypeScript
isn't a public API surface worth auto-documenting.

## Two workflows, two jobs

Both workflows run `mkdocs build --strict` against `requirements-docs.txt`
(pinned: `mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
`mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
`pymdown-extensions==10.11.2`), but they exist for different reasons and
neither substitutes for the other:

| Workflow                | Trigger                                                              | Does                                                                        | Doesn't                    |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `docs-agent-pages.yml`   | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt` (+ `workflow_dispatch`) | `mkdocs build --strict` → writes `site/.nojekyll` → `upload-pages-artifact` → `deploy-pages` | Never runs on pull requests |
| `docs-build-check.yml`   | `pull_request` touching the same paths (+ `workflow_dispatch`)        | Same `mkdocs build --strict`, output to `/tmp/site`                          | Never deploys anything      |

`docs-build-check.yml` exists so a broken link fails review instead of
surfacing only after merge, when the post-merge `docs-agent-pages.yml` run
is the first thing to catch it. Both workflows share the identical `paths:`
filter, so a change that doesn't touch docs sources never triggers either
one — no rebuild on, say, a `scripts/score.mjs` change.

`docs-agent-pages.yml`'s `concurrency: group: pages` with
`cancel-in-progress: false` serializes deploys rather than canceling an
in-flight one, so two rapid merges to `main` both fully publish rather than
racing.

## Config flip: what actually changed

`.engineering-docs-agent/config.yml` carries five fields that this upgrade
touched:

```yaml
docs:
  framework: mkdocs
  whats_new_file: docs/site-src/whats-new.md
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
```

`lens_paths.core: docs/site-src/` (not `docs/`) is what keeps the nightly
authoring agent from recursing into `docs/superpowers/specs/` — the config
comments spell this out directly: flipping `framework` activates the
`publish-verifier` stage of the nightly, which checks `build_workflow` ran
for the current `main` HEAD and that `base_url` plus each lens page
resolves within `publishing.verify_timeout_seconds` (60s). A failed check
adds `verify_failed` to `partial_reasons` but doesn't block the run.

## IA is flat, on purpose

`docs/site-src/SUMMARY.md` drives the nav explicitly rather than
alphabetically:

```markdown
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
    - [Boris Tips](boris-tips-reference-2026-05-10.md)
    - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

There's no `architecture/`, `operations/`, or `archive/` subdirectory under
`docs/site-src/` for the `core` lens yet — this page and its companion
decision page both land as flat `docs/site-src/YYYY-MM-DD-slug.md` files at
the lens root. Restructuring the IA into subsections is deferred until the
nightly agent has produced a few cycles of lens output to show what shape
that reorganization should take.

## Known operational gotcha: Pages bootstrap

The very first `docs-agent-pages.yml` run against a fresh repo will fail at
the `configure-pages` step with `Resource not accessible by integration` —
the workflow's default `GITHUB_TOKEN` doesn't have the admin scope needed to
call `POST /repos/.../pages`, and a workflow's `permissions:` block can only
*restrict* the default token's scopes, never expand them. This bit the
first deploy of this exact workflow (merge commit `6369065`).

The fix is a one-time, out-of-band bootstrap — either

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
```

run from a personal/admin `gh` login, or the equivalent UI path (Settings →
Pages → Build and deployment → Source = "GitHub Actions"). After that,
every subsequent push-triggered run works cleanly, and the workflow no
longer carries an `enablement: true` line under `configure-pages` — it was
a no-op once Pages exists and a misleading footgun before, so it was
removed rather than left in.

Once Pages is live, the published site is reachable at
<https://theoju.github.io/claude-code-self-assessment/>, and the Next.js
dashboard's own routes (e.g. `/methodology/`) correctly 404 on that domain
— confirming the mkdocs build stays scoped to `docs/site-src/` and doesn't
collide with the app.
