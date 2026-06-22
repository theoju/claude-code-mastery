---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: Upgrade to MkDocs (CCE-81, PR #121)

**Date:** 2026-06-02  
**Status:** Shipped  
**Relates to:** CCE-81 (reverses CCE-64's `framework: none` stance for this host)

---

## Context

The engineering-docs-agent config (`.engineering-docs-agent/config.yml`) had
carried `framework: none` since CCE-64 — the agent ran nightly but wrote
only into `docs/site-src/` without building or publishing anything. Three
independent pre-execution validation agents surfaced concrete blockers before
any code was written:

- Cross-tree relative links in existing `docs/*.md` files pointed to
  `.claude/` and `docs/superpowers/` subtrees that `mkdocs build --strict`
  would reject (they resolve outside `docs_dir`).
- Path references in slash-command files and `CLAUDE.md` targeted the old
  flat `docs/*.md` locations.
- No PR-level build gate existed, so a broken-link regression could land on
  `main` and only the post-merge Pages workflow would catch it — too late
  for review feedback.

All three were fixed before implementation began.

---

## Decision

Upgrade `.engineering-docs-agent/config.yml` from `framework: none` to
`framework: mkdocs` and publish a Material-theme docs site at
<https://theoju.github.io/claude-code-self-assessment/>.

---

## What shipped

### MkDocs config (`mkdocs.yml`)

Material theme with the following plugins and extensions:

| Field              | Value                                              |
| ------------------ | -------------------------------------------------- |
| `theme.name`       | `material`                                         |
| `docs_dir`         | `docs/site-src`                                    |
| `site_dir`         | `site`                                             |
| Plugins            | `search`, `awesome-pages`, `literate-nav`          |
| Nav file           | `docs/site-src/SUMMARY.md` (literate-nav)          |
| Markdown extras    | `admonition`, `tables`, `toc`, `pymdownx.superfences` (Mermaid) |

Pinned versions in `requirements-docs.txt`:

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

### Path migration

All existing flat `docs/*.md` files moved verbatim to `docs/site-src/`.
Nine broken relative links — cross-tree references to `.claude/` and
`docs/superpowers/` — were rewritten to absolute GitHub blob URLs so
`mkdocs build --strict` passes.

Path references updated across: `CLAUDE.md`, `README.md`, `rubric.json`,
and three skill/command files.

### CI workflows

**`.github/workflows/docs-agent-pages.yml`** — push-to-main deploy.

Fires on pushes to `main` that touch `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or the workflow file itself. Runs
`mkdocs build --strict`, writes `site/.nojekyll`, then deploys via
`actions/upload-pages-artifact@v5` + `actions/deploy-pages@v5`. Requires
`pages: write` and `id-token: write` permissions; uses the `pages`
concurrency group with `cancel-in-progress: false` so an in-flight deploy
is never killed mid-upload.

**`.github/workflows/docs-build-check.yml`** — PR-level strict-build gate.

Runs `mkdocs build --strict --site-dir /tmp/site` on every pull request
touching docs sources. Cancels superseded runs on the same PR branch
(`cancel-in-progress: true`). This mirrors the deploy workflow's build
step without deploying — broken links are caught during review, not after
merge.

### Tests

21 new Vitest test cases across three files:

| File | Coverage |
| ---- | -------- |
| `scripts/__tests__/docs-path-migration.test.mjs` | Every migrated file exists at `docs/site-src/`; no files remain at the old `docs/*.md` flat locations |
| `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` | `mkdocs.yml` parses; required keys (`site_name`, `docs_dir`, `plugins`) are present |
| `scripts/__tests__/docs-config-mkdocs.test.mjs` | `.engineering-docs-agent/config.yml` declares `framework: mkdocs`, `whats_new_file`, and `lens_paths.core` |

### Agent config (`.engineering-docs-agent/config.yml`)

Key fields after upgrade:

```yaml
docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  lens_paths:
    core: docs/site-src/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

The `core` lens root is `docs/site-src/`. New pages use flat lens-root
slugs (no subdirectory paths), because `available_sections` for core
contains only `images`.

---

## GitHub Pages first-deploy gotcha

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
GitHub Pages on a first deploy. The workflow token has `pages: write` but
lacks the admin scope needed to call `POST /repos/.../pages` — the first run
fails with `Resource not accessible by integration`.

Before the first pipeline run on a new fork, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or navigate to Settings → Pages → Build and deployment → Source → GitHub
Actions. Once Pages exists, all subsequent push-triggered runs of
`docs-agent-pages.yml` work without manual intervention.
`build_type=workflow` is durable and also disables branch-deploy publishing —
only `deploy-pages@v5` artifact uploads reach
`<owner>.github.io/<repo>/`.

The `enablement: true` field was removed from the workflow in the same PR
(`docs-agent-pages.yml` line 31 of the post-merge file omits it) since
it was a silent no-op after Pages bootstrapped.

---

## Alternatives considered

**Keep `framework: none` indefinitely.** The agent would continue writing
pages to `docs/site-src/` without building them, making it impossible to
catch broken links pre-merge and leaving no published URL for cross-linking
from CLAUDE.md or README.md. Rejected.

**Use a different static site generator (e.g. Docusaurus, VitePress).** The
engineering-docs-agent's `framework: mkdocs` path is the documented upgrade
target in the host config spec; the agent's publish-verifier understands
`build_workflow: docs-agent-pages.yml` against the `base_url`. Using a
different generator would require plugin-side changes. Rejected for this
iteration.

---

## References

- Spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
- What's New entry: [`docs/site-src/whats-new.md`](whats-new.md)
- CLAUDE.md § `actions/configure-pages@v6 enablement: true` convention note
