---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# The docs site: mkdocs + GitHub Pages

The engineering-docs-agent integration in this repo went from
`framework: none` to `framework: mkdocs` (PR #121, CCE-57 / CCE-64 /
CCE-81). Before this, `.engineering-docs-agent/config.yml` had
`publishing.base_url: null` and the nightly's publish-verifier stage
skipped every run with `verify_skipped` — there was nothing to verify
against, just plain markdown under `docs/` rendered by GitHub's blob
viewer. Now there's a real published site at
<https://theoju.github.io/claude-code-self-assessment/>, built by
mkdocs-Material from source under `docs/site-src/`.

## Two workflows, two responsibilities

Authoring and publishing are split into separate GitHub Actions
workflows on purpose — the nightly runs on Claude OAuth + Jira
credentials with a long timeout, and a Pages build break shouldn't be
able to stop authoring (or vice versa):

| Workflow | Trigger | Does | Doesn't do |
| --- | --- | --- | --- |
| `docs-agent-nightly.yml` | cron + `workflow_dispatch` | Runs the plugin orchestrator, opens/updates a `docs-agent/YYYY-MM-DD` PR with authored pages | Build the site, deploy Pages |
| `.github/workflows/docs-agent-pages.yml` | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`, plus `workflow_dispatch` | `mkdocs build --strict` → `upload-pages-artifact` → `deploy-pages` | Author content, open PRs |

`docs-agent-pages.yml` runs on Python 3.12 with pip caching keyed off
`requirements-docs.txt`, builds with `mkdocs build --strict`, touches
`site/.nojekyll` so Pages serves the built artifact as-is, then
uploads and deploys via `actions/upload-pages-artifact@v5` and
`actions/deploy-pages@v5`. The deploy job is gated behind the `build`
job via `needs: build` and runs in the `github-pages` environment.

A third workflow, `.github/workflows/docs-build-check.yml`, is the PR
gate: it runs the same `mkdocs build --strict` (to a throwaway
`/tmp/site`, no deploy) on every pull request that touches docs
sources. Without it, a broken internal link or malformed nav entry
would only surface after merge, when the post-merge Pages workflow
runs — this catches it in review instead. It cancels superseded runs
on the same branch (`concurrency.group:
docs-build-check-${{ github.ref }}`) since the build is cheap (~30s
with the pip cache) and only the latest commit's result matters.

## Scaffold

`mkdocs.yml` sets `docs_dir: docs/site-src` and `site_dir: site`, the
Material theme with `navigation.tabs`, `navigation.sections`,
`navigation.indexes`, `navigation.top`, `toc.follow`, `search.suggest`,
and `content.code.copy`. Three plugins: `search`, `awesome-pages`, and
`literate-nav` reading its nav order from `SUMMARY.md` rather than an
inline `nav:` block in `mkdocs.yml` — page order lives next to the
pages it orders. `docs/site-src/SUMMARY.md` currently lists Home,
Self-Assessment, Ship Pattern, a Reference section (Boris Tips, Tip
Classification), and What's New.

Pinned dependencies live in `requirements-docs.txt`:
`mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
`mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
`pymdown-extensions==10.11.2`. No `mkdocstrings` — the dashboard's
TypeScript under `app/`, `scripts/`, `lib/` isn't a public API
surface, so there's nothing to autodoc. No social-cards or
instant-loading Material plugins either; those are Python-package
extras that were cut as marginal first-day value rather than load-
bearing.

## Migration

The pre-existing flat `docs/*.md` files moved into `docs/site-src/`
**verbatim** — no heading reformatting, no fixing prose, no updating
stale references in the same PR. `docs/site-src/index.md` is the new
site home; it links out to `self-assessment.md`, `ship-pattern.md`,
the Reference pages, and `whats-new.md`, plus the GitHub source and
README. `docs/superpowers/specs/` and `docs/superpowers/plans/`
deliberately stayed **in-repo but unpublished** — they're read by the
plugin for lens analysis, not meant for the public site's IA.

`.claude/commands/self-assessment.md`, the self-assessment skill, and
`app/docs/ship-pattern/page.tsx` (which renders `ship-pattern.md` as
an in-dashboard page) were updated to point at the new `docs/site-src/`
location.

## Config wiring

`.engineering-docs-agent/config.yml` carries the framework flip and
the publishing block:

```yaml
docs:
  framework: mkdocs
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

With `framework: mkdocs`, the nightly's publish-verifier stage checks
that `docs-agent-pages.yml` ran for the current `main` HEAD and that
`base_url` plus each lens page resolves within 60 seconds. A failed
check adds `verify_failed` to `partial_reasons` — it's advisory, not a
run-blocker.

## Onboarding gotcha (fixed here, worth knowing elsewhere)

`actions/configure-pages@v6`'s `enablement: true` does **not**
bootstrap GitHub Pages on a repo's first deploy, despite the name —
the workflow's `GITHUB_TOKEN` lacks the admin scope `POST
/repos/.../pages` needs, so the first run fails with `Resource not
accessible by integration` even with `permissions: pages: write`
declared (`permissions:` can only restrict the default token's scope,
never expand it). Pages has to be enabled once, out of band, by an
admin login — `gh api -X POST repos/<owner>/<repo>/pages -f
build_type=workflow`, or Settings → Pages → Build and deployment →
Source = "GitHub Actions". After that, `enablement: true` is a
permanent no-op, which is why the line was later dropped from the
workflow (CCE-82).

## Verifying the site builds

`mkdocs build --strict` is the actual consumer for any change that
touches a link inside `docs/site-src/` — a path can resolve fine on
disk (`test -f`) while `--strict` mode still rejects it (e.g. a link
target outside `docs_dir`). Run it locally before pushing a docs
change:

```bash
pip install -r requirements-docs.txt
mkdocs build --strict
```

Three test files back this in CI: `scripts/__tests__/docs-config-mkdocs.test.mjs`
(the config.yml flip), `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`
(the scaffold shape), and `scripts/__tests__/docs-path-migration.test.mjs`
(the verbatim move).
