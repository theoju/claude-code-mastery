---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: mkdocs documentation site (CCE-81)

**Date:** 2026-06-02  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)  
**Status:** Shipped — site live at <https://theoju.github.io/claude-code-self-assessment/>

## Context

Before this change the engineering-docs-agent config declared `framework: none`,
which meant the nightly publishing workflow had nowhere to push generated lens
pages. Docs existed as raw markdown in `docs/` but were only readable via the
source tree — no navigation, no published URL, no search.

The engineering-docs-agent's automated page generation requires a concrete
framework target. Switching to `framework: mkdocs` unlocks the nightly fill-in
of lens pages and a stable public URL readers can bookmark.

## What changed

| Artifact | Change |
| --- | --- |
| `.engineering-docs-agent/config.yml` | `framework: none` → `framework: mkdocs` |
| `docs/site-src/` | New directory; existing flat `docs/*.md` files migrated here |
| `mkdocs.yml` | Added — Material theme, `docs_dir: docs/site-src`, strict mode off at runtime |
| `requirements-docs.txt` | Added — pins `mkdocs-material` and plugins |
| `.github/workflows/docs-agent-pages.yml` | Added — builds and deploys to GitHub Pages on push to `main` |
| `.github/workflows/docs-build-check.yml` | Added — runs `mkdocs build --strict` on every PR; blocks merge on broken links |
| `docs/superpowers/specs/` | Spec for this upgrade |
| `docs/superpowers/plans/` | Plan for this upgrade |

The CI gate uses `--strict` so a broken cross-doc link fails the PR immediately
rather than silently reaching main and breaking the published site. The deploy
workflow does not use strict mode — it lets the site build even when
agent-generated pages are incomplete drafts.

## Bootstrapping Pages on a new host (critical)

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
GitHub Pages on the first deploy. The `GITHUB_TOKEN` available to workflows
lacks the admin scope required to call `POST /repos/.../pages`, so the very
first run fails with `Resource not accessible by integration` even with
`permissions: pages: write` declared. After Pages exists via any path,
`enablement: true` becomes a permanent silent no-op.

**Fix before the first deploy:**

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Run this from a personal or admin `gh` login. The equivalent UI path is
Settings → Pages → Build and deployment → Source = "GitHub Actions".

`build_type=workflow` is durable — once set, all subsequent push-triggered runs
of `docs-agent-pages.yml` succeed and the `enablement: true` line is
meaningless (it was removed from the workflow post-incident).

**Side effect worth knowing:** `build_type=workflow` also disables branch-deploy
publishing. The only path to the public site is via the `deploy-pages@v5`
artifact upload. Static files pushed directly to `main` do not appear on the
site without a workflow run.

This incident (PR #121 first-deploy failure) is documented in the spec at
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` → "Post-implementation correction"
and in the plan's recovery section.

## Consumer-tool verification rule

This upgrade established a project convention: **plan-step verification must
use the actual consumer tool, not just filesystem checks.** A file can exist on
disk while violating the consumer's validity contract.

Concretely: `mkdocs build --strict` rejects link targets outside `docs_dir`
regardless of whether `test -f` passes. Verify published artifacts with
`mkdocs build --strict` (or `npx tsc --noEmit`, `ajv validate`, etc. for other
artifact types), not path existence checks.

## Files to know

```
mkdocs.yml                                    # site config; edit nav here
requirements-docs.txt                         # pin doc toolchain versions here
docs/site-src/                                # all source markdown lives here
.github/workflows/docs-agent-pages.yml        # Pages deploy workflow
.github/workflows/docs-build-check.yml        # PR-level strict build check
docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md
docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md
```

## Related

- CCE-82: removed the now-meaningless `enablement: true` line from the workflow (PR #125)
- Engineering-docs-agent CLAUDE.md — plugin-side fix detail for the bootstrapping incident
