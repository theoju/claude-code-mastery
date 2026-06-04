---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# MkDocs Upgrade — Enabling the Full Docs-Agent Loop (PR #121)

**Date:** 2026-06-02  
**Ticket:** CCE-81

## What changed

PR #121 upgraded the engineering-docs-agent integration from `framework: none`
to `framework: mkdocs`, standing up a full [MkDocs-Material](https://squidfunk.github.io/mkdocs-material/)
static site published to GitHub Pages at
<https://theoju.github.io/claude-code-self-assessment/>.

The config field flip was the last step. Everything it depends on had to be
hand-authored first:

| Artifact | Purpose |
| --- | --- |
| `mkdocs.yml` | Material theme, awesome-pages + literate-nav plugins, strict mode |
| `requirements-docs.txt` | Pinned build dependencies |
| `.github/workflows/docs-agent-pages.yml` | GitHub Pages deploy on push to `main` |
| `.github/workflows/docs-build-check.yml` | PR build verification (no deploy) |
| `.engineering-docs-agent/config.yml` | `framework: mkdocs`, live `base_url` |
| `docs/site-src/` | Hand-authored seed pages (index, whats-new, ship-pattern, boris-tips, tip-classification) |

Three test files were added alongside:

- MkDocs scaffold shape validation
- Config shape validation (framework, base\_url, build\_workflow)
- Path migration assertions

## Why this mattered

Before this PR the nightly docs-agent workflow ran successfully but the
`publish-verifier` stage always exited with `verify_skipped` — there was no
published site to verify against. The agent could produce lens pages but
had no way to confirm deployment. Flipping `framework: mkdocs` and providing
a real `base_url` closes the loop: subsequent nightly runs emit a real
verification result instead of skipping.

The upgrade path was documented in the original config file itself:

```yaml
# If you later scaffold mkdocs and add a deploy workflow, swap
# framework to mkdocs and fill in base_url + build_workflow.
```

This PR executes exactly that path.

## Operational gotcha: GitHub Pages first-deploy bootstrap

`actions/configure-pages@v6` with `enablement: true` does **not** actually
bootstrap GitHub Pages on a first deploy, despite the field name. The
workflow's `GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages` — even with `permissions: pages: write` declared.
The `permissions:` key can only restrict the default token's scopes, never
expand them.

The first run of the deploy workflow failed with:

```
Resource not accessible by integration
```

**Fix:** before the first deploy, run this from a personal/admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Once Pages exists, `enablement: true` becomes a silent no-op on every
subsequent run. The line was removed in PR #125 to avoid misleading
future readers.

`build_type=workflow` is also important: it disables branch-deploy publishing,
so the only path to `theoju.github.io/<repo>/` is via the `deploy-pages@v5`
artifact upload — which is what you want for MkDocs builds, but worth knowing
if you expect static files on `main` to appear automatically.

## Scaffold note: no plugin-side setup script

The plugin's `setup_scaffold` script does not exist in version 0.1.1. The
`scripts/` directory in the plugin cache contains only `setup_discover.py`
(read-only signal discovery); the `templates/` directory holds workflow YAML
and JSON schemas but not an mkdocs scaffold. The full scaffold was authored by
hand, using the engineering-docs-agent dogfood repo as the working reference.

Future host repos taking Path A (framework: none → mkdocs) will repeat this
manual work unless the plugin ships a scaffold step. Filed as plugin tech-debt
in the PR description.

## References

- Spec: [`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](../superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)
- Plan: [`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](../superpowers/plans/2026-06-01-mkdocs-upgrade.md)
- Published site: <https://theoju.github.io/claude-code-self-assessment/>
