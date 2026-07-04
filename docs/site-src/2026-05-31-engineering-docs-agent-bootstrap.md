---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Decision: bootstrapping this repo onto engineering-docs-agent

PR #100 onboarded `claude-code-self-assessment` onto the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin — the automation that (among other things) writes this page. It added
three things: `.engineering-docs-agent/config.yml`, a `state.json` /
`state.example.json` pair, and `.github/workflows/docs-agent-nightly.yml`, the
scheduled workflow that runs the docs agent once a day.

## Why `framework: none` mattered

Before **CCE-64**, the plugin's config schema required `docs.framework` to be
one of a fixed enum (`mkdocs`, `docusaurus`, …) — there was no value for "this
repo just has plain markdown files and no static-site generator." Onboarding
this repo hit that constraint head-on: the branch originally shipped a
synthetic `mkdocs.yml` and `requirements-docs.txt` scaffold whose only job was
to satisfy the enum, not to build anything anyone would look at.

CCE-64 added `framework: none` as a first-class config value, and PR #100
deleted the synthetic scaffold in the same cycle once that landed. The config
that shipped with the bootstrap declared the host honestly: plain-markdown
docs, no build step, `agent_editable_paths: ["docs/**"]`.

**This was superseded within days.** The repo went on to adopt a real mkdocs
site (see `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`), and
`.engineering-docs-agent/config.yml` now declares `framework: mkdocs` with a
`docs-agent-pages.yml` build workflow and a published `base_url`. The
`framework: none` era described here lasted exactly as long as it took to
stand up the real docs site — worth knowing if you're reading this file
expecting it to match the current config verbatim. The decision that mattered
long-term isn't "this repo uses no framework"; it's that **CCE-64 removed the
false choice** between "fake a static-site scaffold" and "fail config
validation" for any host that genuinely has none. Later host repos onboarded
with `framework: none` still benefit from that even though this repo itself
moved off it.

## What the nightly workflow actually does

`docs-agent-nightly.yml` runs on a `7 7 * * *` cron (07:07 UTC — intentionally
off the `:00` pileup) plus `workflow_dispatch` for manual fires. It is this
repo's *first* `.github/workflows/` file — everything else (Vitest,
Playwright) runs via `package.json` scripts, not CI, so this workflow is
scoped narrowly to the docs agent and nothing else.

Notable shape, grounded in the workflow file itself:

- It checks out **two repos**: this one, and `theoju/engineering-docs-agent`
  (pinned to `main`) into `.docs-agent-plugin/`, because the plugin's
  orchestrator script isn't vendored into the host — it's fetched fresh on
  every run.
- Auth is a GitHub App installation token (`actions/create-github-app-token`),
  not the default `GITHUB_TOKEN` — needed for the commit-and-open-PR flow the
  orchestrator performs.
- Before running anything, it asserts `CLAUDE_CODE_OAUTH_TOKEN` is present,
  starts with `sk-ant-oat` (not `sk-ant-api`, the console API-key prefix), and
  is at least 32 characters — a fail-fast check against the two most common
  misconfigurations (wrong secret, truncated paste).
- The Python install step comment calls out explicitly that this is a
  `framework=none` host as of the bootstrap: only `pyyaml` + `jsonschema` are
  installed, no `mkdocs`/`docusaurus` toolchain. (As noted above, that
  specific comment is now stale post-mkdocs-upgrade, though the workflow
  still runs — the Python deps step just needs an mkdocs toolchain today.)
- `if: always()` steps upload subagent forensics as a build artifact
  (14-day retention) and append a run summary — including the post-run
  contents of `state.json` — to `$GITHUB_STEP_SUMMARY`, so a run's outcome is
  inspectable without pulling logs.

## What state.json tracks

`.engineering-docs-agent/state.json` is small and persistent across nightly
runs: `last_successful_run` (`head_sha` + `pr_number`) and
`dismissed_gap_flags`. The orchestrator uses `last_successful_run.head_sha` to
diff "what changed since the last authored PR" rather than re-scanning the
repo's full history each night. `state.example.json` ships as the committed
template (`head_sha: REPLACE_WITH_SEED_COMMIT_SHA`) for repos being onboarded
fresh; the real `state.json` is written by the orchestrator itself after each
successful run.
