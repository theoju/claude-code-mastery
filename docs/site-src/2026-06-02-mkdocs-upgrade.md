---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: Upgrade to MkDocs (CCE-81 · PR #121)

**Date:** 2026-06-02  
**Status:** Shipped — site live at <https://theoju.github.io/claude-code-self-assessment/>

## Context

The engineering-docs-agent config shipped with `framework: none` — the agent
ran nightly linting and link checks, but had no publish stage and no public
URL. The agent's own config documented the upgrade path explicitly:

> "swap framework to mkdocs and fill in base_url + build_workflow"

Two conditions made the flip practical: (a) the `docs/site-src/` directory
already held real content worth publishing, and (b) the agent's
publish-verifier stage would be a no-op until a `framework` was named. This
PR executes that flip.

## Why MkDocs over the alternatives

The engineering-docs-agent supports MkDocs as its primary framework; the
`framework: mkdocs` config path is the one with first-class support for the
`literate-nav` and `awesome-pages` plugins the agent's scaffolding expects.
Static alternatives (Docusaurus, Astro) would have required a custom
`build_workflow` value with no agent-side awareness of nav generation or
strict-mode validation. MkDocs Material ships a coherent search, nav, and
theming layer with no per-page boilerplate.

## What changed

### Config flip (`.engineering-docs-agent/config.yml`)

Five fields were added or updated:

| Field | Before | After |
|-------|--------|-------|
| `framework` | `none` | `mkdocs` |
| `whats_new_file` | — | `docs/site-src/whats-new.md` |
| `lens_paths.core` | — | `docs/site-src/` |
| `base_url` | — | `https://theoju.github.io/claude-code-self-assessment/` |
| `build_workflow` | — | `.github/workflows/docs-agent-pages.yml` |

Rolling back means reverting exactly these five fields. No other config
surface needs to change.

### MkDocs setup

`mkdocs.yml` at the repo root wires three plugins — `search`, `awesome-pages`,
`literate-nav` — and sets the Material theme. Five pinned dependencies in
`requirements-docs.txt` make CI builds reproducible. The `docs_dir` is
`docs/site-src/`.

### CI workflows

Two workflows were added:

- **`docs-agent-pages.yml`** — triggers on push to `main`; builds with
  `mkdocs build --strict` then uploads via `actions/upload-pages-artifact@v3`
  and deploys via `actions/deploy-pages@v5`. Uses the GitHub Pages artifact
  path (not branch-deploy), so `build_type=workflow` is a prerequisite (see
  [First-deploy workaround](#first-deploy-workaround) below).
- **`docs-build-check.yml`** — triggers on every PR; runs
  `mkdocs build --strict` and fails if any link target or nav entry is missing.
  This is the gate that caught the nine broken relative links before merge.

### Content migration

Existing flat `docs/*.md` files moved into `docs/site-src/`. Nine broken
relative links were repaired: cross-tree refs that pointed into `.claude/`
(outside `docs_dir`) were rewritten to absolute GitHub blob URLs because
`mkdocs build --strict` rejects link targets outside `docs_dir` regardless
of whether they exist on disk.

Three stub files were created as the initial nav scaffold:
`docs/site-src/index.md`, `SUMMARY.md`, and `docs/site-src/whats-new.md`.

## Three-agent pre-validation cycle

The PR was pre-validated by three independent agents before implementation.
Each caught a distinct class of real blocker:

1. **Path-migration agent** — identified nine broken relative links in the
   existing `docs/*.md` files that would fail `mkdocs build --strict`. The
   cross-tree `.claude/` refs were the most common class; they require absolute
   GitHub blob URLs because mkdocs's `docs_dir` boundary is enforced at build
   time, not filesystem resolution time.

2. **Scaffold-validity agent** — confirmed that `SUMMARY.md` and `index.md`
   stubs were required by the `literate-nav` + `awesome-pages` plugin
   combination before the first deploy; an empty `docs/site-src/` with no nav
   anchor causes a build error, not a warning.

3. **CI-gate agent** — flagged that a PR-level `mkdocs build --strict` check
   was missing from the initial workflow draft. Without it, a broken link
   introduced in a future PR would pass CI and only fail at the nightly deploy
   stage — a 24-hour detection gap.

All three blockers were fixed before the PR was opened.

## First-deploy workaround

`actions/configure-pages@v6` with `enablement: true` does **not** bootstrap
GitHub Pages on a new repo. The action's `GITHUB_TOKEN` lacks the admin scope
required to call `POST /repos/{owner}/{repo}/pages`, even with
`permissions: pages: write` declared in the workflow. `permissions:` can
restrict the default token's scopes, not expand them.

Before the first push to `main`, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

or navigate to **Settings → Pages → Build and deployment → Source → GitHub
Actions** in the repo UI. `build_type=workflow` is durable — once set, all
subsequent workflow runs deploy cleanly and the `enablement: true` field in
`configure-pages@v6` becomes a silent no-op. The field was removed from
`docs-agent-pages.yml` in the same PR to avoid misleading future readers.

For repos you onboard using the engineering-docs-agent's `setup_scaffold`
script, the `gh api` call should be baked into the script's post-scaffold
step (filed as a plugin tech-debt followup; see PR #121 description).

## Rollback

Revert the five-field config flip in `.engineering-docs-agent/config.yml`
(listed in the table above). The CI workflows and `mkdocs.yml` can stay in
place — they're inert without `framework: mkdocs` in the agent config. The
`docs/site-src/` migration is a one-way move; the original flat `docs/*.md`
paths no longer exist. If you need to revert that too, restore from the
pre-merge state of the branch.
