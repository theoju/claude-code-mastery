---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: Upgrade to mkdocs (CCE-81)

**Date:** 2026-06-02  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)  
**Ticket:** CCE-81  
**Supersedes:** CCE-64 (`framework: none` stance)

---

## Context

Before this change, `.engineering-docs-agent/config.yml` held:

```yaml
docs:
  framework: none
publishing:
  base_url: null
  build_workflow: null
```

The flat `docs/*.md` files were rendered by GitHub's blob viewer at `/blob/main/docs/`. The nightly `docs-agent-nightly.yml` workflow ran successfully, but the publish-verifier stage skipped every run (`verify_skipped` in `partial_reasons`) because there was no published site to verify against. The config itself documented the intended upgrade path: *"If you later scaffold mkdocs and add a deploy workflow, swap framework to mkdocs and fill in base_url + build_workflow."*

CCE-81 executes that upgrade.

---

## Decision

Adopt `framework: mkdocs` with Material theme as the permanent docs-build posture for this host. Publish the site at `https://theoju.github.io/claude-code-self-assessment/`.

Five fields in `.engineering-docs-agent/config.yml` were flipped to activate the publish-verifier stage of the nightly agent:

| Field | Before | After |
|---|---|---|
| `docs.framework` | `none` | `mkdocs` |
| `docs.source_dir` | `docs` | `docs` |
| `docs.whats_new_file` | *(absent)* | `docs/site-src/whats-new.md` |
| `publishing.base_url` | `null` | `https://theoju.github.io/claude-code-self-assessment/` |
| `publishing.build_workflow` | `null` | `docs-agent-pages.yml` |

The `source_dir` value (`docs`) did not change, but it was previously an implicit default; the upgrade made it explicit.

---

## Why mkdocs over framework:none

`framework: none` was always a placeholder, not a permanent choice. The specific reasons to upgrade now rather than defer further:

1. **Publish-verifier was permanently skipped.** Without a real URL, the nightly agent's final stage — checking that the deployed site is reachable and that each lens page resolves — could never run. Every nightly emitted `verify_skipped`, silently degrading the agent's feedback loop.
2. **GitHub blob rendering is not a docs site.** Relative links between pages, search, navigation, and versioning all require a build pipeline. The existing `docs/*.md` files had already accumulated broken relative links that blob rendering masked.
3. **The upgrade path was explicitly pre-authorized.** The original config comment documented the intent; CCE-81 is the execution of that documented plan, not a new direction.
4. **Material + mkdocs is the plugin's reference implementation.** The engineering-docs-agent dogfood (`~/Projects/engineering-docs-agent`) uses the identical stack. Matching it means future plugin upgrades are tested against a reference that works the same way.

---

## Pre-execution validation: three-agent finding

Three independent agents ran pre-execution validation before the change landed. They caught real blockers:

1. **Broken `.claude/` cross-tree links** — slash command files under `.claude/commands/` contained relative paths to `docs/*.md` that would break after the move to `docs/site-src/`.
2. **Missing path refs in slash commands** — both `.claude/commands/self-assessment.md` and `.claude/skills/self-assessment/SKILL.md` referenced the old `docs/` paths.
3. **Absent CI gate** — no PR-level `mkdocs build --strict` check existed, meaning broken links could merge silently and only the post-merge Pages workflow would catch them — too late for review feedback.

All three were fixed as part of the PR before merge. The migration was clean on first deploy.

---

## What shipped

**New files (6):**

- `mkdocs.yml` — Material theme, `docs_dir: docs/site-src`, plugins: `search`, `awesome-pages`, `literate-nav` (nav driven by `docs/site-src/SUMMARY.md`). Pinned stack: mkdocs 1.6.1, mkdocs-material 9.5.49, mkdocs-awesome-pages-plugin 2.10.1, mkdocs-literate-nav 0.6.3, pymdown-extensions 10.11.2.
- `requirements-docs.txt` — pinned versions above; used as pip cache key in both CI workflows.
- `docs/site-src/` — source directory for the published site.
- `docs/site-src/SUMMARY.md` — literate-nav file; six entries on merge: Home, Self-Assessment, Ship Pattern, Reference (Boris Tips + Tip Classification), What's New.
- `.github/workflows/docs-agent-pages.yml` — push-triggered Pages deploy (see Architecture below).
- `.github/workflows/docs-build-check.yml` — PR-level strict-build gate (see Architecture below).

