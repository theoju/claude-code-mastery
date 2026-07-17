---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Bootstrapping the engineering-docs-agent onto this repo

PR #100 onboarded `claude-code-self-assessment` onto the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin — the nightly pipeline (source-collector → pr-summarizer →
page-author → content-validator → gap-detector → notifier) that keeps this
docs site current without a human authoring every page by hand.

## What landed

- **`.engineering-docs-agent/config.yml`** — the host config: a single
  `core` lens rooted at `docs/`, and, at the time, `framework: none`
  (see [Framework=none, below](#framework-none-the-original-shape)).
- **`.engineering-docs-agent/state.json`** (seeded from
  `state.example.json`) — the orchestrator's run-tracking file: the SHA of
  the last successfully-processed commit and any dismissed gap flags.
  Both files ship a `version: "1"` envelope and an empty
  `dismissed_gap_flags`.
- **`.github/workflows/docs-agent-nightly.yml`** — a scheduled GitHub
  Actions workflow (cron `7 7 * * *`, off the `:00` pileup minute, plus
  `workflow_dispatch` for manual fires) that checks out this repo *and*
  vendors the plugin's `scripts/` from `theoju/engineering-docs-agent`
  into `.docs-agent-plugin/` in the runner workspace, then runs
  `orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"`.

This was this repo's first `.github/workflows/` file — everything else
(Vitest, Playwright) runs via `package.json` scripts, invoked locally or
elsewhere in CI. The workflow is scoped narrowly to the docs agent.

## Framework=none: the original shape

Before this PR, an earlier onboarding attempt had scaffolded a synthetic
`mkdocs.yml` and `requirements-docs.txt` purely to satisfy the plugin's
config schema, which at the time only recognized `framework: mkdocs` or
`framework: docusaurus`. That didn't fit: this repo's docs were (at that
point) plain Markdown rendered by GitHub, with no static-site generator
in the loop.

PR #100 removed the synthetic scaffold once the upstream plugin
(CCE-64) added `framework: none` as a first-class mode, and re-bootstrapped
onto that instead. With `framework: none`, the nightly workflow's own
comments spell out the tradeoff directly:

> framework=none host (CCE-64): no mkdocs/docusaurus toolchain needed.
> The `framework_build` lint rule skips cleanly for `framework=none`.
> Only `pyyaml` + `jsonschema` (orchestrator deps) are required.

Practically, that meant no `mkdocs build`/install step, no
build-validation stage, and no publish-verification stage — the pipeline
ran source-collector through notifier and stopped there. The tradeoff:
you get automated nightly authoring and gap detection, but no published,
browsable site — pages live as Markdown in the repo, discoverable via
GitHub's own renderer.

## What changed since

`framework: none` was the *initial* onboarded shape as of 2026-05-31, not
the durable one. The repo migrated to `framework: mkdocs` (CCE-82, PR
#125, 2026-06-02) once a real mkdocs-Material site and a GitHub Pages
publish workflow (`docs-agent-pages.yml`) existed — see
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` for that
design. The current `.engineering-docs-agent/config.yml` reflects the
mkdocs shape: `source_dir: docs`, a `core` lens at `docs/site-src/`, and a
`publishing` block pointing at
`https://theoju.github.io/claude-code-self-assessment/`. This page
documents the framework=none bootstrap as the decision record it was at
the time; treat the live `config.yml` as the source of truth for current
behavior.

## Why this shape, not a bigger one

The PR's own follow-up plan called out three deferred items, left out of
scope here deliberately: post-merge branch protection on the
`docs-agent/YYYY-MM-DD` branches the nightly workflow pushes, a nightly
smoke test for the workflow itself, and a general host-onboarding runbook
— the last of which belongs in the plugin repo, not this one, since it's
reusable across every host the plugin onboards.

This page itself is a flat decision record rather than filed under an
`operations/` or `architecture/` section, because neither exists yet
under the `core` lens (only an `images/` subdirectory does). A future
page-author pass can promote this into a proper section once one exists.
