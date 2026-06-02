---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-Docs-Agent Bootstrap (PR #100)

This repo is now on the engineering-docs-agent pipeline. PR #100 wires up the three required pieces: a host config, a state file, and a nightly CI workflow. No mkdocs scaffold was needed — this repo ships plain markdown, and CCE-64 introduced `framework: none` to handle that cleanly.

## What was added

**`.engineering-docs-agent/config.yml`** — the per-host config the plugin reads on every run:

```yaml
framework: none
lenses:
  - name: core
    source_dirs:
      - docs/site-src
```

`framework: none` tells the pipeline to skip mkdocs build validation and publish verification while leaving all content stages intact.

**`state.json` / `state.example.json`** — tracks which PRs the pipeline has already processed. `state.json` is gitignored; `state.example.json` is committed as a template for first-run bootstrap.

**`.github/workflows/docs-agent-nightly.yml`** — runs the full pipeline on a cron schedule. The workflow incorporates fixes accumulated across several CCEs:

| Fix | What it addresses |
| --- | --- |
| CCE-45 | App-token wiring so the workflow can push commits back to the repo |
| CCE-49 | OAuth validation to prevent silent no-op runs |
| CCE-41 | Forensics artifact upload on failure |
| CCE-53 | Jira wiring for ticket transitions triggered by doc generation |

## What `framework: none` changes

With a real framework like `mkdocs`, the pipeline ends by running a build and verifying the published site. With `framework: none`, those two verification stages are skipped. Every upstream stage runs normally:

- **source-collector** — gathers merged PRs since last run
- **pr-summarizer** — produces structured change summaries per PR
- **page-author** — creates or edits lens pages to reflect those summaries
- **content-validator** — checks frontmatter, broken links, and schema compliance
- **gap-detector** — flags coverage gaps against the lens source directories
- **notifier** — posts a run summary (Slack or GitHub comment, per config)
- **What's New** — maintains the `whats-new.md` rolling changelog

The only difference is that the output stays as plain markdown rather than a deployed site. That matches the actual shape of `docs/site-src/`.

## Post-merge tasks

Three manual steps are needed before the first production run:

1. **Branch protection** — set up required status checks on `main` so the nightly workflow's commits don't bypass review gates.
2. **Smoke test** — trigger a manual run with `gh workflow run docs-agent-nightly.yml` and confirm it reaches the notifier stage without error.
3. **Host-onboarding runbook** — a runbook for adding new hosts lives in the plugin repo; this bootstrap follows that pattern and should be referenced there once the smoke test passes.

## Core lens shape

The `core` lens currently has only an `images/` subdirectory under `docs/site-src/`. There is no `operations/`, `architecture/`, or `archive/` hierarchy, so date-slug pages like this one land at the lens root. If the docs structure grows sub-sections, update `config.yml`'s `source_dirs` and add the matching directory before the next nightly run.
