---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Docs site published to GitHub Pages (mkdocs)

**Date:** 2026-06-02
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)

This site — the one you're reading — went live on 2026-06-02. PR #121
flipped this repo's engineering-docs-agent integration from
`framework: none` to `framework: mkdocs` and stood up a published
Material-theme site at
<https://theoju.github.io/claude-code-self-assessment/>.

## Why now

`.engineering-docs-agent/config.yml` had documented this as the
intended upgrade path since the integration was first installed:
"swap framework to mkdocs and fill in base_url + build_workflow."
This PR executes that upgrade after a spec, a plan, and a 3-agent
pre-execution review surfaced and fixed real blockers before anything
shipped — broken `.claude/`-relative links in the migrated markdown,
missed path references inside `.claude/commands/` and
`.claude/skills/`, and a missing PR-level build gate that would
otherwise have let broken links land on `main` before anyone noticed.

Landing this also turns on the engineering-docs-agent's
publish-verifier stage for this host: each nightly run now checks
that `docs-agent-pages.yml` actually ran for the current `main` HEAD
and that the published pages are reachable, instead of skipping with
`verify_skipped`.

## What changed

- **Docs moved.** The flat `docs/*.md` files (`self-assessment.md`,
  `ship-pattern.md`, `boris-tips-reference-2026-05-10.md`,
  `tip-classification-2026-05-10.md`) and `docs/images/` moved into
  `docs/site-src/`, migrated verbatim — no content rewriting. Nav
  order lives in [`docs/site-src/SUMMARY.md`](SUMMARY.md), consumed by
  the `literate-nav` mkdocs plugin. `docs/superpowers/specs/` and
  `docs/superpowers/plans/` stayed put outside the published site;
  they're design history for plugin lens analysis, not user-facing
  docs.
- **Links repaired for the new tree.** Migrated files carried three
  classes of link that GitHub's renderer tolerated but
  `mkdocs build --strict` doesn't: image refs still pointed at the old
  `docs/images/` prefix, several `self-assessment.md` links reached
  `../.claude/skills/self-assessment/...` (outside `docs_dir`, can't
  be made internal), and both `self-assessment.md` and
  `ship-pattern.md` linked into `./superpowers/specs/...` (which
  intentionally stays unpublished). Image refs were rewritten relative
  to `docs/site-src/`; the other two classes became absolute GitHub
  blob URLs.
- **Two new CI workflows.**
  [`.github/workflows/docs-build-check.yml`](https://github.com/theoju/claude-code-self-assessment/blob/main/.github/workflows/docs-build-check.yml)
  runs `mkdocs build --strict` on every PR touching
  `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt` — no
  deploy, just the gate — so a broken link fails review instead of
  landing on `main` and only being caught by the post-merge site
  build.
  [`.github/workflows/docs-agent-pages.yml`](https://github.com/theoju/claude-code-self-assessment/blob/main/.github/workflows/docs-agent-pages.yml)
  builds and deploys the same site to Pages on every push to `main`
  that touches those paths, plus `workflow_dispatch`.
- **Config flipped.** `.engineering-docs-agent/config.yml` now has
  `docs.framework: mkdocs`, `docs.whats_new_file:
docs/site-src/whats-new.md`, `docs.lens_paths.core: docs/site-src/`
  (so the agent's lens analysis doesn't recurse into
  `docs/superpowers/`), `publishing.base_url:
https://theoju.github.io/claude-code-self-assessment/`, and
  `publishing.build_workflow: docs-agent-pages.yml` — the five fields
  the publish-verifier stage checks on each nightly run.
- **In-repo path references retargeted.** README.md (image link + two
  doc links), CLAUDE.md (three path refs plus a new "Docs site
  (mkdocs)" pointer block), `app/data/rubric.json` (one next-action
  string), the in-app `/docs/ship-pattern` page
  (`app/docs/ship-pattern/page.tsx`, both the runtime read path and
  the display string), `.claude/commands/self-assessment.md`, and
  `.claude/skills/self-assessment/SKILL.md` were all updated to point
  at `docs/site-src/`.
- **Test coverage.** 21 new vitest cases across three files:
  `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` (scaffold files
  exist with the right content, migrated files live at their new
  paths, originals are gone), `scripts/__tests__/docs-path-migration.test.mjs`
  (scans every tracked file for stale `docs/(ship-pattern|self-assessment|boris-tips|tip-classification|images)`
  references outside an explicit allow-list), and
  `scripts/__tests__/docs-config-mkdocs.test.mjs` (asserts the config
  file matches the mkdocs contract — framework, whats_new_file,
  lens_paths.core, base_url, build_workflow all populated together,
  not half-flipped).

## How the two workflows divide responsibility

| Workflow | Trigger | Does | Doesn't |
| --- | --- | --- | --- |
| `docs-build-check.yml` | pull_request touching docs paths | `mkdocs build --strict` against a scratch `/tmp/site` dir | Deploy anything |
| `docs-agent-pages.yml` | push to `main` on docs paths, or `workflow_dispatch` | `mkdocs build --strict` → write `.nojekyll` → upload-pages-artifact → deploy-pages | Author content, open PRs |

Neither workflow authors content — that's still the existing
`docs-agent-nightly.yml`, which opens the `docs-agent/YYYY-MM-DD` PR.
This launch only changes what happens to docs *after* they're
written: build-gated on PRs, deployed on merge.

## Still unverified as of merge

Two rollout items from the PR were unchecked when it landed and are
worth confirming before treating the site launch as fully proven:
the Pages auto-deploy actually firing on a push to `main`, and the
first nightly engineering-docs-agent run completing cleanly under
`framework: mkdocs` (no `verify_skipped` / `publish_verifier` entries
in `partial_reasons`).

## References

- Spec: [`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)
- Plan: [`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md)
- Config: `.engineering-docs-agent/config.yml`
