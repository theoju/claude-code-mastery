---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: upgrade the docs site from `framework: none` to `framework: mkdocs`

**Date:** 2026-06-02
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121) (CCE-81)

## Context

The engineering-docs-agent plugin has been installed against this repo since
CCE-57, but `.engineering-docs-agent/config.yml` shipped with
`docs.framework: none` and `publishing.base_url: null`. Docs lived as flat
markdown under `docs/*.md`, rendered only by GitHub's blob viewer — no
navigation, no search, no published URL. With no `build_workflow` configured,
the nightly orchestrator's publish-verifier stage skipped every run
(`verify_skipped` in `partial_reasons`), because there was nothing to verify
a page against.

The config itself documented the intended escape hatch:

> If you later scaffold mkdocs and add a deploy workflow, swap framework to
> mkdocs and fill in base_url + build_workflow.

## Decision

Take that escape hatch. Stand up a Material-theme mkdocs site at
`docs/site-src/`, publish it to GitHub Pages, and flip
`.engineering-docs-agent/config.yml` to point at it:

```yaml
docs:
  framework: mkdocs
  whats_new_file: docs/site-src/whats-new.md
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
```

Concretely, this meant:

- `mkdocs.yml` at the repo root — Material theme, `awesome-pages` +
  `literate-nav` for site-src/`SUMMARY.md`-driven ordering. No
  `mkdocstrings` (Python-only, useless against this repo's TypeScript) and
  no `gen-files`.
- `requirements-docs.txt` pinning `mkdocs==1.6.1`, `mkdocs-material==9.5.49`,
  and the two nav plugins, sourced from the engineering-docs-agent dogfood
  setup (`/Users/theo/Projects/engineering-docs-agent/`) rather than a
  plugin-provided scaffold script — the plugin has no `setup_scaffold`, only
  the read-only `setup_discover.py`.
- The four existing docs files (`self-assessment.md`, `ship-pattern.md`,
  `boris-tips-reference-2026-05-10.md`, `tip-classification-2026-05-10.md`)
  and `docs/images/` moved into `docs/site-src/` via `git mv`, **verbatim** —
  no heading rewrites, no prose fixes, no restructuring in this PR.
- Two new GitHub Actions workflows with distinct jobs: `docs-build-check.yml`
  runs `mkdocs build --strict --site-dir /tmp/site` on every PR touching
  `docs/site-src/**` / `mkdocs.yml` / `requirements-docs.txt` (a review-time
  gate against broken links, catching them before merge rather than at the
  post-merge Pages build); `docs-agent-pages.yml` runs the same build on push
  to `main`, then `upload-pages-artifact` + `deploy-pages` to publish.
- Every stale `docs/*.md` reference across the tree repointed to
  `docs/site-src/*.md` — `README.md`, `CLAUDE.md`, `app/data/rubric.json`,
  `app/docs/ship-pattern/page.tsx`, `.claude/commands/self-assessment.md`,
  `.claude/skills/self-assessment/SKILL.md` — enforced going forward by
  `scripts/__tests__/docs-path-migration.test.mjs`, which scans every
  tracked file for the old paths outside an explicit allow-list.
  `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` and
  `scripts/__tests__/docs-config-mkdocs.test.mjs` cover the scaffold's
  existence/content and the config-flip contract respectively.

`docs/superpowers/specs/` and `docs/superpowers/plans/` stay where they are —
design history for plugin lens analysis, not part of the published site.
`lens_paths.core` points at `docs/site-src/` specifically so the nightly
orchestrator doesn't recurse into them.

## Alternatives considered (and cut)

Recorded because each was a live option, not an oversight:

- **Restructure the IA while migrating.** Rejected for this PR — verbatim
  moves only, so the diff is auditable in one sitting. IA restructuring is
  deferred until the agent has produced a few nightlies of lens-page output
  to show what shape the content actually wants.
- **Rewrite migrated content for mkdocs idioms.** Rejected. No heading
  reformatting, no fixing prose imperfections, no updating outdated
  references — that's separate work with its own review surface.
- **`mkdocstrings` for the dashboard's TypeScript.** Rejected — `app/`,
  `scripts/`, `lib/` aren't a public API surface, and mkdocstrings targets
  Python natively; a TypeDoc bridge is unproven effort for marginal value.
  `mkdocstrings` is asserted absent by
  `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`.
- **Custom domain.** Rejected until `theoju.github.io/claude-code-self-assessment/`
  proves stable as the canonical URL.
- **PR-preview deploys for docs-agent PRs.** Rejected — matches the
  dogfood's push-to-main-only behavior; revisit once docs-agent PRs are a
  regular review surface.
- **Publishing `docs/superpowers/specs/` on the site.** Rejected — it's
  design history, not user-facing documentation. A `lens_paths` one-liner
  could flip this later if the IA matures to want it.

## Consequences

- The site is live at
  [`https://theoju.github.io/claude-code-self-assessment/`](https://theoju.github.io/claude-code-self-assessment/),
  built via `mkdocs build --strict`, so a broken internal link or a
  `SUMMARY.md` entry pointing at a nonexistent file now fails CI
  (`docs-build-check.yml` on the PR, `docs-agent-pages.yml` on merge)
  instead of silently landing.
- The nightly orchestrator's publish-verifier stage is wired end-to-end:
  it checks `build_workflow` ran for current `main` and that `base_url` plus
  each lens page resolves within `publishing.verify_timeout_seconds` (60s),
  rather than unconditionally skipping.
- `whats-new.md` moved from a config-declared-but-nonexistent path to a real
  stub the engineering-docs-agent's nightly appends to.
- **First-deploy gotcha, worth carrying forward:** `actions/configure-pages@v6`'s
  `enablement: true` does **not** actually bootstrap GitHub Pages on a
  repo's first deploy — the workflow's `GITHUB_TOKEN` lacks the admin scope
  `POST /repos/.../pages` requires, and a `permissions:` block can only
  restrict the default token's scopes, never expand them. The first
  push-triggered run against this repo failed with
  `Resource not accessible by integration`. Recovery was a one-time
  `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` from an
  admin login, after which the workflow ran clean. The `enablement: true`
  line has since been removed from `docs-agent-pages.yml` — it was a no-op
  once Pages exists and a footgun before — with the bootstrap step now
  handled durably by the plugin side (per CCE-82 / PR #125, follow-up in the
  design spec's "Post-implementation correction").

## Where to look

- Spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
- Config: `.engineering-docs-agent/config.yml`
- Build config: `mkdocs.yml`, `requirements-docs.txt`
- Workflows: `.github/workflows/docs-build-check.yml`,
  `.github/workflows/docs-agent-pages.yml`
- Regression tests: `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`,
  `scripts/__tests__/docs-path-migration.test.mjs`,
  `scripts/__tests__/docs-config-mkdocs.test.mjs`
