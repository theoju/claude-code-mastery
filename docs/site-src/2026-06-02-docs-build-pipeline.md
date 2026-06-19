---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs Build Pipeline

The published docs site at `https://theoju.github.io/claude-code-self-assessment/` is
built with **mkdocs 1.6.1** + **mkdocs-material 9.5.49** and deployed to GitHub Pages
on every push to `main` that touches `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or either workflow file. A PR gate runs
`mkdocs build --strict` before merge so broken links never reach `main`.

Introduced in PR #121 (CCE-81). The `enablement: true` line that appeared in the
initial workflow was removed in PR #125 (CCE-82) — see
[First-deploy caveat](#first-deploy-caveat).

---

## Repository layout

```
docs/site-src/              # docs_dir — mkdocs root
  SUMMARY.md                # literate-nav nav file (drives the sidebar)
  index.md
  self-assessment.md
  ship-pattern.md
  whats-new.md
  boris-tips-reference-2026-05-10.md
  tip-classification-2026-05-10.md
  images/                   # committed screenshots
mkdocs.yml                  # site config
requirements-docs.txt       # pinned Python deps
.github/workflows/
  docs-agent-pages.yml      # build + deploy on push to main
  docs-build-check.yml      # strict-build gate on PRs
```

---

## mkdocs configuration

`mkdocs.yml` lives at the repo root.

| Setting | Value |
|---|---|
| `docs_dir` | `docs/site-src` |
| `site_dir` | `site` |
| `site_url` | `https://theoju.github.io/claude-code-self-assessment/` |
| `theme` | `material` |

**Plugins:**

- `search` — built-in full-text search
- `awesome-pages` — page ordering via `.pages` files (not currently used, but available)
- `literate-nav` (`nav_file: SUMMARY.md`) — the sidebar nav is declared in
  `docs/site-src/SUMMARY.md`, not the `nav:` key in `mkdocs.yml`

**Markdown extensions:** `admonition`, `attr_list`, `md_in_html`, `tables`,
`toc` (with `permalink: true`), `pymdownx.highlight`,
`pymdownx.superfences` (mermaid fences enabled via a custom fence entry),
`pymdownx.details`.

**Pinned dependencies** (`requirements-docs.txt`):

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

---

## Nav: SUMMARY.md

`docs/site-src/SUMMARY.md` is the single source of truth for the published sidebar.
The literate-nav plugin reads it; adding a page without a SUMMARY.md entry leaves it
unreachable from the nav (it still builds, but isn't linked). Current shape:

```markdown
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
    - [Boris Tips](boris-tips-reference-2026-05-10.md)
    - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

When the engineering-docs-agent creates new pages it also updates SUMMARY.md to
include them. New pages use flat date-prefixed slugs directly under `docs/site-src/`
(e.g. `2026-06-02-docs-build-pipeline.md`) because `architecture/` and
`operations/` subdirectories do not exist in the current nav.

---

## Workflows

### `docs-agent-pages.yml` — build and deploy

**Triggers:** push to `main` when any of `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or `docs-agent-pages.yml` change; also `workflow_dispatch`.

**Required permissions:** `contents: read`, `pages: write`, `id-token: write`.

**Concurrency:** group `pages`, `cancel-in-progress: false` — queued deploys are
not dropped.

Steps (in order):

1. `actions/checkout@v5`
2. `actions/configure-pages@v6` — no-op after first setup (see caveat below)
3. `actions/setup-python@v6` — Python 3.12, pip cache keyed on `requirements-docs.txt`
4. `pip install -r requirements-docs.txt && mkdocs build --strict`
5. `touch site/.nojekyll` — prevents GitHub Pages from running Jekyll on the artifact
6. `actions/upload-pages-artifact@v5` — uploads `site/`
7. `actions/deploy-pages@v5` — publishes to the `github-pages` environment

The deploy job declares `environment: github-pages` and emits the live URL via
`steps.deployment.outputs.page_url`.

### `docs-build-check.yml` — PR gate

**Triggers:** PRs touching `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`,
`docs-build-check.yml`, or `docs-agent-pages.yml`.

**Does not deploy.** Runs only:

```bash
mkdocs build --strict --site-dir /tmp/site
```

Concurrency group `docs-build-check-${{ github.ref }}` with
`cancel-in-progress: true` — only the latest commit's build is awaited, so
superseded pushes don't queue up.

---

## Strict-mode invariant

Both workflows pass `--strict`. In strict mode, any broken internal link, missing nav
reference, or unresolvable anchor causes a non-zero exit and fails the build. The PR
gate enforces this before merge; the deploy workflow enforces it again at publish
time.

**What strict mode does not catch:** a page that exists on disk but has no entry in
SUMMARY.md is unreachable in the nav but does not fail the build. If you add a page,
add it to SUMMARY.md in the same PR.

---

## First-deploy caveat

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap GitHub
Pages on a first deploy. The workflow's `GITHUB_TOKEN` does not carry the admin scope
needed to call `POST /repos/.../pages`, so the very first run fails with
`Resource not accessible by integration` — even with `permissions: pages: write`
declared. (The `permissions:` key can only restrict the default token's scopes, not
expand them.)

Before the first deploy on a new repo, run this from an admin-scoped `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source = "GitHub
Actions"**. `build_type=workflow` is durable — once set, all subsequent
push-triggered runs work cleanly. The `enablement: true` line was removed from
`docs-agent-pages.yml` in PR #125 / CCE-82 to prevent confusion.

A follow-up ticket recommends baking the `gh api` call into the
engineering-docs-agent's `setup_scaffold` script for future host repos onboarded
with `framework: mkdocs`.

---

## Engineering-docs-agent integration

`.engineering-docs-agent/config.yml` connects the nightly agent to this pipeline:

| Key | Value | Effect |
|---|---|---|
| `framework` | `mkdocs` | activates the `publish-verifier` stage |
| `lens_paths.core` | `docs/site-src/` | agent writes new pages here |
| `publishing.base_url` | `https://theoju.github.io/claude-code-self-assessment/` | verifier checks URL reachability |
| `publishing.build_workflow` | `docs-agent-pages.yml` | verifier polls this workflow's run status |
| `publishing.verify_timeout_seconds` | `60` | timeout before marking `verify_failed` |

The `publish-verifier` stage was previously emitting `verify_skipped` because no
published site existed. After the mkdocs upgrade it runs on every nightly cycle.
A deploy that hasn't completed within 60 seconds adds `verify_failed` to
`partial_reasons` but does not block the run.
