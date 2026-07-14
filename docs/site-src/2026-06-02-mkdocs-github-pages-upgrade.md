---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Docs site upgrade: flat markdown → published MkDocs site

**Status:** shipped (PR #121, 2026-06-02) · **Ticket:** CCE-81/CCE-82

Docs used to live as plain `.md` files under `docs/`, rendered only by
GitHub's blob viewer. This PR flips the engineering-docs-agent
integration from `framework: none` to `framework: mkdocs` and stands
up a real published site at
[theoju.github.io/claude-code-self-assessment](https://theoju.github.io/claude-code-self-assessment/).

## What changed

- **New docs toolchain.** `mkdocs.yml` (docs root `docs/site-src`,
  Material theme, `navigation.tabs` / `navigation.sections` /
  `toc.follow` / `search.suggest`) plus `requirements-docs.txt` pin
  the build to `mkdocs`, `mkdocs-material`, `mkdocs-awesome-pages-plugin`,
  `mkdocs-literate-nav`, and `pymdown-extensions`. Nav order comes from
  `docs/site-src/SUMMARY.md` via the `literate-nav` plugin rather than
  alphabetical directory order.
- **Two workflows, two jobs.** `.github/workflows/docs-build-check.yml`
  runs on every PR touching `docs/site-src/**`, `mkdocs.yml`, or
  `requirements-docs.txt` and fails the PR if `mkdocs build --strict`
  doesn't exit 0 — broken links and missing nav entries get caught in
  review, not after merge. `.github/workflows/docs-agent-pages.yml`
  runs only on push to `main` for the same path filter: it builds the
  site, writes `.nojekyll`, and deploys via
  `actions/upload-pages-artifact` + `actions/deploy-pages`. The two are
  intentionally separate — the build-check gate has no `pages:` write
  permission and never deploys.
- **Verbatim migration.** The existing flat files moved into
  `docs/site-src/` unchanged: `self-assessment.md`, `ship-pattern.md`,
  `boris-tips-reference-2026-05-10.md`, `tip-classification-2026-05-10.md`,
  and the `images/` directory. No content rewriting happened in this
  PR — that's deliberately out of scope (see the design spec's
  non-goals).
- **`.engineering-docs-agent/config.yml` flipped** `docs.framework` to
  `mkdocs`, `docs.lens_paths.core` to `docs/site-src/` (so the agent's
  lens analysis doesn't recurse into `docs/superpowers/specs/`), and
  `publishing.base_url` / `publishing.build_workflow` to point at the
  live site and `docs-agent-pages.yml`. That activates the nightly's
  publish-verifier stage, which had been emitting `verify_skipped`
  since there was nothing to verify against.

## Why

The nightly engineering-docs-agent run authors lens pages and
`whats-new.md` entries, but with `framework: none` there was no
published surface for that content to land on — just markdown sitting
in a repo directory. Standing up a real site gives the agent a
publishing target, gives reviewers a strict build gate instead of
discovering broken links after the fact, and gives the project a
shareable docs URL instead of GitHub's blob renderer.

## Post-implementation correction: Pages bootstrap

The original rollout plan assumed
`actions/configure-pages@v6` with `enablement: true` would bootstrap
GitHub Pages on the very first deploy. It doesn't: the workflow's
`GITHUB_TOKEN` lacks the admin scope `POST /repos/.../pages` requires,
and a workflow's `permissions:` block can only *restrict* the default
token's scopes, never expand them. The first push-triggered run of
`docs-agent-pages.yml` failed at the `configure-pages@v6` step with
`Resource not accessible by integration`.

The actual fix was a one-time out-of-band call from an admin login:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
```

(equivalently: Settings → Pages → Build and deployment → Source =
"GitHub Actions"). After that one-time bootstrap, every subsequent
push-triggered run of `docs-agent-pages.yml` works cleanly, and the
`enablement: true` line becomes a permanent no-op. It was dropped from
the workflow shown above as part of the follow-up cleanup
(PR #125 / CCE-82). If you're onboarding a new host repo onto
`framework: mkdocs`, run the `gh api` bootstrap **before** the first
deploy, not after — see `CLAUDE.md`'s Conventions section for the full
incident writeup.

## Verification

`mkdocs build --strict` is the load-bearing check — it fails the PR
build on broken internal links or a `SUMMARY.md` entry pointing at a
file that doesn't exist, which GitHub's renderer would have silently
tolerated. Post-deploy, the design spec's verification matrix checks
each migrated page resolves at its live URL (`curl -sI` → `HTTP/2
200`) and that `docs/superpowers/specs/` stays unpublished (`curl -sI
.../superpowers/specs/.../` → `HTTP/2 404`, confirming the site is
scoped to `docs/site-src/` only).

## Consequences

- Docs PRs now carry a real CI gate (`docs-build-check.yml`) in
  addition to the app's existing lint/test/e2e suites.
- `docs/superpowers/specs/` remains in-repo but unpublished by design
  — it's plugin lens-analysis history, not user-facing documentation.
- IA restructuring, `mkdocstrings`-style API docs, and a custom domain
  were all explicitly deferred; the migration is flat and verbatim on
  purpose so the diff stays reviewable in one sitting.

## References

- Design spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
- Config: `.engineering-docs-agent/config.yml`
