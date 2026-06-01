---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-docs-agent bootstrap (CCE-57)

PR #100 onboards `claude-code-self-assessment` as a host repository on the
engineering-docs-agent pipeline. The repo now participates in nightly
doc-maintenance runs without carrying any synthetic build tooling.

## What was added

### `.engineering-docs-agent/config.yml`

The host configuration file declares this repo to the plugin. The key field is
`framework: none` — a first-class config value introduced in CCE-64 specifically
to avoid requiring repos to fake an SSG setup. Before CCE-64 landed, the plan
called for a synthetic `mkdocs.yml` + `requirements-docs.txt` to satisfy the
plugin's enum; both were removed once `framework: none` became available,
so the config now accurately reflects the repo's plain-markdown-on-GitHub
shape.

### `.github/workflows/docs-agent-nightly.yml`

The nightly workflow wires together four previously independent capabilities:

| Capability | Ticket | What it provides |
| --- | --- | --- |
| App-token auth | CCE-45 | GitHub App credentials scoped to this repo for PR writes |
| OAuth validation | CCE-49 | Confirms token freshness before the agent run starts |
| Forensics upload | CCE-41 | Uploads agent run artifacts on failure for post-mortem inspection |
| Jira integration | CCE-53 | Links agent-authored PRs back to the originating CCE ticket |

The workflow runs on the nightly schedule defined by the plugin's host contract.
No manual trigger is needed after the initial merge.

### Seeded state files

Initial state files were committed alongside the config so the first nightly
run has a baseline to diff against rather than treating every doc as new.

## What was intentionally left out

The PR body references a post-merge runbook at
`docs/host-onboarding/claude-code-self-assessment.md`. That file is intended
for the plugin repo, not this one — it documents the plugin operator's side
of the onboarding, not the host's. It is not reflected here.

## Why `framework: none` matters

The engineering-docs-agent plugin previously required a recognized SSG
framework (`mkdocs`, `docusaurus`, etc.) to know how to parse and regenerate
docs. Adding `framework: none` (CCE-64) lets plain-markdown repos opt in
without committing misleading scaffolding. This repo serves its docs directly
on GitHub — no build step, no `site/` output directory — so `framework: none`
is the correct declaration.

If the repo ever adopts an SSG, update `.engineering-docs-agent/config.yml`
to reflect it. The nightly workflow does not need to change; the plugin reads
the framework value at runtime.