**Migrated files (4 verbatim moves):**

Existing `docs/*.md` files moved to `docs/site-src/` with no content changes. Nine broken relative links (caused by the path move) were repaired before `mkdocs build --strict` passed.

**Updated files (6):**

Path references updated in: `.gitignore`, `.prettierignore`, `README.md`, `CLAUDE.md`, and both slash-command files under `.claude/commands/`.

**Tests (3 new vitest files, 21 cases):**

- `scripts/__tests__/docs-path-migration.test.mjs` — verifies all links in migrated files resolve under `docs/site-src/`.
- `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` — verifies scaffold files exist and have required content.
- `scripts/__tests__/docs-config-mkdocs.test.mjs` — validates the config contract (the five flipped fields match expected values).

---

## Architecture: two workflows, two responsibilities

| Workflow | Trigger | Purpose | What it does not do |
|---|---|---|---|
| `docs-agent-nightly.yml` (pre-existing) | cron 07:07 UTC + `workflow_dispatch` | Run plugin orchestrator → open/update `docs-agent/YYYY-MM-DD` PR with authored pages | Does not build the site; does not deploy Pages |
| `docs-agent-pages.yml` (new) | push to `main` on docs paths + `workflow_dispatch` | `mkdocs build --strict` → upload artifact → `deploy-pages@v5` | Does not author content; does not open PRs |
| `docs-build-check.yml` (new) | pull requests touching docs paths | `mkdocs build --strict --site-dir /tmp/site` (no deploy) | Does not deploy; cancels superseded runs on the same PR branch |

The separation is intentional. The nightly runs on Claude OAuth credentials with a 60-minute timeout. The Pages workflow has no secrets and completes in ~30s. Failures are isolated: a nightly outage does not take down the published site; a Pages build break does not stop content authoring.

The path filter on `docs-agent-pages.yml` fires on changes to `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow file itself — not on every push to `main`. A vitest-only change does not trigger a Pages rebuild.

---

## Rollback

To revert to `framework: none`:

1. Flip `docs.framework` back to `none` and clear `publishing.base_url` + `publishing.build_workflow` in `.engineering-docs-agent/config.yml`.
2. The Pages site stops receiving updates but is not deleted; the GitHub Pages environment remains intact.
3. The two new CI workflows (`docs-agent-pages.yml`, `docs-build-check.yml`) can be left in place — they become dormant once the path filters no longer match — or deleted.
4. The `docs/site-src/` content and `mkdocs.yml` scaffold can be left in place; nothing breaks if the deploy workflow is inactive.

---

## Post-merge verification

After PR #121 merged to `main`, the following gates were confirmed:

| Gate | Check |
|---|---|
| CI build passes | `docs-build-check.yml` passed on the PR |
| Pages deploy succeeds | `docs-agent-pages.yml` completed with `deploy-pages@v5` artifact upload |
| Site is reachable | `https://theoju.github.io/claude-code-self-assessment/` returns HTTP 200 |
| Publish-verifier unblocked | Next nightly run emits `verify_skipped: false` (no longer in `partial_reasons`) |
| Config fields correct | `docs-config-mkdocs.test.mjs` passes in CI |

---

## Onboarding note: GitHub Pages bootstrapping

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap GitHub Pages on a repository that has never published before. The `GITHUB_TOKEN` in a GitHub Actions workflow cannot call `POST /repos/.../pages` — that endpoint requires admin scope, which `permissions: pages: write` cannot grant (the `permissions:` block can only restrict defaults, never elevate them).

The first deploy in the v0.9.20 cycle failed with `Resource not accessible by integration` for exactly this reason.

**Fix (one-time, before first deploy):** run this from an admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: Settings → Pages → Build and deployment → Source = "GitHub Actions".

`build_type=workflow` is durable — once set, all subsequent workflow-triggered deploys work cleanly. The `enablement: true` line was removed from `docs-agent-pages.yml` in PR #125 (CCE-82) after the incident; it was a silent no-op once Pages existed and actively misleading during first onboarding.

For future host repos using `framework: mkdocs`, the `gh api` call should run as part of onboarding before the first workflow dispatch. See CLAUDE.md for the full incident record.
