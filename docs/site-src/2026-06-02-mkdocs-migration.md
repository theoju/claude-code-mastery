---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: docs move to mkdocs (Material) publishing

**Date:** 2026-06-02
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)

## What changed

The docs source moved from a flat `docs/*.md` tree — rendered by
GitHub's blob viewer, with no search and no dedicated URL — to
`docs/site-src/`, built by [mkdocs](https://www.mkdocs.org/) with the
Material theme and published to
[theoju.github.io/claude-code-self-assessment](https://theoju.github.io/claude-code-self-assessment/).

`.engineering-docs-agent/config.yml` flipped from `framework: none` to
`framework: mkdocs`, with `lens_paths.core: docs/site-src/`,
`publishing.base_url`, and `publishing.build_workflow` filled in. That
flip is what activates the publish-verifier stage of the nightly
engineering-docs-agent run — previously the nightly's orchestrator ran
fine but the publish-verifier step skipped outright (`verify_skipped`
in `partial_reasons`) because there was no published site to check a
lens page against.

## Why

The config file had explicitly documented this as the intended next
step — a comment on the old `framework: none` block said "if you later
scaffold mkdocs and add a deploy workflow, swap framework to mkdocs and
fill in base_url + build_workflow." This PR executes that plan, after
spec and plan authoring and a 3-agent pre-execution validation pass
caught real blockers before they shipped: broken `.claude/`-relative
links that worked under GitHub's renderer but not mkdocs, missed path
references scattered across the repo, and no PR-level build gate.

The result is a properly published, searchable docs site instead of
flat markdown you have to already know the repo layout to find.

## What moved, mechanically

- `mkdocs.yml` (new) — Material theme with `navigation.tabs`,
  `navigation.sections`, `navigation.indexes`, `navigation.top`,
  `toc.follow`, `search.suggest`, `content.code.copy`. Plugin set is
  deliberately minimal: `search`, `awesome-pages`, and `literate-nav`
  (nav ordering comes from `docs/site-src/SUMMARY.md`, not
  alphabetical directory order).
- `requirements-docs.txt` (new) — pinned versions (`mkdocs==1.6.1`,
  `mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
  `mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`), so a
  future `mkdocs-material` release can't silently change rendering
  underneath the build.
- Two new CI workflows:
  - `.github/workflows/docs-agent-pages.yml` — fires on push to `main`
    when `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`
    change (plus manual dispatch). Runs `mkdocs build --strict`,
    writes `.nojekyll`, and deploys via `upload-pages-artifact` +
    `deploy-pages`.
  - `.github/workflows/docs-build-check.yml` — the PR-level gate.
    Mirrors the build step of the Pages workflow but never deploys, so
    a doc link that resolves on disk but not inside `docs_dir` fails
    CI on the PR instead of shipping broken and only surfacing on the
    next Pages build.
- The four existing `docs/*.md` files and `docs/images/` moved into
  `docs/site-src/` via `git mv`, verbatim — no content rewriting in
  this PR. Nine broken relative links were repaired in the process,
  and references into `.claude/`, `app/`, and `scripts/` were rewritten
  to absolute GitHub blob URLs, since those targets sit outside
  `docs_dir` and can't be relative mkdocs links.
- Path references were retargeted in `README.md`, `CLAUDE.md`,
  `app/data/rubric.json`, `app/docs/ship-pattern/page.tsx` (both the
  runtime read path and the literal display string in the page
  header), and the `/self-assessment` command/skill files.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` stay in
  place, outside `docs_dir` — the `lens_paths.core` flip narrows
  engineering-docs-agent's analysis to `docs/site-src/` only, and
  specs are intentionally unpublished design history, not
  user-facing docs.
- 21 new vitest cases cover the migration, the scaffold, and the
  config contract (`scripts/__tests__/docs-config-mkdocs.test.mjs`,
  `docs-mkdocs-scaffold.test.mjs`, `docs-path-migration.test.mjs`).

## A gotcha worth keeping in mind

`actions/configure-pages@v6`'s `enablement: true` flag looks like it
should bootstrap GitHub Pages on a repo's first deploy — it doesn't.
The workflow's `GITHUB_TOKEN` doesn't carry the admin scope
`POST /repos/.../pages` needs, and a workflow's `permissions:` block
can only restrict the default token's scopes, never expand them. The
first push-triggered run against this migration's merge commit failed
with `Resource not accessible by integration` at that step. Recovery
was a one-shot `gh api -X POST repos/theoju/claude-code-self-assessment/pages
-f build_type=workflow` from an admin login, after which the
dispatched workflow run succeeded in well under two minutes. The
`enablement: true` line has since been removed from
`docs-agent-pages.yml` — it's a no-op once Pages exists and a
misleading footgun before. If you're onboarding a new host repo onto
this pattern, run the `gh api` bootstrap (or the Settings → Pages →
Build and deployment → Source = "GitHub Actions" UI path) before the
first deploy, not after.

## What this means for you

If you had bookmarks or links into the old flat `docs/` layout, update
them — those paths no longer resolve. `docs/site-src/` is the
canonical source; the browsable, searchable published site at the
Pages URL above is the reading surface. `docs/superpowers/` continues
to hold specs and plans and is not part of the published site.
