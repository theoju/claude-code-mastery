---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs Publishing Pipeline

The project's documentation site at
`https://theoju.github.io/claude-code-self-assessment/` is built from
Markdown sources under `docs/site-src/` using MkDocs (Material theme)
and deployed to GitHub Pages via two workflows with distinct
responsibilities. This page describes how the pipeline is wired, what
each stage produces, and what the engineering-docs-agent's
publish-verifier checks.

## Source layout

```
docs/
  site-src/           ← MkDocs docs_dir; everything here becomes a page
    SUMMARY.md        ← literate-nav ordering (overrides alphabetical)
    index.md
    self-assessment.md
    ship-pattern.md
    whats-new.md
    images/
    boris-tips-reference-2026-05-10.md
    tip-classification-2026-05-10.md
  superpowers/specs/  ← design history; outside docs_dir, never published
mkdocs.yml            ← site config; docs_dir points to docs/site-src
requirements-docs.txt ← pinned Python dependencies for the build
```

`docs/superpowers/specs/` is intentionally excluded from the published
site — the `docs_dir: docs/site-src` setting in `mkdocs.yml` is the
boundary. Any file outside that directory is invisible to MkDocs, so
design specs remain in-repo for plugin lens analysis without appearing
on the live site.

## MkDocs configuration

`mkdocs.yml` at the repo root configures the Material theme and three
plugins: `search` (built-in), `awesome-pages`, and `literate-nav`.

```yaml
docs_dir: docs/site-src
site_dir: site
site_url: https://theoju.github.io/claude-code-self-assessment/
```

Navigation order is controlled by `docs/site-src/SUMMARY.md` (consumed
by `literate-nav`), not by filesystem order. The current nav:

```markdown
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
    - [Boris Tips](boris-tips-reference-2026-05-10.md)
    - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

Python dependencies are pinned in `requirements-docs.txt`:

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

`pymdown-extensions` is pinned explicitly because `pymdownx.superfences`
(mermaid diagram support) is in use; pinning prevents silent behavior
changes when future Material upgrades pull in a newer extension release.

## Two workflows, two responsibilities

| Workflow | Trigger | Purpose |
|---|---|---|
| `docs-build-check.yml` | `pull_request` on docs paths | `mkdocs build --strict` — fails the PR if links break; never deploys |
| `docs-agent-pages.yml` | `push` to `main` on docs paths + `workflow_dispatch` | Build + deploy to GitHub Pages |

They share the same path filters:

```
docs/site-src/**
mkdocs.yml
requirements-docs.txt
.github/workflows/docs-agent-pages.yml   # (pages only)
.github/workflows/docs-build-check.yml  # (check only)
```

The two-workflow split means a nightly authoring outage does not take
the published site down, and a Pages build break does not stop the
engineering-docs-agent from opening PRs.

### PR gate (`docs-build-check.yml`)

Runs `mkdocs build --strict --site-dir /tmp/site` on every PR that
touches docs sources. Builds to `/tmp/site` so no Pages artifact is
generated. The `--strict` flag promotes broken links and missing nav
references to errors, catching them at review time rather than
post-merge.

Concurrency is set to `cancel-in-progress: true` on the same PR branch
(`group: docs-build-check-${{ github.ref }}`), so only the latest
commit's build runs.

### Publish workflow (`docs-agent-pages.yml`)

Full pipeline on every push to `main` that touches the path filter:

```
checkout
  → actions/configure-pages@v6
  → actions/setup-python@v6 (Python 3.12, pip cache keyed on requirements-docs.txt)
  → pip install -r requirements-docs.txt
  → mkdocs build --strict          # exits non-zero on any error
  → touch site/.nojekyll           # tells Pages not to run Jekyll
  → actions/upload-pages-artifact@v5 (path: site)
  → actions/deploy-pages@v5        # separate job, needs: build
```

The `deploy` job runs in the `github-pages` environment (which surfaces
the live URL in the GitHub UI). Concurrency is `cancel-in-progress:
false` on `group: pages` — in-flight deploys complete rather than being
interrupted mid-upload.

Permissions required: `contents: read`, `pages: write`,
`id-token: write`.

## Nightly trigger paths

The engineering-docs-agent's nightly workflow (`docs-agent-nightly.yml`,
07:07 UTC) authors new pages and opens a PR against `main`. When that
PR squash-merges, it touches `docs/site-src/**`, which triggers
`docs-agent-pages.yml` automatically. The full loop is:

```
nightly cron
  → docs-agent-nightly.yml authors content, opens docs-agent/YYYY-MM-DD PR
  → PR review + squash-merge
  → push to main touches docs/site-src/**
  → docs-agent-pages.yml fires automatically
  → site updates ~60–90s after deploy job completes
```

You can also trigger a manual redeploy at any time:

```bash
gh workflow run docs-agent-pages.yml --ref main
```

## engineering-docs-agent publish-verifier

`.engineering-docs-agent/config.yml` sets:

```yaml
publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  verify_timeout_seconds: 60
```

With `framework: mkdocs`, the orchestrator's publish-verifier stage
checks that `docs-agent-pages.yml` ran successfully against the current
`main` HEAD and that `base_url` returns HTTP 200 within 60 seconds. A
failed verification adds `verify_failed` to `partial_reasons` but does
not block the run. Before PR #121, `framework: none` caused this stage
to emit `verify_skipped` on every nightly run.

The `lens_paths.core: docs/site-src/` setting scopes agent authoring
to the published directory only — the agent never touches
`docs/superpowers/specs/`.

## Bootstrap requirement (first-time Pages setup)

`actions/configure-pages@v6` with `enablement: true` does **not**
bootstrap GitHub Pages on a first deploy. The workflow's `GITHUB_TOKEN`
lacks the admin scope for `POST /repos/.../pages`, and `permissions:`
blocks can only restrict the token's default scopes, never expand them.

Before the first `docs-agent-pages.yml` run on a fresh repo, Pages must
be enabled manually:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

This sets `build_type=workflow`, which tells GitHub Pages to expect a
`deploy-pages` artifact upload rather than serving static files from a
branch. Once set, it is durable — subsequent workflow runs work cleanly
and the `enablement: true` line in `configure-pages@v6` becomes a
silent no-op. The `enablement: true` line has since been removed from
`docs-agent-pages.yml` (PR #125 / CCE-82).

The equivalent UI path: **Settings → Pages → Build and deployment →
Source = "GitHub Actions"**.

## Local development

To build and preview the site locally:

```bash
python3 -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r requirements-docs.txt

mkdocs build --strict   # must exit 0; same gate as CI
mkdocs serve            # live-reload at http://127.0.0.1:8000/
```

The `site/` output directory is gitignored — local builds never leak
into the tracked tree.

## What's not in the pipeline

- **TypeScript/app documentation** — `mkdocstrings` is not installed.
  The app, scripts, and lib directories aren't a public API surface.
- **PR preview deploys** — the `paths:` filter is `push: branches:
  [main]` only; PRs get the strict-build gate but no preview URL.
- **Custom domain** — the canonical URL is the GitHub Pages subdomain.
- **`docs/superpowers/specs/`** — design specs remain in-repo but
  unpublished. Adding them to the site requires a `lens_paths` edit and
  an IA decision.
