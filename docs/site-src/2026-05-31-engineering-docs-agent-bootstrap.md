---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Bootstrapping onto engineering-docs-agent

This repo onboarded onto the engineering-docs-agent plugin in PR #100,
closing out a chain of prep tickets (CCE-41, CCE-45, CCE-49, CCE-53, CCE-57).
The decision worth recording here isn't the onboarding itself — it's *how*
the repo declared its docs shape to the plugin, because the first attempt at
that declaration was a workaround, and the shipped version isn't.

## The problem: no framework to declare

The engineering-docs-agent plugin's config schema originally required
`docs.framework` to be one of `mkdocs` or `docusaurus` — there was no way to
say "this repo just has markdown files that GitHub renders directly." At the
time this repo onboarded, that's exactly what it had: no static-site
generator, no build step, just `docs/` as plain markdown.

An earlier version of the PR #100 branch worked around this by committing a
synthetic `mkdocs.yml` scaffold — a config file that existed solely to
satisfy the plugin's enum, not because the repo actually built or published
docs with mkdocs. That's the kind of thing that looks fine in a diff and
rots quietly: a build tool config nobody runs, sitting in the repo root,
implying a pipeline that doesn't exist.

## The fix: `framework: none` as a first-class value

CCE-64 added `framework: none` to the plugin's config schema before PR #100
merged, so the branch dropped the synthetic scaffold and shipped a config
that says what was actually true:

```yaml
docs:
  framework: none
  source_dir: docs
```

with a single `core` lens rooted at `docs/`, and publishing fields left
null — there was nothing to build or verify a deployed URL against. The
rest of the onboarding landed alongside it:

- `.engineering-docs-agent/state.json` (plus a `state.example.json`
  template) — the orchestrator's run-tracking file, recording
  `last_successful_run.head_sha` and any `dismissed_gap_flags` between runs.
- `.github/workflows/docs-agent-nightly.yml` — a scheduled workflow that
  checks out both this repo and the `theoju/engineering-docs-agent` plugin
  repo (vendored into the runner at `.docs-agent-plugin`), then runs
  `orchestrator_runner.py --repo-root "$GITHUB_WORKSPACE"` on a nightly
  cron.

## What changed since

The `framework: none` config didn't stay accurate for long. This repo later
migrated its docs to an actual mkdocs-Material site published to GitHub
Pages (the 2026-06-01 mkdocs upgrade, CCE-82 / PR #125), and
`.engineering-docs-agent/config.yml` now declares `framework: mkdocs` with
`source_dir: docs`, a `build_workflow: docs-agent-pages.yml`, and a real
`base_url` for the publish-verifier to check. The `docs-agent-nightly.yml`
workflow from PR #100 is still the one that runs the agent — its
"Install runtime dependencies" step still documents the `framework=none`
history in a comment, noting that no mkdocs/docusaurus toolchain was needed
at the time and that the `framework_build` lint rule skips cleanly for
`framework=none` hosts.

The lesson that outlasted the specific config value: don't let a plugin's
enum force a repo to carry infrastructure it doesn't have. If the true
answer is "nothing here," the config should be able to say that directly —
and once it can, prefer the accurate declaration over a scaffold built to
satisfy a stricter schema.
