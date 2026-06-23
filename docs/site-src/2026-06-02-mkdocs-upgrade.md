---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: Upgrade to MkDocs (PR #121 / CCE-81)

**Date:** 2026-06-02  
**Status:** Shipped  
**Ticket:** CCE-81  
**Spec:** `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`  
**Plan:** `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`

## What changed

PR #121 upgraded the engineering-docs-agent integration from `framework: none`
to `framework: mkdocs`, publishing a Material-theme docs site at
<https://theoju.github.io/claude-code-self-assessment/>.

The change landed seven things:

| Artifact | Description |
| --- | --- |
| `mkdocs.yml` | Material theme, search + awesome-pages + literate-nav plugins, pinned deps |
| `requirements-docs.txt` | Pinned versions: mkdocs 1.6.1, mkdocs-material 9.5.49, awesome-pages 2.10.1, literate-nav 0.6.3, pymdown-extensions 10.11.2 |
| `.github/workflows/docs-agent-pages.yml` | Push-to-main deploy workflow; fires only when `docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow itself changes |
| `.github/workflows/docs-build-check.yml` | PR-level `mkdocs build --strict` gate; cancels superseded runs on the same branch |
| `docs/site-src/` scaffold | Four existing `docs/*.md` files migrated verbatim; broken cross-tree relative links rewritten to absolute GitHub blob URLs |
| `.engineering-docs-agent/config.yml` | Flipped `framework: mkdocs`, filled in `base_url` and `build_workflow`, activating the nightly publish-verifier stage |
| 21 Vitest cases | Three new test files covering path migration, scaffold existence, and the config contract |

## Why

The `.engineering-docs-agent/config.yml` had always documented the upgrade
path inline: _"If you later scaffold mkdocs and add a deploy workflow, swap
framework to mkdocs and fill in base_url + build_workflow."_ This PR executes
that path.

The immediate motivation was activating the nightly publish-verifier stage. With
`framework: none`, every nightly run emitted `verify_skipped` in
`partial_reasons` because there was no published site to verify against. Flipping
to `framework: mkdocs` wires the verifier to check `base_url` reachability after
each nightly authoring run — so a deploy failure surfaces in the PR rather than
silently passing.

The secondary benefit is a publicly navigable site. GitHub's blob renderer handles
flat markdown adequately; it does not handle cross-page navigation, search, or
Material's admonition/superfences syntax. The published site does all three.

### What this PR intentionally did not do

- **No IA restructuring.** Verbatim moves only. Structural reorganization is
  agent-driven and follows later.
- **No mkdocstrings for TypeScript.** `app/`, `scripts/`, `lib/` aren't a
  public API surface.
- **No custom domain.** `theoju.github.io/claude-code-self-assessment/` is the
  chosen URL for now.
- **No version bump or release** in this PR.

## Pre-execution validation findings

Three independent agents reviewed the change before the PR opened and caught
real blockers:

1. **Broken `.claude/` cross-tree links.** Several `docs/*.md` files used
   relative paths that resolved correctly from the repo root but broke under
   `docs_dir: docs/site-src` (mkdocs resolves links relative to the page's
   location in `docs_dir`). Fix: rewrite to absolute GitHub blob URLs
   (`https://github.com/theoju/claude-code-self-assessment/blob/main/...`).

2. **Missed path refs in slash commands and skills.** `self-assessment.md`
   and `SKILL.md` held hardcoded paths to the pre-migration `docs/` locations.
   These were retargeted to `docs/site-src/`.

3. **Missing PR-level CI gate.** The original plan relied solely on the
   post-merge deploy workflow to catch strict-mode failures. A broken link
   landing on `main` would fail the deploy and require a hotfix PR. Adding
   `docs-build-check.yml` moves the gate to PR review time — the build takes
   ~30 s with pip cache, and the job cancels superseded runs on the same branch.

## Post-merge incident: `configure-pages@v6 enablement: true`

The first run of `docs-agent-pages.yml` after PR #121 merged failed with:

```
Resource not accessible by integration
```

**Root cause.** `actions/configure-pages@v6` with `enablement: true` does not
bootstrap GitHub Pages on a first deploy. Despite the field name and the
action's documentation, the workflow's `GITHUB_TOKEN` lacks the admin scope
required to call `POST /repos/.../pages`. Adding `permissions: pages: write`
to the workflow only _restricts_ the default token's scopes — it cannot expand
them beyond what the installation grants.

**Fix (one-time, per repository).** Before the first deploy, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

from an admin login (or enable Pages via Settings → Pages → Source → "GitHub
Actions"). The `build_type=workflow` flag is durable — once set, all subsequent
workflow runs deploy cleanly. It also disables branch-deploy publishing, so only
the `deploy-pages@v5` artifact upload path reaches the live site.

Once Pages exists, `enablement: true` is a silent no-op forever. The field was
removed from the workflow in PR #125 / CCE-82.

**For future host repos onboarded with `framework: mkdocs`:** the `gh api` call
should be baked into the engineering-docs-agent's `setup_scaffold` script. That
script does not currently exist (see the spec's §Correction on the original
prompt — the plugin's `scripts/` directory contains only `setup_discover.py`);
the manual scaffold step is real plugin-side tech-debt filed as a follow-up in
the PR #121 description.

## Rollback procedure

The upgrade is isolated to four files and two CI workflows. To revert:

1. **Revert `.engineering-docs-agent/config.yml`** — flip `framework` back to
   `none`, clear `base_url` and `build_workflow`. This immediately stops the
   nightly publish-verifier from running.

2. **Delete or disable the two CI workflows** — remove
   `docs-agent-pages.yml` and `docs-build-check.yml` (or remove their triggers)
   to stop deploy and PR-gate builds.

3. **Optionally remove `mkdocs.yml` and `requirements-docs.txt`** — these have
   no runtime impact on the Next.js app; they can stay without causing harm.

4. **Optionally move `docs/site-src/` content back to `docs/`** — the Next.js
   renderer at `app/docs/ship-pattern/page.tsx` reads `docs/site-src/ship-pattern.md`;
   if you move files, update that import path.

The Pages deployment itself is not automatically torn down on revert. Disable it
via Settings → Pages → Source → "None" if you need the URL to stop serving.

## Two-workflow separation

The deploy workflow (`docs-agent-pages.yml`) and the nightly authoring workflow
(`docs-agent-nightly.yml`) are intentionally separate:

- The nightly runs on Claude OAuth + Jira credentials with a 60-minute timeout.
  A nightly outage does not take down the published site.
- The Pages workflow has no secrets and runs in ~30 s. A strict-build failure
  does not block content authoring.

Failures on each axis are independently diagnosable and independently retryable
via `workflow_dispatch`.
