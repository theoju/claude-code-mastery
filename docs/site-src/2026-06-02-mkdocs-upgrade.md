---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# MkDocs upgrade — 2026-06-02 (CCE-81, PR #121)

The engineering-docs-agent integration was upgraded from `framework: none` to
`framework: mkdocs` on 2026-06-02, publishing a Material-theme docs site at
<https://theoju.github.io/claude-code-self-assessment/>. This page records the
upgrade decision, the resulting CI shape, and the first-deploy onboarding
detail that future maintainers need if they replicate this setup.

## Background

`.engineering-docs-agent/config.yml` had always documented the mkdocs upgrade
as the intended end-state. The `framework: none` stance (CCE-64) was a
temporary hold while plugin support matured. In that state the nightly agent
ran but its `publish-verifier` stage emitted `verify_skipped` in
`partial_reasons` — no published site existed to check.

Three pre-execution validation agents caught and resolved real blockers before
the PR opened:

- **Broken cross-tree links** — migrated `.md` files referenced `.claude/` and
  `docs/superpowers/specs/` with relative paths that resolve on disk but fail
  inside mkdocs's `docs_dir` boundary.
- **Missed path refs in slash-command files** — several `.claude/commands/` and
  skill files still pointed at the old `docs/` locations.
- **No PR-level CI gate** — without `docs-build-check.yml`, a broken link in a
  docs PR would only surface after it landed on `main` and the post-merge Pages
  workflow failed.

## What changed

| Area | Change |
| ---- | ------ |
| `.engineering-docs-agent/config.yml` | `framework: none → mkdocs`; `publishing.base_url` and `build_workflow` filled in |
| `mkdocs.yml` | Scaffolded: Material theme, `awesome-pages`, `literate-nav`, `pymdownx` extensions |
| `requirements-docs.txt` | Pinned: `mkdocs==1.6.1`, `mkdocs-material==9.5.49`, `mkdocs-literate-nav==0.6.3`, `mkdocs-awesome-pages-plugin==2.10.1`, `pymdown-extensions==10.11.2` |
| `docs/site-src/` | Five files migrated from `docs/*.md`; nine broken relative links rewritten to absolute GitHub blob URLs |
| `docs/site-src/SUMMARY.md` | Navigation: Home, Self-Assessment, Ship Pattern, Reference (Boris Tips + Tip Classification), What's New |
| `.github/workflows/docs-agent-pages.yml` | Push-triggered deploy pipeline: build → upload Pages artifact → deploy |
| `.github/workflows/docs-build-check.yml` | PR-level gate: `mkdocs build --strict` on every docs-touching PR |
| Vitest suite | 21 new cases covering path migration correctness, scaffold integrity, and config contract validation. Total suite: 689 tests. |

## CI shape

Two workflows, two distinct roles.

**`docs-agent-pages.yml`** fires on pushes to `main` when any of
`docs/site-src/**`, `mkdocs.yml`, `requirements-docs.txt`, or the workflow
file itself changes (plus `workflow_dispatch` for manual triggers). It runs
`mkdocs build --strict`, writes a `.nojekyll` marker, uploads the `site/`
directory via `actions/upload-pages-artifact@v5`, and deploys via
`actions/deploy-pages@v5`. Requires `permissions: pages: write` and
`id-token: write`.

**`docs-build-check.yml`** is the PR-level gate. It mirrors the build step but
never deploys — its only job is catching broken links before merge. A
concurrency group keyed on `github.ref` cancels superseded runs on the same
branch; only the latest commit's build matters, and a pip-cached build finishes
in ~30 seconds.

The path filters on both workflows are identical. Adding a new source path
(e.g. a `requirements-docs-extra.txt`) to one must be added to the other to
keep the gates in sync.

## Migration path for `docs/site-src/`

Five files moved from `docs/*.md` to `docs/site-src/` verbatim — no content
rewriting in this PR. Nine relative links required repair:

- References to `.claude/` (cross-tree, outside mkdocs's `docs_dir`) →
  rewritten to `https://github.com/theoju/claude-code-self-assessment/blob/main/.claude/…`
- References to `docs/superpowers/specs/` (in-repo but intentionally
  unpublished) → rewritten to the same absolute GitHub blob pattern

**The rule going forward:** any link in `docs/site-src/` that targets a path
outside that directory must be an absolute GitHub URL, not a relative path.
`mkdocs build --strict` treats a relative link resolving outside `docs_dir` as
a build error, so `docs-build-check.yml` will catch violations on the next PR.

The `docs/superpowers/` subtree (`specs/`, `plans/`) stays in-repo for plugin
lens analysis but is intentionally **not** published to the site.

## First-deploy onboarding note

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
GitHub Pages on a first deploy. The `GITHUB_TOKEN` lacks the admin scope needed
to call `POST /repos/.../pages` even with `permissions: pages: write` declared
— the job fails with `Resource not accessible by integration`. On repos where
Pages already exists, `enablement: true` is a silent no-op. On a first deploy
it fails the run.

**Fix:** before the first workflow dispatch, run

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

from a personal or admin `gh` login, or navigate to Settings → Pages → Build
and deployment → Source = "GitHub Actions" in the GitHub UI. The
`build_type=workflow` setting is durable — all subsequent push-triggered runs
work cleanly with no further admin action.

The `enablement: true` line was subsequently removed in PR #125 / CCE-82. If
you're onboarding a new host repo with `framework: mkdocs`, issue the `gh api`
call before triggering the first workflow run.

## What this enables

With `framework: mkdocs` active, the nightly agent's `publish-verifier` stage
no longer emits `verify_skipped`. It now checks that `docs-agent-pages.yml`
ran for the current HEAD on `main` and that `base_url` plus each lens page is
reachable within the configured 60-second timeout. A failed verification adds
`verify_failed` to `partial_reasons` but does not block the nightly run.

The `docs/site-src/` directory is the agent-editable surface going forward.
Lens pages and `whats-new.md` entries are written there by the nightly run and
reviewed via the `docs-agent/YYYY-MM-DD` PR cycle.
