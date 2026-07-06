---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Bootstrapping the engineering-docs-agent onto this repo

PR #100 onboarded the [engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin onto `claude-code-self-assessment`, so this repo gets the same
nightly-authored documentation pipeline (source-collector → pr-summarizer →
page-author → content-validator → gap-detector → notifier) as the plugin's
other host repos. This page is out of scope of that pipeline's own output —
it's a decision record of the bootstrap itself.

## What landed

- **`.engineering-docs-agent/config.yml`** — a single `core` lens rooted at
  `docs/site-src/`, `agent_editable_paths: ["docs/**"]`, and voice samples
  pulled from `README.md` and `CLAUDE.md`. At bootstrap time the config
  declared `framework: none` and left the `publishing` block's fields
  nulled out — this repo had no GitHub Pages workflow yet, so there was
  nothing for a publish-verifier to check.
- **`.engineering-docs-agent/state.json`** (+ `state.example.json` as the
  committed template) — tracks `last_successful_run.head_sha`,
  `last_successful_run.pr_number`, and `dismissed_gap_flags` across nightly
  runs. Worth flagging for anyone hand-editing these files later: the
  example seeds `dismissed_gap_flags` as an empty array (`[]`) while the
  real, orchestrator-written `state.json` uses an empty object (`{}`) —
  they're not byte-for-byte the same shape, so don't copy the example
  verbatim if you're resetting state by hand.
- **`.github/workflows/docs-agent-nightly.yml`** — this repo's first
  `.github/workflows/` file (everything else runs via `package.json`
  scripts, locally or elsewhere in CI). It fires daily at 07:07 UTC
  (off-minute, avoiding the `:00` cron pileup) plus `workflow_dispatch`,
  mints a GitHub App installation token via `create-github-app-token`,
  checks out the plugin repo itself into `.docs-agent-plugin` (the host
  repo is not the plugin — its `scripts/` have to be vendored into the
  runner workspace), and runs `orchestrator_runner.py` against
  `$GITHUB_WORKSPACE`. Because the host was `framework: none` at the time,
  the install step pulled only `pyyaml` + `jsonschema` — no mkdocs
  toolchain — and the workflow carries no build/publish step at all.
  Subagent forensics get uploaded as a per-run artifact (14-day retention)
  regardless of outcome, and a run summary block appends the post-run
  `state.json` to the job's `$GITHUB_STEP_SUMMARY`.

## Why `framework: none` instead of a fake mkdocs scaffold

An earlier revision of the bootstrap branch carried a synthetic
`mkdocs.yml` + `requirements-docs.txt` just to satisfy the plugin's config
schema, which at the time only accepted `framework: mkdocs` or
`framework: docusaurus`. That scaffold built nothing real — this repo
rendered plain markdown straight through GitHub, no static-site generator
in the loop. Once the plugin added `framework: none` as a first-class
config value (CCE-64), the synthetic scaffold was deleted and
`config.yml` was rewritten to describe what the repo actually does. The
`publishing` fields being nulled out follows directly from that: there
was no `build_workflow` to point at, so nothing was invented to fill the
slot.

## Since superseded

Note for anyone reading `.engineering-docs-agent/config.yml` today rather
than at bootstrap time: this repo later did adopt mkdocs (the
2026-06-01 mkdocs upgrade — see
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` and the
"Docs site (mkdocs)" section of this repo's `CLAUDE.md`), so the live
config now declares `framework: mkdocs` with a populated `publishing`
block pointing at `docs-agent-pages.yml`. The `framework: none` shape
described above was accurate at PR #100's merge but is no longer the
current state — treat this page as the record of the original decision,
not as current-state documentation.

## Out of scope here

The PR description also flagged follow-up work — branch protection
settings for the `docs-agent/*` branches the nightly job pushes to, a
smoke test for the nightly workflow itself, and a host-onboarding runbook
that belongs in the plugin repo rather than this one. None of that is
represented on this page; it tracks the bootstrap decision only.
