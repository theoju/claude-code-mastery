---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# Docs site: mkdocs upgrade (CCE-81 / PR #121)

The engineering-docs-agent integration in this repo moved from
`framework: none` to `framework: mkdocs`. The practical effect: the flat,
unpublished `docs/*.md` tree is now a built, strict-mode-validated,
publicly browsable site at
<https://theoju.github.io/claude-code-self-assessment/>, using the
Material theme.

## Why this over the flat tree

The old `docs/*.md` files had no build step and no link checking — a
renamed file or a typo'd relative link just silently broke, and nobody
found out until someone clicked it. Publishing through mkdocs gets you
two things the flat tree couldn't: a navigable site with search, and a
`mkdocs build --strict` gate that turns broken internal links into a
failed CI check instead of a 404 a reader hits later. It also gives the
engineering-docs-agent's nightly lens-content generation (and this page)
a durable, structured home instead of an ad-hoc doc dump.

## What's in the repo now

```
mkdocs.yml               # site config — docs_dir: docs/site-src, site_dir: site
requirements-docs.txt    # pinned build deps
docs/site-src/           # site source (moved verbatim from docs/*.md, includes images/)
docs/site-src/SUMMARY.md # literate-nav's nav file
.github/workflows/
  docs-agent-pages.yml   # push-to-main: build + deploy to GitHub Pages
  docs-build-check.yml   # PR gate: build --strict, no deploy
```

`mkdocs.yml` wires up the Material theme with `navigation.tabs`,
`navigation.sections`, `navigation.indexes`, `navigation.top`, and
`toc.follow`, plus three plugins: `search`, `awesome-pages`, and
`literate-nav` (reading the site nav from `SUMMARY.md` rather than an
inline `nav:` block in `mkdocs.yml` — so adding a page means editing
`SUMMARY.md`, not the site config). `requirements-docs.txt` pins
`mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
`mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`, and
`pymdown-extensions==10.11.2` — both CI workflows install from this file
and cache on it, so a version bump here is the only place to touch to
upgrade the build toolchain.

The existing docs — `self-assessment.md`, `ship-pattern.md`, the Boris
tips reference, tip classification, and the images directory — moved
into `docs/site-src/` unchanged in content, just relocated so mkdocs can
find them under `docs_dir`.

## Two CI workflows, two different jobs

**`docs-agent-pages.yml`** — fires on push to `main` when
`docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the
workflow file itself changes (plus manual `workflow_dispatch`). It needs
`pages: write` and `id-token: write` permissions. The build job runs
`actions/configure-pages@v6`, sets up Python 3.12 with pip caching keyed
on `requirements-docs.txt`, installs deps, runs `mkdocs build --strict`,
touches `site/.nojekyll` (so Pages serves the built artifact as-is
instead of running it through Jekyll), and uploads the `site/` directory
via `actions/upload-pages-artifact@v5`. A separate `deploy` job (needing
the `build` job) publishes it with `actions/deploy-pages@v5`. The
`concurrency: { group: pages, cancel-in-progress: false }` block means
deploys queue rather than cancel each other.

**`docs-build-check.yml`** — the PR-level counterpart. Same
`mkdocs build --strict` step, same pinned Python/deps setup, but it
writes to `/tmp/site` and never deploys, and it only needs
`contents: read`. This is the gate CLAUDE.md refers to when it says
`docs-build-check.yml` verifies every PR: without it, a broken link
introduced in a docs PR would only surface after merge, when the
`docs-agent-pages.yml` build fails on `main`. Its concurrency group
(`docs-build-check-${{ github.ref }}`, `cancel-in-progress: true`)
cancels stale runs on superseded commits, since the build itself is
only ~30 seconds with the pip cache warm.

## Config: `.engineering-docs-agent/config.yml`

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/site-src/
```

The `core` lens maps to `docs/site-src/` directly — there's no nested
`architecture/` or `operations/` subdirectory under it yet, which is why
this page lands as a flat, dated slug (`2026-06-02-docs-site-mkdocs-
upgrade.md`) at the top of `docs/site-src/` rather than under a section
that doesn't exist. If a future PR adds section subdirectories to the
`core` lens, route pages like this one there on next edit rather than
leaving them flat.

The `publishing` block declares how the orchestrator verifies a
successful publish for the `mkdocs` framework:

```yaml
publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

The publish-verifier checks that `docs-agent-pages.yml` actually ran for
the current `main` HEAD and that `base_url` plus each lens page resolves
within 60 seconds. A failed check adds `verify_failed` to
`partial_reasons` — it's diagnostic, not a hard block on the run.

## Operational gotcha worth knowing

`actions/configure-pages@v6`'s `enablement: true` field does **not**
bootstrap GitHub Pages on a repo's first deploy, despite what the field
name and the action's docs suggest — the workflow's default
`GITHUB_TOKEN` lacks the admin scope `POST /repos/.../pages` needs, so
the very first run fails with `Resource not accessible by integration`
even with `pages: write` declared in the workflow. Pages has to be
bootstrapped once, out of band, with an admin-scoped token:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

(or the equivalent UI path: Settings → Pages → Build and deployment →
Source = "GitHub Actions"). After that one-time step, every subsequent
push-triggered run of `docs-agent-pages.yml` works cleanly, and
`enablement: true` is a permanent no-op — which is why it was removed
from the workflow entirely rather than left in as dead configuration.
This repo hit the failure during onboarding; the recovery is documented
in full in `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
under "Post-implementation correction."

## What ships alongside the migration

The spec, plan, and pre-execution validation artifacts for this work
live under `docs/superpowers/` — see
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` for the
full design rationale and
`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` for the execution
plan, including the recovery section for the Pages-bootstrap incident
above.
