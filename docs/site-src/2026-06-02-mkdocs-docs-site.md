---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# The docs site build pipeline

The published docs site — this page included — is built by
[MkDocs](https://www.mkdocs.org) with the Material theme and served from
GitHub Pages at <https://theoju.github.io/claude-code-self-assessment/>. PR
#121 (CCE-81) stood this up, flipping the engineering-docs-agent integration
from `framework: none` to `framework: mkdocs` and migrating the flat
`docs/*.md` files that used to render only via GitHub's blob viewer into a
proper navigable site under `docs/site-src/`.

## Source root: `docs/site-src/`

`docs/site-src/` is the canonical source tree for everything that ships on
the site. `mkdocs.yml` points `docs_dir` at it and builds into `site/`
(gitignored — local `mkdocs build` output never gets tracked). The nav is
literate rather than alphabetical: `docs/site-src/SUMMARY.md` lists pages
explicitly in editorial order, and the `literate-nav` plugin reads it
instead of mkdocs inferring nav from directory structure.

`docs/superpowers/specs/` — the design-spec archive, including this
migration's own spec — deliberately stays **outside** `docs/site-src/` and
is not published. `.engineering-docs-agent/config.yml` scopes
`docs.lens_paths.core` to `docs/site-src/` for the same reason: agent lens
analysis shouldn't recurse into unpublished design history.

Theme configuration lives in `mkdocs.yml`:

```yaml
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.indexes
    - navigation.top
    - toc.follow
    - search.suggest
    - content.code.copy
plugins:
  - search
  - awesome-pages
  - literate-nav:
      nav_file: SUMMARY.md
```

`pymdownx.superfences` is configured with a custom `mermaid` fence so
diagrams render natively in Material. Dependencies are pinned in
`requirements-docs.txt` (`mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
`mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`,
`pymdown-extensions==10.11.2`) — the pin on `pymdown-extensions` in
particular guards against silent superfences/mermaid behavior drift on
future Material upgrades.

## Two workflows, two responsibilities

The build pipeline is split into a PR-time gate and a post-merge publish
step. They share the same `mkdocs build --strict` invocation but exist for
different reasons and never run in the same place:

| Workflow | Trigger | Does | Doesn't |
| --- | --- | --- | --- |
| `.github/workflows/docs-build-check.yml` | `pull_request` on `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or either workflow file | `mkdocs build --strict --site-dir /tmp/site` | Deploy anything |
| `.github/workflows/docs-agent-pages.yml` | `push` to `main` on the same path filter, plus `workflow_dispatch` | Build, write `.nojekyll`, upload the Pages artifact, deploy | Author content, open PRs |

`docs-build-check.yml` is the PR-level gate: it fails CI on broken internal
links or a `SUMMARY.md` entry pointing at a file that doesn't exist, so a
docs PR that would break the live site never gets the chance to merge.
Without it, a bad link would only surface post-merge, when the Pages
workflow's own strict build fails — too late for review feedback. It builds
into `/tmp/site`, never touches the real `site/` output, and cancels
superseded runs on the same branch (`concurrency: group:
docs-build-check-${{ github.ref }}`) since only the latest commit's build
matters.

`docs-agent-pages.yml` is the actual publish step. On a qualifying push to
`main` it runs `mkdocs build --strict`, touches `site/.nojekyll` so Pages
serves the Material output as static files rather than trying to run it
through Jekyll, uploads the artifact via `actions/upload-pages-artifact@v5`,
and deploys via `actions/deploy-pages@v5` in a separate `deploy` job gated
on `needs: build`. `concurrency: group: pages` with
`cancel-in-progress: false` serializes deploys rather than racing them.
Both workflows request the minimum permissions their job needs —
`docs-build-check.yml` only reads contents; `docs-agent-pages.yml` adds
`pages: write` and `id-token: write` for the deploy job.

Keeping these as two workflows rather than one matters operationally: a
Pages outage or GitHub Pages quota issue can't block PR review, and a
docs-build-check failure on someone's branch can't accidentally publish
broken content, because only `docs-agent-pages.yml` has deploy permissions
and it never runs on `pull_request`.

## The first-deploy Pages bootstrap gotcha

`docs-agent-pages.yml` uses `actions/configure-pages@v6` in the `build`
job. It's tempting to assume `configure-pages@v6`'s `enablement: true`
option programmatically turns on GitHub Pages for a repo on its first run
— that was the original plan in the migration's design spec. It doesn't
work: the workflow's `GITHUB_TOKEN` lacks the admin scope
`POST /repos/.../pages` requires, and a workflow's `permissions:` block can
only *restrict* the default token's scopes, never expand them. The first
push-triggered run against this repo failed with `Resource not accessible
by integration` at the `configure-pages@v6` step.

The actual fix is a one-time, out-of-band bootstrap: from a personal
account with admin rights on the repo, run

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

(equivalently: Settings → Pages → Build and deployment → Source = "GitHub
Actions"). `build_type=workflow` is durable — once Pages exists via any
path, every subsequent push-triggered run of the deploy workflow works
cleanly, and `enablement: true` becomes a permanent no-op. It was removed
from `docs-agent-pages.yml` for that reason; the file currently in this
repo has no `with:` block on the `configure-pages@v6` step. Setting
`build_type=workflow` also has a side effect worth knowing: it disables
branch-based Pages publishing, so `deploy-pages@v5`'s artifact upload is
the *only* path to the live URL — which is what a mkdocs build wants
anyway, but it explains why nothing you commit directly under a
`gh-pages`-style branch would ever show up.

For a new host repo bringing up this same pipeline, do the `gh api`
bootstrap **before** the first push-triggered deploy, not after — waiting
for the failure just costs a debugging cycle to rediscover the same fix.

## Configuration surface: `.engineering-docs-agent/config.yml`

The engineering-docs-agent integration reads `docs.framework: mkdocs` to
know the site is now build-and-publish, not blob-rendered markdown. Three
fields tie the agent's output to this pipeline:

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

`publishing.build_workflow` names `docs-agent-pages.yml` explicitly so the
nightly's publish-verifier stage can confirm the workflow actually ran for
the current `main` HEAD before checking that `base_url` and each lens page
resolve within `verify_timeout_seconds`. A failed verification adds
`verify_failed` to `partial_reasons` but doesn't block the run — it's a
signal, not a hard gate.

## What moved, what didn't

The migration moved four existing markdown files and the images directory
into `docs/site-src/` verbatim — no content rewriting, no restructuring —
plus authored two new files (`index.md` as the landing page, `SUMMARY.md`
for nav) and a `whats-new.md` stub for the engineering-docs-agent's nightly
to populate going forward.

`docs/superpowers/specs/` and `docs/superpowers/plans/` were left in place
outside `docs/site-src/`: they're design history for plugin lens analysis,
not published content. If you're looking for the full spec and rollout plan
behind this pipeline, they live at
[`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)
and
[`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md)
— unpublished by the same rule, but readable on GitHub.

One in-app surface needed a matching path update: `app/docs/ship-pattern/page.tsx`
renders `docs/site-src/ship-pattern.md` into the Next.js dashboard at
`/docs/ship-pattern`, independent of the mkdocs build. That route reads the
file directly rather than linking to the published site, so it has to track
the same `docs/site-src/` root or it silently breaks.
