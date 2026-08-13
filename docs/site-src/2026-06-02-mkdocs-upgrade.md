---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: publish the docs site with mkdocs instead of flat markdown

## Context

Before PR #121, `.engineering-docs-agent/config.yml` had
`docs.framework: none` and `publishing.base_url: null`. The `docs/`
directory held plain markdown that only rendered through GitHub's
blob viewer — there was no published, searchable site, and the
engineering-docs-agent orchestrator's publish-verifier stage skipped
every run with `verify_skipped` in `partial_reasons` because it had
no URL to check against. The config file itself documented the
upgrade path in a comment: swap `framework` to `mkdocs`, add a deploy
workflow, and fill in `base_url` + `build_workflow`.

The design record for this migration is
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` ("Path
A — Upgrade to MkDocs"); the plan lives at
`docs/superpowers/plans/archived/2026-06-01-mkdocs-upgrade.md`. Both
stay in-repo, unpublished — see "What stayed out of the published
site" below.

## Decision

Stand up a real, published documentation site at
<https://theoju.github.io/claude-code-self-assessment/>, built with
mkdocs (Material theme) from a new `docs/site-src/` source tree, and
gate every PR that touches it on `mkdocs build --strict`.

### The scaffold

`mkdocs.yml` at the repo root points `docs_dir` at `docs/site-src`
and `site_dir` at `site` (gitignored), and configures three plugins:
`search`, `awesome-pages`, and `literate-nav` (nav order driven by
`docs/site-src/SUMMARY.md` rather than alphabetical). The Material
theme features enabled are `navigation.tabs`, `navigation.sections`,
`navigation.indexes`, `navigation.top`, `toc.follow`,
`search.suggest`, and `content.code.copy`. Markdown extensions add
`admonition`, `attr_list`, `md_in_html`, `tables`, permalinked `toc`,
`pymdownx.highlight`, `pymdownx.superfences` (with a `mermaid` custom
fence), and `pymdownx.details`. Python dependencies are pinned in
`requirements-docs.txt` rather than left floating, so a future
Material release can't silently change rendering out from under a
green build.

### Two workflows, two responsibilities

`docs-agent-pages.yml` triggers on push to `main` when
`docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the
workflow file itself changes (plus manual `workflow_dispatch`). It
runs `mkdocs build --strict`, writes a `.nojekyll` marker so Pages
serves the built `site/` directory as-is, then hands off to
`actions/upload-pages-artifact` and `actions/deploy-pages` in a
`concurrency: group: pages` block that serializes deploys.

`docs-build-check.yml` mirrors the same `mkdocs build --strict` step
on `pull_request` for the identical path filter, but writes its
output to `/tmp/site` and never deploys. The point of keeping it
separate from the Pages workflow: without a PR-time gate, a broken
link (a moved file, a typo'd `SUMMARY.md` entry, a relative link that
resolved under GitHub's renderer but not mkdocs's) would only surface
after merge, when the Pages build failed post-hoc. Catching it at
review time is strictly cheaper.

### Config flip

`.engineering-docs-agent/config.yml` changed on five fields:
`docs.framework: none` → `mkdocs`; `docs.whats_new_file` and
`docs.lens_paths.core` repointed from `docs/` to
`docs/site-src/` (so the orchestrator's lens analysis doesn't recurse
into `docs/superpowers/specs/`); and `publishing.base_url` /
`publishing.build_workflow` filled in with the live Pages URL and
`docs-agent-pages.yml`. That last pair is what activates the
publish-verifier stage — per the comment in `config.yml`, it now
checks that `build_workflow` ran for the current `main` HEAD and that
`base_url` plus each lens page resolves within
`publishing.verify_timeout_seconds` (60s).

### Migrating existing content verbatim

The four existing `docs/*.md` files and the `docs/images/` directory
moved into `docs/site-src/` via `git mv`, with no content rewriting —
a deliberate non-goal in the design spec, to keep the PR's diff
auditable as a pure move. Moving the tree broke nine relative links
inside `self-assessment.md` and `ship-pattern.md` that pointed
outside the new `docs_dir` — into `.claude/` (skill files) and
`docs/superpowers/specs/` (design docs that intentionally stay
unpublished). mkdocs's strict mode rejects any link target outside
`docs_dir`, so `test -f` on the pre-move repo wouldn't have caught
this; only running the actual consumer (`mkdocs build --strict`)
does. The fix was to rewrite those nine links to absolute
`https://github.com/theoju/claude-code-self-assessment/blob/main/...`
URLs instead of relative paths — they still resolve, just through
GitHub's blob viewer rather than the mkdocs site.

## What stayed out of the published site

`docs/superpowers/specs/` and `docs/superpowers/plans/` are not part
of `docs_dir` and are not in `SUMMARY.md`. They stay in-repo for the
engineering-docs-agent's lens analysis and for contributors reading
design history directly on GitHub, but a build against
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design/` (or any
spec) 404s on the live site — that's intentional, not a gap. Whether
to eventually publish them is an open, deliberately deferred
question (see "Future work" in the design spec).

## Consequences

- Every docs PR now carries a real CI gate (`docs-build-check.yml`)
  that fails loud on broken links or a `SUMMARY.md` typo, instead of
  failing silently post-merge.
- The orchestrator's publish-verifier stage is live: a docs PR that
  merges but doesn't actually deploy (or deploys to a URL that
  doesn't resolve within 60s) now shows up in `partial_reasons`
  instead of being invisible.
- Two additional files (`mkdocs.yml`, `requirements-docs.txt`) and
  two workflows are now part of the docs contributor surface —
  anyone editing `docs/site-src/` should run `mkdocs build --strict`
  locally before opening a PR, the same check CI runs.
- **Known rollout gotcha, not part of this decision's steady state:**
  the first push-triggered run of `docs-agent-pages.yml` failed at
  the `configure-pages@v6` step, because that action's
  `enablement: true` flag does not actually have permission to
  bootstrap Pages on a repo where it has never been enabled — the
  workflow's `GITHUB_TOKEN` lacks the required admin scope, and
  `permissions:` blocks can only restrict token scope, never expand
  it. Recovery required a one-time `gh api -X POST
.../pages -f build_type=workflow` call from an admin login before
  the workflow could deploy. This repo's current
  `docs-agent-pages.yml` no longer includes the `enablement: true`
  line — see `CLAUDE.md`'s Conventions section for the full incident
  writeup and the durable fix.

## References

- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — full
  design record, rollout gate sequence, and rollback decision tree.
- `docs/superpowers/plans/archived/2026-06-01-mkdocs-upgrade.md` —
  execution plan.
- `mkdocs.yml`, `requirements-docs.txt`,
  `.github/workflows/docs-agent-pages.yml`,
  `.github/workflows/docs-build-check.yml`,
  `.engineering-docs-agent/config.yml` — the shipped scaffold.
