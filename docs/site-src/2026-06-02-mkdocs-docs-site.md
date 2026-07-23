---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: architecture
---

# The docs site (mkdocs)

This project's documentation is published as a Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>, built from markdown
under `docs/site-src/`. Before this landed (CCE-81, PR #121), the
`engineering-docs-agent` integration ran with `framework: none` — the docs
lived as flat markdown that GitHub rendered at `/blob/main/docs/`, and the
nightly orchestrator's publish-verifier stage always skipped with
`verify_skipped` because there was no published site to check against.
This page describes the shape that replaced it.

## Two workflows, two jobs

Publishing docs and authoring docs are separate pipelines with separate
triggers, so a failure in one can't take down the other:

- **`docs-agent-pages.yml`** builds and deploys the site. It fires on push
  to `main` when `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`
  change (plus `workflow_dispatch`). The job runs `mkdocs build --strict`,
  touches `site/.nojekyll` so Pages serves the build artifact as-is, then
  uploads and deploys via `actions/upload-pages-artifact@v5` +
  `actions/deploy-pages@v5`. A `concurrency: group: pages` block serializes
  deploys so overlapping pushes don't race.
- **`docs-build-check.yml`** is the PR-level gate — it runs the same
  `mkdocs build --strict` (into a scratch `/tmp/site` so nothing gets
  committed) on every pull request touching the same paths, but never
  deploys. Without it, a broken link or a dangling `SUMMARY.md` reference
  would only surface after merge, when the post-merge Pages workflow tries
  to build — too late for review feedback.

`mkdocs build --strict` is the enforcement mechanism for both: it fails the
build on broken internal links or nav entries that don't resolve to a real
file, which is why `docs-build-check.yml` exists as a pre-merge gate rather
than trusting the post-merge build alone.

## Site structure

`mkdocs.yml` points `docs_dir` at `docs/site-src` and uses the Material
theme with three plugins: `search`, `awesome-pages`, and `literate-nav`
(reading nav order from `docs/site-src/SUMMARY.md` rather than alphabetizing
files). The `docs/site-src/SUMMARY.md` nav is hand-ordered by editorial
intent — home, self-assessment, ship pattern, a "Reference" group for the
Boris-tip catalog and classification docs, then what's-new last.
`markdown_extensions` add `admonition`, `attr_list`, tables, permalinked
TOC headers, and `pymdownx.superfences` (with a `mermaid` custom fence) —
enough for diagrams and callouts without pulling in Python-only extras like
`mkdocstrings`, which the design intentionally left out since `app/`,
`scripts/`, and `lib/` aren't a documented public API surface.

`docs/superpowers/specs/` and `docs/superpowers/plans/` stay outside
`docs/site-src/` on purpose — they're design history for plugin lens
analysis, not published pages. The `.engineering-docs-agent/config.yml`
`lens_paths.core: docs/site-src/` setting is what keeps the agent's content
analysis scoped to the published tree instead of recursing into those
directories.

## Migration was verbatim, not a rewrite

The four pre-existing flat docs (`self-assessment.md`, `ship-pattern.md`,
`boris-tips-reference-2026-05-10.md`, `tip-classification-2026-05-10.md`)
plus the `images/` directory moved into `docs/site-src/` via `git mv`, with
no content rewriting — only the relative links and image paths that broke
under the new directory depth got fixed (links into `.claude/skills/...`
and `docs/superpowers/specs/...`, which live outside `docs_dir` and can't be
made mkdocs-internal, were converted to absolute GitHub blob URLs instead).
Everywhere else in the source tree that pointed at the old `docs/*.md`
paths — `README.md`, `CLAUDE.md`, `app/data/rubric.json`,
`app/docs/ship-pattern/page.tsx`, `.claude/commands/self-assessment.md`,
and `.claude/skills/self-assessment/SKILL.md` — got updated in the same
change so nothing in the repo still pointed at a path that no longer
existed. `scripts/__tests__/docs-path-migration.test.mjs` is the regression
guard: it scans every tracked file (via `git ls-files`) for the old paths
and fails if anything outside an explicit allow-list (the migrated files
themselves, and the frozen-in-time `docs/superpowers/{specs,plans}/`
history) still references them.

Two sibling test files back the rest of the contract:
`scripts/__tests__/docs-mkdocs-scaffold.test.mjs` asserts the scaffold
files (`mkdocs.yml`, `requirements-docs.txt`, the `docs/site-src/` stubs,
the Pages workflow) exist with the required keys and steps, and that the
migrated pages landed at their new paths while the old `docs/` originals
are gone. `scripts/__tests__/docs-config-mkdocs.test.mjs` asserts
`.engineering-docs-agent/config.yml` actually flipped to the mkdocs
contract — `framework: mkdocs`, `whats_new_file` pointing at
`docs/site-src/whats-new.md`, `lens_paths.core` pointing at
`docs/site-src/`, and both `publishing.base_url` and
`publishing.build_workflow` populated together rather than half-flipped.

## Config flip

`.engineering-docs-agent/config.yml` is what actually turns the site on
for the nightly orchestrator. Flipping `docs.framework` from `none` to
`mkdocs` activates the publish-verifier stage: on framework `mkdocs`, the
verifier checks that `docs-agent-pages.yml` ran for the current `main` HEAD
and that `publishing.base_url` plus each lens page resolves within
`publishing.verify_timeout_seconds` (60s). A failed verification adds
`verify_failed` to `partial_reasons` rather than blocking the run outright.
`docs.lens_paths.core: docs/site-src/` is the setting that scopes the
nightly's content analysis to the published tree.

## What publishes and what doesn't

`whats-new.md` is a stub the engineering-docs-agent's nightly populates over
time — the config's `whats_new_file` points at it, and the file exists at
scaffold time only as a placeholder so the first nightly run has somewhere
to append. Everything under `docs/site-src/` is fair game for the site;
everything under `docs/superpowers/` stays repo-only.

## A gotcha worth knowing before touching this again

Enabling GitHub Pages programmatically on a brand-new repo is not as simple
as `actions/configure-pages@v6`'s `enablement: true` flag suggests — the
workflow's default `GITHUB_TOKEN` doesn't carry the admin scope
`POST /repos/.../pages` needs, and a `permissions:` block in the workflow
can only restrict that token's scopes, never expand them. The first
push-triggered run against this repo failed with
`Resource not accessible by integration` at the `configure-pages@v6` step
before Pages had ever been enabled through any other path. The durable fix
— bootstrapping Pages via `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`
(or the Settings → Pages → Build and deployment → Source = "GitHub Actions"
UI path) before the first deploy — is why the current
`docs-agent-pages.yml` no longer carries an `enablement: true` line at all:
it's a no-op once Pages exists and a misleading footgun before. See
`CLAUDE.md`'s Conventions section for the full incident writeup.
