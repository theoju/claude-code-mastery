---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Engineering-docs-agent bootstrap (2026-05-31)

This repo is now a host for the [engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin — the pipeline that writes this page. PR #100 (CCE-57) did the
bootstrap: added `.engineering-docs-agent/config.yml`, seeded the
run-state file, and added the nightly workflow that drives
source-collector → pr-summarizer → page-author → content-validator →
gap-detector → notifier.

## What landed

- **`.engineering-docs-agent/config.yml`** — one lens, `core`, mapped
  at `docs/site-src/`. Voice samples point at `README.md` and
  `CLAUDE.md` so the agent's tone stays anchored to how this repo
  already writes about itself.
- **`.engineering-docs-agent/state.json`** (plus a `state.example.json`
  template) — tracks `last_successful_run.head_sha` /
  `pr_number` and a `dismissed_gap_flags` map so the nightly run knows
  where it left off and which gap-detector flags a maintainer has
  already triaged.
- **`.github/workflows/docs-agent-nightly.yml`** — this repo's first
  `.github/workflows/` file. (Everything else runs Vitest/Playwright
  via `package.json` scripts.) It's scoped narrowly to the docs agent:
  checks out the host repo with a GitHub App installation token,
  vendors the plugin's `scripts/` into `.docs-agent-plugin` via a
  second checkout, installs the Python orchestrator deps, and runs
  `orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"`. Fires
  daily at 07:07 UTC (off-minute, per GitHub Actions scheduling
  guidance) or on `workflow_dispatch`.

## Why `framework: none`, briefly

At merge time this repo had no static-site generator — docs were
plain markdown rendered by GitHub. CCE-64 landed `framework: none` as
a first-class value in the plugin's config schema specifically to
unblock this kind of host: a repo that wants the authoring pipeline
(summarize PRs, draft/update pages, flag gaps) without being forced
into adopting mkdocs or Docusaurus just to satisfy the config
contract. An earlier commit on the same PR had scaffolded a synthetic
`mkdocs.yml` + `requirements-docs.txt` to satisfy an older,
mkdocs-only config shape; once `framework: none` shipped, that
scaffold was deleted so the committed config matched the repo's real
shape instead of a toolchain grafted on to fit the schema.

The nightly workflow reflects the same call: no mkdocs/Docusaurus
install step, because framework=none needs none — only `pyyaml` +
`jsonschema` for the orchestrator itself.

## Where this stands now

The docs site has since moved past plain-GitHub-rendered markdown —
see `CLAUDE.md`'s "Docs site (mkdocs)" section and
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — and
`.engineering-docs-agent/config.yml` now declares `framework: mkdocs`
with a `publishing.build_workflow: docs-agent-pages.yml` block wired
to `https://theoju.github.io/claude-code-self-assessment/`. The
nightly authoring workflow this page describes doesn't need to change
for that: it only *authors* content, it doesn't build the site, so it
still installs just `pyyaml` + `jsonschema` regardless of which
framework value is set. Site-build verification is a separate
concern, handled by `.github/workflows/docs-build-check.yml` on every
PR.

## Follow-ups not covered here

The PR body flagged three post-merge items that are operational,
not documentation: branch protection on the `docs-agent/YYYY-MM-DD`
branch pattern, a smoke test for the first nightly fire, and a
plugin-repo onboarding runbook. None of those change what's committed
to this repo's docs, so they aren't reflected as separate pages here —
track them against CCE-57 directly.
