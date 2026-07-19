---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Bootstrapping engineering-docs-agent onto this repo

PR #100 (2026-05-31) onboarded `claude-code-self-assessment` onto the
[`engineering-docs-agent`](https://github.com/theoju/engineering-docs-agent)
plugin — the automation that authors and maintains the pages under
`docs/site-src/`, including this one.

## What landed

- **`.engineering-docs-agent/config.yml`** — a single `core` lens rooted at
  `docs/site-src/`, with `framework: none`. At the time this PR merged, the
  repo's docs were plain markdown rendered by GitHub at `/blob/main/docs/` —
  there was no static-site generator and no published base URL, so
  `framework: none` was the accurate description, not a placeholder.
- **`.engineering-docs-agent/state.json`** (plus a `state.example.json`
  template) — tracks `last_successful_run.head_sha` and
  `dismissed_gap_flags` so the orchestrator knows where it left off between
  nightly runs.
- **`.github/workflows/docs-agent-nightly.yml`** — the first
  `.github/workflows/` file in this repo (everything else runs Vitest /
  Playwright via `package.json` scripts, invoked locally or elsewhere in CI).
  It's scoped narrowly to the docs agent: cron `7 7 * * *` (deliberately
  off the `:00` pileup slot) plus a `workflow_dispatch` escape hatch, and it
  runs the five stages that don't depend on a build step — source-collector,
  pr-summarizer, page-author, content-validator, gap-detector — followed by
  notifier.

An earlier pass at this had scaffolded a synthetic `mkdocs.yml` and
`requirements-docs.txt` to satisfy the plugin's config schema, which at the
time only accepted `mkdocs` or `docusaurus` as valid `framework` values.
That scaffold didn't reflect anything real — this repo had no mkdocs build,
no Pages deploy. CCE-64 added first-class `framework: none` support to the
plugin, and this PR replaced the synthetic scaffold with a config that
describes what actually exists.

## Why frameworkless still works

Two of the orchestrator's stages are framework-dependent and skip cleanly
when there's no SSG:

- **Build lint** — nothing to lint without a build step.
- **Publish-verifier** — nothing to verify without a `publishing.base_url`.

The remaining five stages don't care whether the output is a rendered site
or plain files GitHub renders inline. Nightly authoring — What's New
entries, PR summaries turned into doc content, gap detection against the
existing page set — runs the same either way. `framework: none` was a
legitimate end state, not a stopgap waiting on a build step to justify it.

## What's not yet in place

The PR description flagged three follow-ups that hadn't landed as of
2026-05-31 and aren't yet reflected elsewhere in this repo's docs:

1. Branch protection rules for the `docs-agent/YYYY-MM-DD` branches the
   nightly workflow opens PRs from.
2. A smoke test for the nightly workflow itself.
3. A host-onboarding runbook, to be added to the `engineering-docs-agent`
   plugin repo so the next host doesn't have to reconstruct this bootstrap
   from scratch.

## Historical note

This decision predates the mkdocs upgrade: `framework: none` was the
correct config for the state of the repo on 2026-05-31, but it was
explicitly documented as a stepping stone (the original config comment:
*"If you later scaffold mkdocs and add a deploy workflow, swap framework to
mkdocs and fill in base_url + build_workflow"*). That upgrade shipped via
CCE-82 (PR #125, 2026-06-02) — see
[`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](../superpowers/specs/2026-06-01-mkdocs-upgrade-design.md).
The current `.engineering-docs-agent/config.yml` now reads `framework:
mkdocs` with a live `publishing.base_url`; the bootstrap described above is
kept here as the record of how the plugin was first turned on, not as a
description of the present-day config.
