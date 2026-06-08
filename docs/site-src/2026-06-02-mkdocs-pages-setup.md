---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# Docs site — CI pipeline and GitHub Pages setup

This page documents the CI workflow shape, the GitHub Pages bootstrap
procedure, and the rollback path for the MkDocs-based docs site published
at **https://theoju.github.io/claude-code-self-assessment/**. The site
was brought live in PR #121 as part of the engineering-docs-agent
upgrade from `framework: none` to `framework: mkdocs`.

## CI workflows

Two GitHub Actions workflows manage the docs pipeline:

| Workflow file | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/docs-agent-pages.yml` | Push to `main` | Runs `mkdocs build`, uploads the `site/` artifact, deploys to GitHub Pages via `actions/deploy-pages@v5`. |
| `.github/workflows/docs-build-check.yml` | PR opened / updated | Runs `mkdocs build --strict`. Fails the PR check if any page has a broken link or violates the mkdocs layout contract. |

The PR-level `--strict` gate is the primary guard against publishing a
broken site. It catches broken relative links and missing `nav:` entries
before they reach `main`. The deploy workflow does not re-run `--strict`
on push — it trusts the PR gate and moves straight to build + deploy.

### Source layout

All authored pages live under `docs/site-src/`. The `mkdocs.yml` config
sets `docs_dir: docs/site-src`. Files committed anywhere else in the
repo are not included in the built site.

Scaffold stubs required by the mkdocs layout contract:

| File | Purpose |
| --- | --- |
| `docs/site-src/index.md` | Landing page (required root entry). |
| `docs/site-src/whats-new.md` | Changelog; nightly agent appends entries here. |
| `docs/site-src/SUMMARY.md` | Navigation summary (MkDocs reads `nav:` from `mkdocs.yml`; this file is for human reference). |

## Bootstrapping GitHub Pages on a new fork

`actions/configure-pages@v6` with `enablement: true` does **not** create
GitHub Pages on a first deploy. The workflow's `GITHUB_TOKEN` lacks the
admin scope required by `POST /repos/.../pages`, so the first run fails
with `Resource not accessible by integration` even with
`permissions: pages: write` declared. The `enablement: true` field was
removed from `docs-agent-pages.yml` in PR #125 to avoid the confusion
going forward — but if you fork this repo before that change landed, you
will need to bootstrap Pages manually once:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Replace `<owner>/<repo>` with your fork's org/repo slug. The
`build_type=workflow` value is durable — once set, all subsequent
push-triggered deploys work cleanly without any further API calls or UI
changes. Equivalent UI path: **Settings → Pages → Build and deployment →
Source → GitHub Actions**.

After bootstrapping, retrigger the failed workflow run:

```bash
gh run rerun <run-id> --failed
```

Or push any commit to `main` to kick off a fresh deploy.

## Verifying a deploy

After a push to `main`, check the workflow run and the live URL:

```bash
# Watch the deploy workflow
gh run list --workflow docs-agent-pages.yml --limit 5
gh run view <run-id> --log

# Confirm Pages is serving the new build
curl -sI https://theoju.github.io/claude-code-self-assessment/ | head -5
```

A successful deploy returns HTTP 200 on the index. Propagation typically
takes under a minute after the workflow completes.

## Rollback

GitHub Pages redeploys on every push to `main`. To roll back to a
previous build:

1. Find the last known-good commit on `main`:

   ```bash
   git log --oneline main
   ```

2. Revert the offending commit (prefer revert over reset to keep a clean
   history):

   ```bash
   git revert <bad-sha>
   git push origin main
   ```

3. The deploy workflow fires automatically on push and publishes the
   reverted build. If you need to roll back faster than a new build takes
   (rare), you can re-run the deploy job from the last successful workflow
   run:

   ```bash
   gh run rerun <last-good-run-id>
   ```

   GitHub Pages will serve the re-uploaded artifact from that run.

There is no "previous version" retention beyond what the workflow
artifacts store (default 90-day GitHub Actions artifact retention). For
longer-term recovery, rely on `git revert`.

## Updating the site config

The engineering-docs-agent config lives at
`.engineering-docs-agent/config.yml`. The relevant fields for the pages
pipeline:

```yaml
framework: mkdocs
base_url: https://theoju.github.io/claude-code-self-assessment/
build_workflow: .github/workflows/docs-agent-pages.yml
```

If `base_url` changes (e.g. custom domain), update it here and in
`mkdocs.yml` (`site_url:`). The deploy workflow derives the Pages URL
from the repository's Pages settings, not from this config — the config
value is used by the agent for link validation and cross-reference
generation.
