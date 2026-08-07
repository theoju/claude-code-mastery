---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# MkDocs docs site architecture

This dashboard's documentation is published as a static site at
<https://theoju.github.io/claude-code-self-assessment/>, built with
[MkDocs](https://www.mkdocs.org/) + the Material theme. Source lives under
`docs/site-src/`; everything else in `docs/` (`docs/superpowers/specs/`,
`docs/superpowers/plans/`) stays in-repo but unpublished. This page describes
how the pieces fit together — the config, the two CI workflows, and the
link-repair work the migration required.

## Two workflows, two responsibilities

Publishing splits across two GitHub Actions workflows that never touch each
other:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `docs-agent-pages.yml` | push to `main` touching docs paths, or `workflow_dispatch` | `mkdocs build --strict` → uploads the `site/` artifact → deploys to Pages |
| `docs-build-check.yml` | `pull_request` touching docs paths, or `workflow_dispatch` | `mkdocs build --strict --site-dir /tmp/site` — build only, never deploys |

`docs-build-check.yml` exists specifically so a broken link fails PR review
instead of shipping to `main` and only getting caught by the post-merge Pages
build — "too late for review feedback," as the workflow's own header comment
puts it. Both workflows share the same trigger shape: a `paths:` filter
scoped to `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, and the
workflow file itself, so pushes that don't touch docs never fire either job.

`docs-agent-pages.yml` runs as two jobs, `build` then `deploy`, gated by
`needs: build`. The `build` job checks out the repo, runs
`actions/configure-pages@v6`, installs `requirements-docs.txt` via
`actions/setup-python@v6` (pinned to Python 3.12, pip-cached against
`requirements-docs.txt`), runs `mkdocs build --strict`, writes an empty
`.nojekyll` file into `site/` so Pages serves the build artifact as-is
instead of running it through Jekyll, then uploads `site/` with
`actions/upload-pages-artifact@v5`. The `deploy` job runs
`actions/deploy-pages@v5` against the `github-pages` environment.
`concurrency: group: pages` with `cancel-in-progress: false` serializes
deploys rather than racing them. `docs-build-check.yml` runs the build half
only — same Python setup, same `pip install -r requirements-docs.txt`, same
`mkdocs build --strict` — but writes to `/tmp/site` and stops there, and its
concurrency group is keyed per-branch (`docs-build-check-${{ github.ref }}`)
with `cancel-in-progress: true` since only the latest commit on a PR needs
the gate.

## Site config

`mkdocs.yml` at the repo root points `docs_dir` at `docs/site-src` (not the
default `docs/`) and `site_dir` at `site`, and declares
`site_url: https://theoju.github.io/claude-code-self-assessment/` — the
trailing slash matters for MkDocs's canonical link resolution. Theme is
Material with `navigation.tabs`, `navigation.sections`,
`navigation.indexes`, `navigation.top`, `toc.follow`, `search.suggest`, and
`content.code.copy` enabled. Three plugins: `search`, `awesome-pages`, and
`literate-nav` pointed at `SUMMARY.md` as its nav file — nav order is
hand-authored rather than alphabetical, so editorial intent (landing page
first, reference material grouped under a `Reference` heading, `What's New`
last) survives regardless of filename sort order. `docs/site-src/SUMMARY.md`
is the literate-nav source of truth for that ordering.

`markdown_extensions` adds `admonition`, `attr_list`, `md_in_html`,
`tables`, `toc` (with permalinks), `pymdownx.highlight`, and
`pymdownx.superfences` configured with a custom `mermaid` fence — so diagram
blocks render — plus `pymdownx.details`. `requirements-docs.txt` pins every
Python dependency this build needs: `mkdocs==1.6.1`,
`mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
`mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`. Deliberately
absent: `mkdocstrings` and `gen-files` — this dashboard's `app/`, `scripts/`,
and `lib/` code isn't a public API surface worth auto-documenting, and both
plugins are Python-source-oriented, which doesn't help a TypeScript/Next.js
codebase.

## Content source and the migration

Before this change, `docs/*.md` was flat markdown rendered only by GitHub's
in-repo file viewer, with relative links (`../.claude/skills/...`,
`./superpowers/specs/...`) that resolved fine inside the GitHub tree but had
no meaning once the files moved under a `docs_dir` MkDocs controls. The PR
that stood up this site moved four markdown files and the image directory
into `docs/site-src/` via `git mv` — preserving rename history — while
deliberately leaving `docs/superpowers/specs/` and `docs/superpowers/plans/`
in place outside the published tree (design/plan history the plugin's lens
analysis still reads, but not user-facing documentation).

The move broke links in three distinct ways, each requiring a different
fix:

1. **Image references** prefixed with the old `docs/images/` or `../images/`
   path — rewritten relative to the new `docs/site-src/` parent (`images/...`).
2. **Links into `.claude/`** (e.g. `.claude/skills/self-assessment/SKILL.md`)
   — this directory sits outside `docs_dir` and can never be made an
   internal MkDocs link, so these became absolute
   `https://github.com/theoju/claude-code-self-assessment/blob/main/...`
   URLs.
3. **Links into `docs/superpowers/specs/`** — since specs stay unpublished
   by design, these also became absolute GitHub blob URLs rather than
   internal links.

`mkdocs build --strict` is the enforcement mechanism for all three: it
rejects any link that resolves outside `docs_dir`, so a leftover relative
link fails the build rather than silently 404ing on the live site. That's
also why `docs-build-check.yml` exists as a separate PR-time gate — the
same `--strict` build that would otherwise only run against `main` now runs
against every docs-touching PR.

## `.engineering-docs-agent/config.yml`

The plugin integration config for this repo declares
`docs.framework: mkdocs`, `docs.source_dir: docs`,
`docs.lens_paths.core: docs/site-src/` (scoping the agent's lens analysis
away from `docs/superpowers/`), and `docs.whats_new_file:
docs/site-src/whats-new.md`. The `publishing` block records
`base_url: https://theoju.github.io/claude-code-self-assessment/`,
`build_workflow: docs-agent-pages.yml`, and `url_map_rule: standard` — the
orchestrator's publish-verifier stage reads these to confirm the build
workflow actually ran for the current `main` HEAD and that each lens page
resolves within `verify_timeout_seconds` (60s here). A failed verification
is non-blocking: it adds `verify_failed` to `partial_reasons` rather than
stopping the run.

## Known gotcha: Pages bootstrap on first deploy

`actions/configure-pages@v6`'s `enablement: true` option does not actually
provision GitHub Pages on a repo's very first deploy, despite the option
name — the workflow's default `GITHUB_TOKEN` lacks the admin scope
`POST /repos/.../pages` requires, and a workflow's `permissions:` block can
only narrow the default token's scopes, never grant new ones. The first
`docs-agent-pages.yml` run against this repo failed at the
`configure-pages@v6` step with `Resource not accessible by integration`.
Recovery required a one-time `gh api -X POST repos/<owner>/<repo>/pages -f
build_type=workflow` call from an admin-scoped login (equivalently: Settings
→ Pages → Build and deployment → Source = "GitHub Actions") before
re-dispatching the workflow. Once Pages exists, `enablement: true` is a
permanent no-op, and `build_type=workflow` is durable across all future
runs — this is a one-time bootstrap step for any repo standing up this same
pattern, not a per-deploy concern.
