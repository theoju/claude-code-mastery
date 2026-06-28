---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Engineering-Docs-Agent Bootstrap

**Date:** 2026-06-28  
**PR:** [#100](https://github.com/theoju/claude-code-self-assessment/pull/100)

## Decision

Onboard `claude-code-self-assessment` onto the engineering-docs-agent plugin so that documentation is maintained automatically on a nightly schedule rather than by hand.

## What was added

Three artifacts land in the repository:

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Plugin configuration; sets `framework: none` (plain markdown, no static-site build step) |
| `.engineering-docs-agent/state*.json` | Initial and example agent-state files seeding the first run |
| `.github/workflows/docs-agent-nightly.yml` | Nightly CI workflow that drives the agent |

### Nightly workflow shape

The workflow runs each night and chains four integration concerns, each backported from a parallel CCE ticket:

- **App-token authentication** (CCE-45) — uses a GitHub App token rather than `GITHUB_TOKEN` so the agent can open PRs against its own workflow files without hitting the push-protection reflex.
- **OAuth validation** (CCE-49) — validates the agent's upstream OAuth credentials before any write step runs; early exit on auth failure avoids partial-state commits.
- **Forensics upload** (CCE-41) — uploads the agent run's evidence bundle as a workflow artifact so failures are inspectable after the fact.
- **Jira wiring** (CCE-53) — posts a run-completion comment to the linked CCE ticket when the agent opens or updates a documentation PR.

`framework: none` support (CCE-64) was a prerequisite; it landed upstream before this PR and tells the plugin not to attempt an `mkdocs build` or similar.

## Why

The repo's `docs/site-src/` directory is updated by PRs and refactoring cycles that the team doesn't want to manually trace into docs. Automating this removes the lag between code changes and documentation and catches coverage gaps without a human reviewer needing to notice them.

The `framework: none` setting reflects that this repo publishes docs via the `docs-agent-pages` workflow rather than a local mkdocs build — the agent writes markdown, CI publishes it.

## What this does not change

- The nightly workflow runs in CI only; it does not affect `npm run assess`, `npm run dev`, or local scoring in any way.
- No new runtime dependencies are added to the Next.js app.
- The breaking flag is `false`; existing consumers of `assessment.json` and the dashboard are unaffected.

## Follow-up

The `docs/site-src/` tree currently has only an `images/` subdirectory. As the agent runs nightly it will populate lens pages and `whats-new.md`. Architecture or operations subdirectories can be created once the volume of agent-authored pages justifies the hierarchy.
