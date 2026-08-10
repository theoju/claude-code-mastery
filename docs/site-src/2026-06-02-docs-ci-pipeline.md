---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs CI pipeline

The published docs site at
<https://theoju.github.io/claude-code-self-assessment/> is built by
[MkDocs](https://www.mkdocs.org) (Material theme) from source under
`docs/site-src/`, and shipped through two purpose-built GitHub Actions
workflows. Neither workflow authors content — that's the
engineering-docs-agent's nightly job. These two only build and deploy
what's already on disk.

## Two workflows, two responsibilities

| Workflow | Trigger | Job |
| --- | --- | --- |
| `.github/workflows/docs-agent-pages.yml` | `push` to `main` on docs paths, or `workflow_dispatch` | Build with `mkdocs build --strict`, then deploy to GitHub Pages |
| `.github/workflows/docs-build-check.yml` | `pull_request` on docs paths, or `workflow_dispatch` | Build with `mkdocs build --strict` into `/tmp/site` — a gate, no deploy |

Both fire off the same `paths:` filter — `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, and the workflow file itself — so a PR touching
only `scripts/` or `app/` never triggers either one. `docs-build-check.yml`
also watches `docs-agent-pages.yml` in its own path filter, so an edit to
the deploy workflow itself still gets the strict-build gate before merge.

The split matters: without `docs-build-check.yml`, a broken internal link
or a `SUMMARY.md` entry pointing at a renamed file would only surface
*after* merge, when the Pages workflow's `mkdocs build --strict` fails on
`main` — too late for review feedback. The PR-level workflow mirrors the
build step exactly and runs in well under a minute (pip is cached on
`requirements-docs.txt`), so it's cheap insurance to run on every docs PR.

`docs-build-check.yml` requests only `contents: read` and cancels
superseded runs on the same branch (`cancel-in-progress: true`) — only the
latest commit needs the gate. `docs-agent-pages.yml` needs `pages: write`
and `id-token: write` to publish, and locks deploys serially
(`concurrency: group: pages`, `cancel-in-progress: false`) so two pushes
in quick succession can't race each other's Pages deployment.

## Build step

Both workflows run the identical core command:

```bash
pip install -r requirements-docs.txt
mkdocs build --strict
```

`--strict` is what makes this a real gate rather than a formality — MkDocs
treats broken internal links, missing files referenced from `SUMMARY.md`,
and other structural problems as build failures instead of warnings.

`requirements-docs.txt` pins:

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

`mkdocs.yml` deliberately keeps the plugin set minimal — `search`,
`awesome-pages`, and `literate-nav` (nav ordering comes from
`docs/site-src/SUMMARY.md`, not alphabetical directory order). It has no
Python-only plugins: no `mkdocstrings` (the dashboard's TypeScript isn't
a documented API surface) and no `gen-files`. `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`
asserts both are absent as a regression guard, alongside checks that
`docs_dir: docs/site-src` and `site_dir: site` are set and that every
`SUMMARY.md` link resolves to a real file under `docs/site-src/`.

After the build, `docs-agent-pages.yml` writes `site/.nojekyll` before
uploading the artifact, so GitHub Pages serves the MkDocs output as-is
instead of running it through Jekyll.

## Deploy step

On `main`, the build job hands off to a `deploy` job that uses
`actions/upload-pages-artifact@v5` and `actions/deploy-pages@v5` against
the `github-pages` environment. `docs-build-check.yml` has no equivalent
job — it builds into `/tmp/site` and stops.

## Config wiring

`.engineering-docs-agent/config.yml` is what tells the
engineering-docs-agent plugin's nightly orchestrator (and its
`publish-verifier` stage) that a real site exists to verify against:

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

`lens_paths.core` points at `docs/site-src/`, not the repo-root `docs/` —
that keeps the nightly's lens analysis scoped to what's actually
published and out of `docs/superpowers/specs/`, which stays in-repo for
design history but is never built into the site. Once `framework: mkdocs`
and a non-null `base_url` + `build_workflow` are set together, the
publish-verifier stage checks that `base_url` and each lens page resolve
within `verify_timeout_seconds` — a failure adds `verify_failed` to
`partial_reasons` but doesn't block the run.
`scripts/__tests__/docs-config-mkdocs.test.mjs` guards this contract
directly, including the half-flipped case (`framework: mkdocs` with a
still-null `base_url` or `build_workflow`).

## A gotcha worth knowing

The first production deploy of `docs-agent-pages.yml` (merge commit
`6369065`) failed at the `actions/configure-pages@v6` step with
`Resource not accessible by integration`. The workflow had been written
with `enablement: true` on that step on the assumption it would
bootstrap Pages on a repo that had never had it enabled — it doesn't;
the default `GITHUB_TOKEN` lacks the admin scope `POST /repos/.../pages`
needs, and a workflow's `permissions:` block can only *restrict* the
token's scopes, never expand them. Pages had to be bootstrapped manually
(`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` from
an admin login), after which `enablement: true` became a permanent
no-op. The current `docs-agent-pages.yml` no longer carries that line —
see CLAUDE.md's Conventions section for the full incident writeup and
the durable fix.

## What isn't part of this pipeline

- **Content authoring.** Neither workflow writes markdown. That's
  `docs-agent-nightly.yml`, which runs on a cron and opens a
  `docs-agent/YYYY-MM-DD` PR for review.
- **Repo-root docs.** `README.md` and `CLAUDE.md` are read by GitHub
  directly and are not part of `docs_dir`; they're unaffected by either
  workflow.
- **`docs/superpowers/specs/`.** Intentionally excluded from
  `lens_paths.core` and from the MkDocs `docs_dir`, so it never reaches
  the published site.
