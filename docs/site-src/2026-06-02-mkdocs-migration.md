---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: publish the docs site with MkDocs (2026-06-02)

The `.engineering-docs-agent/config.yml` in this repo used to carry
`framework: none` — the nightly engineering-docs-agent could author
pages, but there was nowhere for them to be *published*. The
`publish-verifier` stage of every nightly run skipped with
`verify_skipped` in `partial_reasons` because there was no site URL to
check against, and everything under `docs/` rendered only as flat
markdown through GitHub's own blob viewer.

PR #121 closes that gap: it flips `framework` to `mkdocs` and stands
up a real Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>.

## What changed

- **Scaffolded MkDocs.** `mkdocs.yml` at the repo root builds
  `docs_dir: docs/site-src` into `site_dir: site`, using the
  `material` theme plus `search`, `awesome-pages`, and
  `literate-nav` (nav order comes from `docs/site-src/SUMMARY.md`,
  not alphabetical). `requirements-docs.txt` pins the Python toolchain
  (`mkdocs`, `mkdocs-material`, `mkdocs-awesome-pages-plugin`,
  `mkdocs-literate-nav`, `pymdown-extensions`).
- **Migrated the flat docs.** The four existing `docs/*.md` files
  (`self-assessment.md`, `ship-pattern.md`,
  `boris-tips-reference-2026-05-10.md`,
  `tip-classification-2026-05-10.md`) and `docs/images/` moved to
  `docs/site-src/` via `git mv`, content verbatim — no rewriting, no
  IA restructuring in this PR. Cross-tree links (image paths,
  inter-doc references) were repaired so they resolve under
  `mkdocs build --strict` rather than GitHub's more forgiving
  renderer.
- **Two new CI workflows, two different jobs.**

  | Workflow | Trigger | Does |
  | --- | --- | --- |
  | `docs-agent-pages.yml` | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt` | `mkdocs build --strict` → `upload-pages-artifact` → `deploy-pages` |
  | `docs-build-check.yml` | pull requests touching the same paths | `mkdocs build --strict` only — no deploy, no Pages permissions |

  They're deliberately split: the PR-level gate exists so a broken
  link or missing nav entry fails review, not a post-merge deploy.
  Before this PR, only the post-merge workflow would have caught it —
  too late to be useful feedback.

- **Five field flips in `.engineering-docs-agent/config.yml`:**
  `docs.framework: none → mkdocs`,
  `docs.whats_new_file: docs/whats-new.md → docs/site-src/whats-new.md`,
  `docs.lens_paths.core: docs/ → docs/site-src/` (so the agent's core
  lens no longer recurses into `docs/superpowers/specs/`),
  `publishing.base_url: null → https://theoju.github.io/claude-code-self-assessment/`,
  and `publishing.build_workflow: null → docs-agent-pages.yml`.
- **Path references retargeted** across `README.md`, `CLAUDE.md`,
  `app/data/rubric.json`, `app/docs/ship-pattern/page.tsx` (both the
  runtime read path and the display string in the page header), and
  the self-assessment command/skill files — anywhere that pointed at
  the old flat `docs/*.md` locations.

`docs/superpowers/specs/` and `docs/superpowers/plans/` stay where
they are: design history for plugin lens analysis, intentionally
**not** published to the site. That's why `lens_paths.core` narrows to
`docs/site-src/` rather than `docs/` — the agent's core-lens authoring
should never wander into unpublished spec prose.

## Why now

The config had already documented this as the intended path:

> If you later scaffold mkdocs and add a deploy workflow, swap
> framework to mkdocs and fill in base_url + build_workflow.

Landing it does three things at once: gives the project a real,
browsable, searchable docs site instead of flat in-repo markdown;
turns on the nightly's `publish-verifier` stage end-to-end (it checks
that `build_workflow` ran for the current `main` HEAD and that
`base_url` plus each lens page resolves within
`verify_timeout_seconds: 60`, adding `verify_failed` to
`partial_reasons` — non-blocking — rather than the previous
unconditional `verify_skipped`); and replaces GitHub's blob renderer,
which silently tolerates broken relative links, with a strict build
that fails CI on them.

The work went through spec authoring, a 3-agent pre-execution
validation pass, and full `/ship` Stage 1–4 review before merge. The
validation pass is what caught the real blockers ahead of time —
broken `.claude/` cross-links, path references missed by a first-pass
`git mv`, and the absence of a PR-level build gate — rather than
finding them post-merge.

## A gotcha the PR surfaced

`actions/configure-pages@v6`'s `enablement: true` option looks like it
should bootstrap GitHub Pages on a repo's very first deploy. It
doesn't: the workflow's `GITHUB_TOKEN` lacks the admin scope
`POST /repos/.../pages` requires, and a workflow's `permissions:`
block can only narrow the default token's scopes, never grant new
ones. The first push-triggered run of `docs-agent-pages.yml` failed
with `Resource not accessible by integration`. The fix was to
bootstrap Pages once from an admin login
(`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`)
before the first deploy — after that, `enablement: true` is a
permanent no-op and safe to leave or remove. This repo's `CLAUDE.md`
Conventions section carries the full recovery sequence for anyone
onboarding a sibling repo down the same path.

## Verifying the result

- `curl -sI https://theoju.github.io/claude-code-self-assessment/` —
  expect `HTTP/2 200`.
- Each migrated page (`self-assessment`, `ship-pattern`,
  `boris-tips-reference-2026-05-10`, `tip-classification-2026-05-10`,
  `whats-new`) resolves at its own path under the base URL.
- `docs/superpowers/specs/...` paths return `404` on the published
  site — confirmation that the lens-path narrowing actually excludes
  them, not just that nothing links to them.
- The in-app `/docs/ship-pattern` route in the Next.js dashboard still
  renders — it reads `docs/site-src/ship-pattern.md` directly via
  `app/lib/doc-markdown.tsx`, independent of the mkdocs build.

## What this doesn't cover

No IA restructuring — the published site is still a flat list under
`docs/site-src/SUMMARY.md`, mirroring the pre-migration flat `docs/`
layout. No custom domain. No `mkdocstrings`/API-doc generation for the
dashboard's TypeScript (it isn't a public API surface). No release or
version bump rides on this change. A structural reorganization, once
the engineering-docs-agent has produced a few nightly cycles of
lens-authored content to reorganize around, is tracked as future work
rather than folded into this PR.
