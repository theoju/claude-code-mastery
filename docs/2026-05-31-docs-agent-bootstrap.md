---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Bootstrapping the engineering-docs-agent (2026-05-31)

PR #100 (CCE-57) onboards this repo onto the engineering-docs-agent pipeline — the automated doc gap-detection and page-authoring system. The bootstrap is minimal by design: one config file, one workflow, one state file.

## What landed

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host config: `framework: none`, single `core` lens at `docs/` |
| `.engineering-docs-agent/state.json` | Seeded state file tracking which PRs have been processed |
| `.engineering-docs-agent/state.example.json` | Template for state file structure |
| `.github/workflows/docs-agent-nightly.yml` | Nightly CI workflow that runs the plugin against this repo |

The nightly workflow wires in all plugin fixes that were in flight at merge time:

- **CCE-45** — GitHub App token auth (not a PAT)
- **CCE-49** — OAuth validation guard
- **CCE-41** — forensics artifact upload on failure
- **CCE-53** — Jira ticket transitions tied to triggering PRs

## Why `framework: none`

The repo has no static site generator — docs are plain markdown under `docs/`. Earlier iterations of the plugin required a synthetic mkdocs scaffold to satisfy the SSG requirement. CCE-64 (landed in plugin main before this PR merged) added `framework: none` as a first-class config value. The scaffold was removed; the config now declares the repo's actual shape.

The single lens (`core`) covers all authored pages under `docs/`.

## Nightly workflow

On each scheduled run the workflow:

1. Checks out the repo using the GitHub App token (CCE-45).
2. Runs the plugin's gap-detection step against the `core` lens.
3. Dispatches `page-author` agents for any pages flagged as stale or missing.
4. Uploads a forensics artifact on any step failure (CCE-41) — failures are inspectable without a re-run.
5. Transitions the linked Jira ticket when a PR number is attached to the run context (CCE-53).

## Post-merge runbook

These items are not automated and require a one-time human step:

- **Smoke test**: `gh workflow run docs-agent-nightly.yml` — verify the run reaches the gap-detection step without auth or config errors.
- **Branch protection**: if you want the nightly workflow to gate future PRs, add it as a required status check. Not required for the bootstrap to function.
- **Per-host decisions**: document any lens-specific authoring conventions (section structure, page-naming rules) in the plugin repo's per-host decisions file. No decisions are recorded yet for this host.

## Placement note

The `core` lens root (`docs/`) has no named subdirectory structure beyond `images/` and `superpowers/`. This page is placed as a flat dated slug at the lens root. If an `operations/` or `architecture/` section is added later, it's a candidate for migration there.
