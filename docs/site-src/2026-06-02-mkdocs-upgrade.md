---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: upgrade to MkDocs (PR #121 / CCE-81)

**Date:** 2026-06-02  
**Ticket:** CCE-81  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)

## Context

The engineering-docs-agent config at `.engineering-docs-agent/config.yml` had
always documented the upgrade path in a comment:

> If you later scaffold mkdocs and add a deploy workflow, swap framework to
> mkdocs and fill in base\_url + build\_workflow.

Before this PR the config read `framework: none` and
`publishing.base_url: null`. The nightly ran but its publish-verifier stage
unconditionally emitted `verify_skipped` in `partial_reasons` because there was
no built site to verify against. Markdown lived under `docs/` and was only
readable via GitHub's blob renderer — no search, no nav, no permanent URL.

CCE-57 (host onboarding) and CCE-64 (`framework: none` first-class support)
laid the groundwork. CCE-81 executes the flip.

Three independent pre-execution agents (correctness, completeness, test-rigor)
validated the implementation plan before any code was written. They surfaced
real blockers: broken `.claude/` cross-tree links in `docs/site-src/`, missed
path-refs in slash commands and the SKILL.md, and an absent PR-level
strict-build gate. All three were resolved before implementation.

## Decision

Upgrade to `framework: mkdocs` with a Material-theme site published at
**<https://theoju.github.io/claude-code-self-assessment/>**.

Rejected alternatives:

- **Keep `framework: none`** — no publish-verifier coverage, no public URL,
  no broken-link enforcement.
- **Deploy via GitHub Pages branch** — `build_type=workflow` (the Pages
  artifact-upload path) is the correct model for mkdocs builds; branch-deploy
  publishing is not compatible with `deploy-pages@v5`.

## What shipped

### Scaffold

| File | Role |
| ---- | ---- |
| `mkdocs.yml` | Material theme; `search`, `awesome-pages`, `literate-nav` plugins; nav driven by `docs/site-src/SUMMARY.md` |
| `requirements-docs.txt` | Five pinned deps: `mkdocs==1.6.1`, `mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`, `mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2` |

### Source migration

Existing flat `docs/*.md` files were moved into `docs/site-src/` (the
`docs_dir` declared in `mkdocs.yml`). Nine broken relative links inside
`docs/site-src/` that pointed outside `docs_dir` — including cross-tree refs
into `.claude/` — were rewritten to absolute GitHub blob URLs so
`mkdocs build --strict` passes. Six additional files had their path references
updated: `README.md`, `CLAUDE.md`, `app/data/rubric.json`, the ship-pattern
page, slash commands, and the SKILL.md.

### CI

Two workflows ship together so build integrity is enforced at the PR level, not
discovered after merge.

**`docs-agent-pages.yml`** — push-to-main deploy:

```
trigger: push to main (docs/site-src/**, mkdocs.yml, requirements-docs.txt,
         workflow file) + workflow_dispatch
jobs:
  build → pip install -r requirements-docs.txt
          mkdocs build --strict
          touch site/.nojekyll
          upload-pages-artifact
  deploy → deploy-pages@v5
```

**`docs-build-check.yml`** — PR gate:

```
trigger: pull_request (same paths as above + docs-build-check.yml) +
         workflow_dispatch
concurrency: cancel-in-progress per PR branch
jobs:
  build → pip install -r requirements-docs.txt
          mkdocs build --strict --site-dir /tmp/site
```

Without `docs-build-check.yml`, a broken link can only be caught after merging
when the deploy workflow fires — too late for review feedback.

### Config flip

`.engineering-docs-agent/config.yml` now reads:

```yaml
docs:
  framework: mkdocs

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

This activates the nightly publish-verifier: it checks that `docs-agent-pages.yml`
ran for the current `main` HEAD and that `base_url` plus each lens page is
reachable within 60 seconds.

### Tests

21 new Vitest cases (689 total passing) across three new files:

- `scripts/__tests__/docs-path-migration.test.mjs` — verifies that relative
  links inside `docs/site-src/` resolve within `docs_dir`.
- `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` — asserts scaffold files
  exist with expected content (theme name, plugin list, `docs_dir` value).
- `scripts/__tests__/docs-config-mkdocs.test.mjs` — verifies the
  `.engineering-docs-agent/config.yml` contract (`framework`, `base_url`,
  `build_workflow`).

## Bootstrap caveat

`configure-pages@v6 enablement: true` does **not** bootstrap GitHub Pages on a
first deploy. The workflow `GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages`, so the first run fails with
`Resource not accessible by integration` even with `permissions: pages: write`
declared.

**Fix for future host repos:** before the first push-triggered deploy, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

from an admin login. Alternatively: Settings → Pages → Build and deployment →
Source → "GitHub Actions". Once Pages exists, `enablement: true` is a silent
no-op and was removed from `docs-agent-pages.yml` in PR #125 / CCE-82.

`build_type=workflow` also disables branch-deploy publishing — the only path to
`theoju.github.io/claude-code-self-assessment/` is via the `deploy-pages@v5`
artifact upload, which is what the workflow produces.

## Follow-up tickets

- **CCE-82** (PR #125) — remove the now-dead `enablement: true` line from
  `docs-agent-pages.yml`.
- **Plugin tech-debt (untracked)** — the plugin's `setup_scaffold` script does
  not exist; future host repos taking the mkdocs upgrade path repeat this
  manual scaffold work. Filed as a followup in the PR #121 description.
