---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: move to a published MkDocs site (`framework: mkdocs`)

**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)

## Context

Before this change, `.engineering-docs-agent/config.yml` had this repo
registered with `framework: none`. Docs lived as flat markdown under
`docs/`, rendered only by GitHub's blob viewer at `/blob/main/docs/`.
The nightly engineering-docs-agent run still executed, but its
`publish-verifier` stage skipped every time — there was no built site
to check reachability against, so every run's `partial_reasons`
carried `verify_skipped`.

## What changed

PR #121 flips this repo from `framework: none` to `framework: mkdocs`
and stands up a real published site. Concretely:

- **`mkdocs.yml`** at the repo root, `docs_dir: docs/site-src`,
  Material theme with `navigation.tabs`, `navigation.sections`,
  `navigation.top`, `toc.follow`, and `content.code.copy`. Plugins are
  deliberately minimal: `search`, `awesome-pages`, and
  `literate-nav` (nav order comes from `docs/site-src/SUMMARY.md`
  rather than alphabetical directory order).
- **`requirements-docs.txt`** pins `mkdocs==1.6.1`,
  `mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
  `mkdocs-literate-nav==0.6.3`, and `pymdown-extensions==10.11.2` —
  the last one pinned explicitly because `pymdownx.superfences` (with
  a `mermaid` custom fence) is in the markdown extension list, and an
  unpinned `pymdown-extensions` bump could silently change fence
  behavior.
- **Two CI workflows**, split by responsibility:
  - `docs-agent-pages.yml` — fires on push to `main` when
    `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`
    change (plus `workflow_dispatch`). Runs `mkdocs build --strict`,
    writes `.nojekyll` into the build output so Pages serves it as-is,
    then uploads and deploys via `actions/upload-pages-artifact@v5` /
    `actions/deploy-pages@v5`.
  - `docs-build-check.yml` — the PR-time gate. Same
    `mkdocs build --strict` step, built to a throwaway
    `/tmp/site` directory, but never deploys. Without this, a broken
    internal link would only surface after merge, when the
    post-merge Pages workflow fails — too late for review feedback.
- **The existing `docs/*.md` files moved verbatim** into
  `docs/site-src/` (self-assessment guide, ship-pattern reference, the
  Boris tips reference and classification docs, plus the `images/`
  directory) — no content rewriting, no IA restructuring in this PR.
  `docs/site-src/index.md` and `docs/site-src/SUMMARY.md` are new,
  hand-authored: a short landing page and the explicit literate-nav
  ordering (Home → Self-Assessment → Ship Pattern → Reference →
  What's New).
  `docs/superpowers/specs/` and `docs/superpowers/plans/` stay where
  they are — design history for plugin lens analysis, deliberately
  left off the published site.

`.engineering-docs-agent/config.yml` picks up the matching flips:
`framework: mkdocs`, `lens_paths.core: docs/site-src/`,
`publishing.base_url: https://theoju.github.io/claude-code-self-assessment/`,
and `publishing.build_workflow: docs-agent-pages.yml`.

## Why

Two things this repo lacked before: a stable, navigable URL for
contributors and the nightly agent to target, and a CI gate that
catches broken cross-references before they merge. `framework: none`
meant the publish-verifier had nothing to check, so a broken link in
an agent-authored page could sit unnoticed indefinitely — the
raw-markdown GitHub view doesn't validate relative links the way a
built site does. Splitting the build into two workflows
(`docs-agent-pages.yml` for deploy, `docs-build-check.yml` for PR
review) keeps the deploy path minimal — no secrets, ~30s runtime —
while giving every PR touching docs the same `mkdocs build --strict`
check the deploy will eventually run.

## Post-implementation correction: Pages bootstrap

The design assumed `actions/configure-pages@v6` with
`enablement: true` would programmatically turn on GitHub Pages for
the repo on its first run. It doesn't: the workflow's default
`GITHUB_TOKEN` doesn't carry the admin scope `POST /repos/.../pages`
needs, and a workflow's `permissions:` block can only narrow the
token's scopes, never grant new ones. The first push-triggered run
against the squash-merge commit failed at the `configure-pages@v6`
step with `Resource not accessible by integration`.

Recovery was a one-time out-of-band call from an admin `gh` login:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
gh workflow run docs-agent-pages.yml --ref main
```

Once Pages exists (via that call, or the equivalent Settings → Pages
→ Build and deployment → Source = "GitHub Actions" UI path),
`enablement: true` becomes a permanent no-op — every subsequent
push-triggered run builds and deploys cleanly. The current
`.github/workflows/docs-agent-pages.yml` in this repo no longer
carries the `enablement: true` line at all (removed in the CCE-82
follow-up); the bootstrap step now lives in the
engineering-docs-agent plugin's setup skill instead of being retried
per-workflow-run. See `CLAUDE.md`'s Conventions section for the
durable version of this gotcha, and
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`'s
"POST-IMPLEMENTATION CORRECTION" note for the full incident record.

## Result

The site is live at
[theoju.github.io/claude-code-self-assessment/](https://theoju.github.io/claude-code-self-assessment/),
built from `docs/site-src/` on every qualifying push to `main`, and
every docs PR now runs a strict build before it can merge. The
engineering-docs-agent nightly's publish-verifier can check the live
URL instead of skipping.
