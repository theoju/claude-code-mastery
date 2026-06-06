---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# MkDocs upgrade — PR #121 / CCE-81 (2026-06-02)

The engineering-docs-agent integration for this repo was upgraded from
`framework: none` to `framework: mkdocs`, standing up a published
Material-theme MkDocs site at
**<https://theoju.github.io/claude-code-self-assessment/>**.

## What changed

### CI workflows

Two GitHub Actions workflows were added:

| Workflow | File | Trigger | What it does |
| --- | --- | --- | --- |
| Deploy | `.github/workflows/docs-agent-pages.yml` | push to `main` | Builds the Material-theme MkDocs site and publishes to GitHub Pages via `deploy-pages@v5` |
| Strict-build gate | `.github/workflows/docs-build-check.yml` | every PR | Runs `mkdocs build --strict`; broken links or bad nav entries fail the PR before they reach `main` |

### Content migration

Existing `docs/*.md` files were moved verbatim into `docs/site-src/` with 9
broken relative links repaired — those links previously pointed into `.claude/`
paths that only resolve locally, not in the published build.

Scaffold files added:

- `mkdocs.yml` — site config (Material theme, nav, plugins)
- `requirements-docs.txt` — pinned MkDocs + Material dependencies
- `docs/site-src/index.md` — landing page stub
- `docs/site-src/SUMMARY.md` — navigation structure
- `docs/site-src/whats-new.md` — user-facing changelog (this site's running log)

### Config flip

`.engineering-docs-agent/config.yml` was updated:

```yaml
# before
framework: none

# after
framework: mkdocs
base_url: https://theoju.github.io/claude-code-self-assessment/
build_workflow: docs-agent-pages.yml
```

Switching from `none` to `mkdocs` activates the publish-verifier stage of the
nightly docs-agent run, so each agent-authored PR is validated against a real
build before merging.

### Path references

Six files had path references updated to reflect the `docs/site-src/` root:
`.claude/commands/`, a handful of `README.md` links, and the mkdocs nav. All
589 pre-existing vitest tests continued to pass; 21 new tests were added.

## Test coverage

The 21 new vitest tests cover three areas:

1. **Scaffold existence** — asserts the required scaffold files (`mkdocs.yml`,
   `requirements-docs.txt`, `docs/site-src/index.md`, etc.) are present.
2. **Config contract** — checks that `.engineering-docs-agent/config.yml`
   declares `framework: mkdocs`, `base_url`, and `build_workflow`.
3. **Path migration** — confirms the migrated `docs/site-src/*.md` files exist
   and that none contain the old broken relative-link patterns.

Total test count after the PR: **689 tests pass**.

## GitHub Pages bootstrap caveat

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
Pages on a first deploy. The `GITHUB_TOKEN` lacks the admin scope required to
call `POST /repos/.../pages` regardless of `permissions: pages: write` being
declared. Every initial deploy attempt will fail with
`Resource not accessible by integration`.

Before the first deploy, run this once from an admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or go to **Settings → Pages → Build and deployment → Source → "GitHub
Actions"** in the repo UI. Once Pages exists, `enablement: true` is a
permanent silent no-op.

The `build_type=workflow` flag also disables branch-deploy publishing — the
only path to the live site is the `deploy-pages@v5` artifact upload in
`docs-agent-pages.yml`. That's the intended behavior for a MkDocs build
(you want the built HTML, not raw markdown).

The `enablement: true` line was subsequently removed in PR #125 / CCE-82.

## Pre-execution validation

Three independent pre-execution validation agents reviewed the plan before any
code was written. They surfaced three real blockers that would have caused the
PR to fail:

1. **Broken `.claude/` relative links** in the migrated docs — caught before
   the migration ran.
2. **Missed path refs in `.claude/commands/`** — two command files still
   referenced the old `docs/` root.
3. **Missing CI strict-build gate** — the original plan included a deploy
   workflow but no PR-level `mkdocs build --strict` check, leaving broken
   links undetectable until after merge.

All three were addressed before implementation. This is the pattern the
engineering-docs-agent's pre-execution validation stage is designed to produce.

## Related

- PR #125 / CCE-82 — removed `enablement: true` from `docs-agent-pages.yml`
- CCE-57 — initial host onboarding
- CCE-64 — `framework: none` first-class support (intentionally reversed here)
- Spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
