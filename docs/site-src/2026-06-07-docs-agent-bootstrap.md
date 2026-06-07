---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Docs-agent bootstrap (2026-06-07)

PR #100 connected this repository to the [engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin. The agent now runs on a nightly schedule, generating and publishing lens-based documentation pages — including this one — from PR summaries and source signals.

## What was added

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host config — declares `framework: none`, which tells the plugin to skip mkdocs scaffold generation and write flat markdown directly into `docs/site-src/` |
| `.engineering-docs-agent/state.example.json` | Template for the agent's run-state cursor; use as a starting point if you're running the agent locally against a fork |
| `.engineering-docs-agent/state.json` | Live state file committed for the nightly GitHub Actions runner |
| `.github/workflows/docs-agent-pages.yml` | Workflow that triggers the agent on a nightly schedule and publishes to GitHub Pages |

## Why `framework: none`

The original bootstrap plan included a synthetic mkdocs scaffold so the agent had a build target. CCE-64 (engineering-docs-agent PR #84) introduced `framework: none` as a first-class config value — the agent writes flat markdown pages under `docs/site-src/` with no build framework required. That eliminated the scaffold and reduced onboarding to two things: a config file and a workflow.

The synthetic scaffold was removed before PR #100 merged. The committed diff is pure configuration.

## How nightly generation works

1. The Actions workflow fires on schedule (and on push to `main`).
2. The engineering-docs-agent reads `.engineering-docs-agent/config.yml`, resolves the `core` lens, and dispatches `page-author` subagents for each targeted page.
3. Generated pages land as flat markdown under `docs/site-src/` — no build step, no mkdocs invocation.
4. Changed files are committed back; on `main` the `docs-agent-pages.yml` workflow publishes the result to GitHub Pages.

## State file in forks

`state.json` is committed alongside `state.example.json`. The committed file records the agent's last-run cursor and is the right artifact for the canonical repo. If you fork this repository, consider gitignoring `state.json` and copying `state.example.json` as your starting point — the canonical cursor won't be meaningful against a separate run history.

## Tickets

- **CCE-57** — host bootstrap work for this repository
- **CCE-64** — `framework: none` support in engineering-docs-agent, which eliminated the synthetic scaffold and enabled the simplified onboarding path
