---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs publishing pipeline

The docs site at <https://theoju.github.io/claude-code-self-assessment/> is
built by [mkdocs](https://www.mkdocs.org/) with the
[Material](https://squidfunk.github.io/mkdocs-material/) theme and deployed
to GitHub Pages by CI. This page is the architecture reference for that
pipeline: what builds it, what gates it, and where each piece lives.

## Source → build → deploy

```
docs/site-src/**  (+ mkdocs.yml, requirements-docs.txt)
        │
        │  push to main
        ▼
.github/workflows/docs-agent-pages.yml
        │
        │  mkdocs build --strict  →  site/
        ▼
actions/upload-pages-artifact@v5  →  actions/deploy-pages@v5
        │
        ▼
https://theoju.github.io/claude-code-self-assessment/
```

`docs_dir: docs/site-src` and `site_dir: site` are set in
`/home/runner/work/claude-code-self-assessment/claude-code-self-assessment/mkdocs.yml:4-5`.
Everything the site renders comes from that one directory — flat markdown
files plus `images/`.

## The mkdocs scaffold

Two files at the repo root drive the build:

- **`mkdocs.yml`** — site config. Theme is `material` with
  `navigation.tabs`, `navigation.sections`, `navigation.indexes`,
  `navigation.top`, `toc.follow`, `search.suggest`, and
  `content.code.copy` enabled. Nav is **not** hand-maintained in
  `mkdocs.yml` — the `literate-nav` plugin reads it from
  `docs/site-src/SUMMARY.md` instead (`nav_file: SUMMARY.md`), and
  `awesome-pages` is loaded alongside it for per-directory ordering.
  Markdown extensions include `admonition`, `attr_list`, `md_in_html`,
  `tables`, `toc` (with `permalink: true`), `pymdownx.highlight`,
  `pymdownx.superfences` (with a `mermaid` custom fence), and
  `pymdownx.details`.
- **`requirements-docs.txt`** — pins the Python toolchain:
  `mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
  `mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
  `pymdown-extensions==10.11.2`. Both CI workflows install from this
  file rather than resolving latest, so a build that passes locally
  matches what CI runs.

Because nav comes from `SUMMARY.md`, adding a new page to the site means
two edits, not one: drop the markdown file under `docs/site-src/`, and add
a line to `docs/site-src/SUMMARY.md` pointing at it. A file that exists on
disk but is missing from `SUMMARY.md` still builds, but won't appear in
the rendered nav.

## Two CI workflows, one shared build step

Both workflows run the identical `pip install -r requirements-docs.txt`
then `mkdocs build --strict` sequence — `--strict` turns broken internal
links, missing nav entries, and other warnings into build failures rather
than silent console noise. They diverge only in what happens after the
build and when they fire.

**`docs-agent-pages.yml`** — the publish workflow.

- Triggers on push to `main`, path-filtered to
  `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the
  workflow file itself (plus manual `workflow_dispatch`).
- Two jobs: `build` (checkout → `configure-pages` → `setup-python@v6`,
  pinned to `3.12` with `pip` caching keyed on `requirements-docs.txt`
  → install deps → `mkdocs build --strict` → `touch site/.nojekyll` so
  Pages serves the artifact as-is → `upload-pages-artifact@v5`) and
  `deploy` (needs `build`, runs `deploy-pages@v5` against the
  `github-pages` environment).
- `concurrency: { group: pages, cancel-in-progress: false }` — deploys
  queue rather than cancel each other, so a fast follow-up push doesn't
  abandon an in-flight Pages deployment.
- Permissions are `contents: read`, `pages: write`, `id-token: write` —
  the minimum GitHub Pages' OIDC-based deploy action needs.

**`docs-build-check.yml`** — the PR gate.

- Triggers on `pull_request`, same path filter as the publish workflow
  (plus its own workflow file), and `workflow_dispatch`.
- Single `build` job: checkout → `setup-python@v6` → install deps →
  `mkdocs build --strict --site-dir /tmp/site`. It never uploads an
  artifact or deploys — the point is purely to fail the PR check if the
  strict build would fail, before the change reaches `main`.
- `concurrency` is keyed per-branch (`docs-build-check-${{ github.ref }}`)
  with `cancel-in-progress: true`, since only the latest commit on an
  open PR needs to pass.

The split matters: without `docs-build-check.yml`, a broken cross-link
would only surface after merge, when `docs-agent-pages.yml` runs against
`main` and — worse — a strict-build failure there blocks the *next*
successful deploy from going out, since Pages serves whatever the last
green `deploy` job produced.

## engineering-docs-agent integration

`.engineering-docs-agent/config.yml` is what tells the orchestrator this
repo now publishes to a real site instead of leaving flat markdown in
place:

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

With `framework: mkdocs` set, the nightly run's publish-verifier stage
checks that `build_workflow` (`docs-agent-pages.yml`) actually ran for
the current `main` HEAD and that `base_url` plus each lens page resolves
within `verify_timeout_seconds` (60s). A failed check is recorded as
`verify_failed` in `partial_reasons` — it doesn't block the run, but it's
visible in the run's own report. `agent_editable_paths: ["docs/**"]`
scopes what the agent may write; `lens_paths.core: docs/site-src/` is the
one lens this repo currently defines, matching the flat directory this
whole pipeline builds from.

## Why this shape

The config had documented this exact upgrade — swap `framework` to
`mkdocs`, fill in `base_url` and `build_workflow` — as the intended next
step before this landed. Standing it up this way means:

- **A real browsable site**, not flat in-repo markdown, at a stable
  public URL.
- **CI catches broken links before merge**, not after — the PR gate runs
  the same strict build the publish workflow will run, just without the
  deploy half.
- **The nightly engineering-docs-agent can verify its own output** —
  `publishing.build_workflow` gives the publish-verifier stage something
  concrete to check against, rather than assuming a push to `docs/`
  succeeded.

## Onboarding note: GitHub Pages bootstrap

`actions/configure-pages@v6`'s `enablement: true` field does **not**
bootstrap Pages on a repo's first deploy — the workflow's default
`GITHUB_TOKEN` lacks the admin scope `POST /repos/.../pages` needs, so the
very first run fails with `Resource not accessible by integration` even
with `permissions: pages: write` declared. Before the first deploy on a
new host repo, run
`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` from an
admin login (or set it via Settings → Pages → Build and deployment →
Source = "GitHub Actions" in the UI). Once Pages exists, `enablement: true`
is a no-op — CLAUDE.md's Hard rules section carries the full incident
detail and the follow-up removal of the now-meaningless line.

## Where to look next

- Full spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
- Nav source of truth: `docs/site-src/SUMMARY.md`
