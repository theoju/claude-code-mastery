---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-Docs-Agent Bootstrap

PR #100 onboards `claude-code-self-assessment` onto the engineering-docs-agent plugin. After merge, the repo gets automated documentation maintenance: a nightly GitHub Actions workflow runs the full agent pipeline (source-collector → pr-summarizer → page-author → content-validator → gap-detector → notifier) and opens PRs when docs drift from code.

## What was added

**`.engineering-docs-agent/config.yml`** — the host config file that tells the plugin how this repo is shaped:

```yaml
framework: none
```

`framework: none` is a first-class config value introduced in CCE-64. It signals that the repo uses plain GitHub-rendered markdown rather than an SSG build (no `mkdocs.yml`, no `docusaurus.config.js`). The Tier-1 agents still run in full; the plugin just skips the SSG-specific build steps and path resolution it would otherwise do for Hugo, MkDocs, or Docusaurus hosts.

A synthetic MkDocs scaffold was drafted during this PR and then removed once CCE-64 landed `framework: none` — no need to fake an SSG shape to get the pipeline running.

**Agent state file** — seeded at the path the plugin expects so the first nightly run has a valid baseline to diff against rather than treating every page as new.

**`.github/workflows/docs-agent-nightly.yml`** — the nightly workflow. It incorporates fixes from four earlier pipeline issues:

| Fix | What it resolves |
| --- | --- |
| CCE-45 | App-token wiring (the workflow token the plugin uses to open PRs) |
| CCE-49 | OAuth validation (prevents silent auth failures mid-run) |
| CCE-41 | Forensics upload (attaches pipeline logs as workflow artifacts on failure) |
| CCE-53 | Jira wiring (the notifier can now transition CCE tickets on doc-change PRs) |

## Post-merge steps

Three manual steps remain after the PR lands:

1. **Branch protection** — configure the `docs-agent/` prefix in branch protection rules so the nightly workflow's PRs can merge cleanly without triggering review requirements intended for feature branches. This is a manual repo-settings step; the workflow cannot self-configure it.

2. **Smoke test** — trigger a one-off run to confirm the pipeline end-to-end:

   ```bash
   gh workflow run docs-agent-nightly.yml
   gh run list --workflow=docs-agent-nightly.yml --limit 1
   ```

   Watch for a green run and a resulting PR (or a "no changes detected" exit) before trusting the nightly schedule.

3. **Per-host runbook** — a runbook for this specific host is planned at `docs/host-onboarding/claude-code-self-assessment.md` in the plugin repo. It will document the token scopes needed, expected PR cadence, and how to handle a stuck agent state file. That page does not exist yet; track it as a follow-up once the smoke test confirms the pipeline is healthy.

## What `framework: none` means in practice

The engineering-docs-agent pipeline has two phases for every host:

- **Collect**: walk the repo for source files and recent PRs, build the change graph.
- **Author**: for each affected doc target, dispatch page-author with the right lens, voice samples, and frontmatter contract.

With `framework: none`, the collect phase uses the raw filesystem walk instead of an SSG-aware index. Markdown files are discovered directly under `docs/`. There is no build step, no nav config to parse, and no output directory to map back to source. Pages live exactly where they appear in the repo.

The authoring phase is identical regardless of framework. The same Tier-1 agents run; the same PR format comes out the other end.

## Relationship to CCE tickets

- **CCE-64** introduced `framework: none` as a valid config value in the plugin. This PR is the first host to use it.
- **CCE-57** covers the broader engineering-docs-agent rollout plan. This repo's onboarding is one item in that plan.
- The four workflow fixes (CCE-45, CCE-49, CCE-41, CCE-53) shipped in the plugin repo before this PR; the nightly workflow here simply picks up the corrected action versions.
