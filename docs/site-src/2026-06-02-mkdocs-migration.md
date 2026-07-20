---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: publish the docs site with mkdocs

**Date:** 2026-06-02 · **PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121) · **Ticket:** CCE-81

## Context

Before this change, the engineering-docs-agent integration for this repo
ran with `docs.framework: none` in `.engineering-docs-agent/config.yml`.
Docs lived as flat markdown under `docs/*.md` and were only readable
through GitHub's own renderer at `/blob/main/docs/`. That's a real
limitation for the plugin's nightly run specifically: with no published
site and `publishing.base_url: null`, the orchestrator's publish-verifier
stage had nothing to check reachability against, so every nightly logged
`verify_skipped` in `partial_reasons` instead of confirming the docs it
authored were actually live anywhere.

The config file had documented the fix since it was first written — "If
you later scaffold mkdocs and add a deploy workflow, swap framework to
mkdocs and fill in base_url + build_workflow" — but nobody had done it.

## Decision

Flip `framework: none` → `framework: mkdocs` and stand up a real
Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>. Concretely:

- **`mkdocs.yml`** — `docs_dir: docs/site-src`, `site_dir: site`, Material
  theme with `navigation.tabs`, `navigation.sections`,
  `navigation.indexes`, `navigation.top`, `toc.follow`, and
  `search.suggest`. Three plugins: `search`, `awesome-pages`, and
  `literate-nav` (reading nav order from `docs/site-src/SUMMARY.md`
  rather than alphabetical directory order). `requirements-docs.txt`
  pins the Python build deps (`mkdocs==1.6.1`,
  `mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
  `mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`).
- **Two CI workflows, split by responsibility.** `docs-agent-pages.yml`
  fires on push to `main` when `docs/site-src/**`, `mkdocs.yml`, or
  `requirements-docs.txt` change: `mkdocs build --strict` → write
  `site/.nojekyll` → `upload-pages-artifact@v5` → `deploy-pages@v5`.
  `docs-build-check.yml` fires on the same paths but at the PR level,
  running the same `mkdocs build --strict` into a throwaway
  `/tmp/site` — no deploy, just the strict-build gate — so a broken
  link or unresolvable nav entry fails review instead of surfacing only
  after merge.
- **The existing flat docs moved into `docs_dir`.** `docs/*.md` and
  `docs/images/` were `git mv`'d into `docs/site-src/`, verbatim — no
  content rewriting in this PR. `mkdocs build --strict` resolves
  internal links relative to `docs_dir`, so any relative link that
  pointed *outside* the new tree (into `docs/superpowers/`, `.claude/`,
  or elsewhere in the repo) breaks under strict mode even though GitHub
  happily rendered it before. Nine such links were rewritten to
  absolute `github.com/.../blob/main/...` URLs rather than staying
  relative.
- **`.engineering-docs-agent/config.yml` flipped five fields**:
  `docs.framework` → `mkdocs`, `docs.whats_new_file` →
  `docs/site-src/whats-new.md`, `docs.lens_paths.core` →
  `docs/site-src/`, `publishing.base_url` →
  `https://theoju.github.io/claude-code-self-assessment/`, and
  `publishing.build_workflow` → `docs-agent-pages.yml`. Narrowing
  `lens_paths.core` to `docs/site-src/` also has the effect of keeping
  `docs/superpowers/specs/` out of the agent's lens analysis — those
  specs stay in-repo, unpublished.
- **Six other files retargeted** their path references to the new
  `docs/site-src/` location (README, CLAUDE.md, the rubric's
  next-action copy, `app/docs/ship-pattern/page.tsx`'s runtime read
  path and display string, and others touched by the same sweep).
- **21 new vitest cases** cover the migration itself, the mkdocs
  scaffold, and the config contract, so a future edit that silently
  reverts one of the five config fields or drops a moved file fails CI
  rather than surfacing as a broken link in production.

Three pre-execution review passes (correctness, completeness,
test-rigor) ran against the spec and plan before implementation, and
caught real blockers: broken links under `.claude/` that the first pass
missed, path references inside `.claude/commands/` that also needed
retargeting, and the absence of a PR-level build gate (which became
`docs-build-check.yml`). All three were fixed before this shipped —
`docs-build-check.yml` exists specifically because the completeness pass
flagged that without it, a broken link would only be caught by the
post-merge Pages deploy, too late for review feedback.

## Consequences

- The docs site is now a real, crawlable, searchable artifact instead of
  GitHub's raw markdown renderer — Material's `search` plugin builds a
  client-side index, and `navigation.tabs` / `navigation.sections` give
  the site actual information architecture instead of a flat file list.
- `mkdocs build --strict` is now load-bearing: any future PR that adds a
  page with a broken internal link, or an `SUMMARY.md` entry pointing at
  a file that doesn't exist, fails `docs-build-check.yml` before it can
  merge.
- The IA is intentionally flat in this PR — no reorganization into
  subdirectories (e.g. `architecture/`, `operations/`, `archive/`)
  happened here. `docs/site-src/` for the `core` lens currently holds
  the migrated pages plus an `images/` directory and nothing else, which
  is why this decision page lives at the lens root as a dated slug
  rather than under a section path.
- **Known gap surfaced by the first live deploy (documented for future
  onboarding, not part of this PR's diff):** the first push-triggered
  run of `docs-agent-pages.yml` failed at the `configure-pages` step
  with `Resource not accessible by integration` — the workflow's
  `GITHUB_TOKEN` doesn't have the admin scope needed to bootstrap Pages
  on a repo where it has never been enabled, and a workflow's
  `permissions:` block can only restrict the default token's scopes,
  never expand them. Recovery required a one-time
  `gh api -X POST repos/theoju/claude-code-self-assessment/pages -f
build_type=workflow` run from an admin login before the workflow could
  deploy successfully. This is a per-repo, one-time bootstrap step, not
  a defect in the workflow YAML itself.
- Two verification items remain operational rather than doc changes:
  confirming the post-merge Pages auto-deploy went live, and watching
  the next engineering-docs-agent nightly run to confirm the
  publish-verifier no longer logs `verify_skipped` now that
  `publishing.base_url` and `publishing.build_workflow` are populated.

## Non-goals

Explicitly out of scope for this PR, called out so they don't get
mistaken for oversights: no IA restructuring beyond the flat move, no
content rewriting of the migrated pages, no `mkdocs-material`
social-cards/instant-loading/git-revision plugins, no TypeScript API
docs generation, no custom domain, and no publishing of
`docs/superpowers/specs/` to the site.
