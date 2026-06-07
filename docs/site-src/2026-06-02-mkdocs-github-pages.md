---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# MkDocs + GitHub Pages: docs site upgrade (CCE-81)

PR #121 upgrades the engineering-docs-agent integration from `framework: none`
to `framework: mkdocs`, standing up a published Material-theme documentation
site at <https://theoju.github.io/claude-code-self-assessment/>.

Before this change, the nightly `docs-agent-nightly.yml` workflow ran but the
`publish-verifier` stage always exited as `verify_skipped` — no published site
existed to verify against. Flat Markdown files under `docs/` were only readable
via GitHub's blob renderer, not as a navigable docs site.

## What changed

### Scaffold

`docs/site-src/` is now the mkdocs source root. Existing flat `docs/*.md` files
were migrated verbatim into `docs/site-src/`. The new files added at the repo
root:

- **`mkdocs.yml`** — Material theme, `awesome-pages` + `literate-nav` +
  `mkdocstrings` plugins, `docs_dir: docs/site-src`, `strict: true` build.
- **`requirements-docs.txt`** — pinned versions for `mkdocs-material` and the
  three plugins above.

### GitHub Actions workflows

Two workflows were added:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `docs-agent-pages.yml` | push to `main` | Runs `mkdocs build --strict`, uploads the artifact, deploys to GitHub Pages via `deploy-pages@v5`. |
| `docs-build-check.yml` | every PR | Runs `mkdocs build --strict` and fails the check if any link or reference is broken. |

The strict-build PR gate is the key operational change for contributors. A
broken internal link or a reference to a file outside `docs_dir` will fail CI
before it reaches `main`.

### Config flip

`.engineering-docs-agent/config.yml` now reads:

```yaml
framework: mkdocs
lens_paths:
  core: docs/site-src/
publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
```

The `lens_paths.core` change is what routes the engineering-docs-agent's nightly
page-authoring writes to `docs/site-src/` rather than the old flat `docs/`
directory.

### Tests

Three new test files ship with the PR: mkdocs configuration validation, scaffold
correctness, and path migration verification.

## First-deploy correction: Pages bootstrap

`actions/configure-pages@v6 enablement: true` does **not** bootstrap GitHub
Pages on a fresh repository. Despite the field name and the action's
documentation, the workflow's `GITHUB_TOKEN` lacks the admin scope required to
call `POST /repos/.../pages`, so the very first deploy fails with
`Resource not accessible by integration`.

**Before the first deploy**, run this from a personal or admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source →
"GitHub Actions"**.

Once Pages exists via either path, the `enablement: true` field becomes a
silent no-op. PR #121 / CCE-81 hit this on first deploy; the `enablement: true`
line was removed from the workflow in the follow-up (PR #125 / CCE-82).
`build_type=workflow` also disables branch-deploy publishing — the only route to
the published site is the `deploy-pages@v5` artifact upload triggered by a push
to `main`.

## Per-PR authoring rules

All new docs pages for the `core` lens live under `docs/site-src/`. The
strict-build gate enforces this at PR time:

- Internal links must resolve within `docs_dir`. A link to a file outside
  `docs/site-src/` (e.g., a spec under `docs/superpowers/`) will fail
  `mkdocs build --strict`.
- Use relative paths for cross-page links inside `docs/site-src/`. Absolute
  URLs (`https://github.com/...`) are fine for external references.
- Verify with the real consumer tool, not just `test -f`:
  `mkdocs build --strict` from the repo root is the canonical check.

## Related

- Spec: [`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)
- Plan: [`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md)
- CCE-81 (upgrade ticket), CCE-82 (remove `enablement: true` follow-up)
