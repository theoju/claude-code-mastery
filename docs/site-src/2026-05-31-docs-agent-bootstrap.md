---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Decision: Engineering-Docs-Agent Bootstrap

**Date:** 2026-05-31  
**PR:** [#100](https://github.com/theoju/claude-code-self-assessment/pull/100)  
**Status:** Superseded in part — `framework: none` was upgraded to `framework: mkdocs` in the v0.9.20 cycle (CCE-81 / PR #121). This record captures the initial bootstrap rationale and the capability-degradation contract that held while the plain-markdown config was active.

---

## What shipped

PR #100 onboarded this repository onto the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin.
Four files were added or seeded:

| File | Purpose |
| ---- | ------- |
| `.engineering-docs-agent/config.yml` | Host config — single `core` lens at `docs/`, `framework: none` |
| `.engineering-docs-agent/state.json` | Seeded initial pipeline state for the nightly runner |
| `.engineering-docs-agent/state.example.json` | Template for repo forks |
| `.github/workflows/docs-agent-nightly.yml` | Nightly workflow with CCE-45 / CCE-49 / CCE-41 / CCE-53 fixes wired in |

A previously included synthetic mkdocs scaffold was removed before the PR merged.
CCE-64 had just landed `framework: none` as a first-class plugin config value,
making the scaffold unnecessary.

## Why `framework: none`

The repo's docs at bootstrap were plain markdown rendered by GitHub's default
blob viewer at `/blob/main/docs/` — no static-site generator, no `mkdocs.yml`,
no Pages deployment. Committing a synthetic scaffold solely to satisfy a
`framework: mkdocs` config entry would have misrepresented the repo's actual
shape and forced a nightly `mkdocs build --strict` against files that were never
authored with mkdocs in mind.

`framework: none` lets the pipeline run every stage that doesn't require a live
published URL, with the two URL-dependent stages degrading gracefully (see the
table below). The upgrade path is explicit in the config comment that shipped
with the bootstrap:

> If you later scaffold mkdocs and add a deploy workflow, swap `framework` to
> `mkdocs` and fill in `base_url` + `build_workflow`.

That path was taken in the v0.9.20 cycle. See
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` for the full
upgrade spec and the post-implementation notes on the GitHub Pages first-deploy
gotcha (`actions/configure-pages@v6 enablement: true` does not bootstrap Pages
on first run — requires a manual `gh api` call or the Pages UI).

## Capability degradation under `framework: none`

Two pipeline stages are meaningless without a deployed site and skip rather
than fail. All other stages run normally and produce authored content.

| Stage | Behavior under `framework: none` | `partial_reasons` token |
| ----- | --------------------------------- | ----------------------- |
| **Build lint** | Skipped — no `mkdocs build --strict` to run | `build_lint_skipped` |
| **Publish verifier** | Skipped — `base_url: null` means no URL to check | `verify_skipped` |
| PR scanning | Runs normally | — |
| Content authoring | Runs normally | — |
| `whats-new.md` update | Runs normally | — |
| Forensics artifact upload | Runs on failure | — |
| Jira wiring | Runs normally when branch key detected | — |

The pipeline exits with `partial: true` (not a failure) when either skip token
is present. The run still opens a `docs-agent/YYYY-MM-DD` PR with authored
content; reviewers can merge it without waiting on build or verification signals.

## Nightly workflow: CCE fixes bundled at bootstrap

Rather than applying fixes as follow-on patches after the pipeline first ran,
PR #100 bundled four upstream CCE fixes into the initial workflow. This reduced
the number of "fix the nightly" cycles needed before the pipeline was stable.

| Fix | CCE | What it does |
| --- | --- | ------------ |
| App-token wiring | CCE-45 | Uses a GitHub App installation token (not bare `GITHUB_TOKEN`) to open PRs, so the docs-agent PR triggers downstream CI checks |
| OAuth validation | CCE-49 | Validates that the token has required scopes before the pipeline starts; exits with a clear error if misconfigured rather than failing mid-run |
| Forensics upload | CCE-41 | Uploads the pipeline run log as a workflow artifact on failure for post-mortem debugging |
| Jira wiring | CCE-53 | Threads Jira ticket keys extracted from PR branch names into authored content metadata |

Each fix addresses a class of silent failure that was discovered across earlier
host-repo onboardings. Bundling them at bootstrap means this repo never hit
those failure modes.
