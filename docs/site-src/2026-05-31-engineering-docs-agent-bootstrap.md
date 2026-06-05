---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering docs-agent bootstrap

This repo is enrolled as a host for the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent)
plugin. That means documentation pages are generated and updated nightly —
automatically from merged PRs — rather than written by hand alongside code
changes.

## What was added (PR #100)

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Host config: `framework: none`, single `core` lens pointed at `docs/` |
| `.engineering-docs-agent/state.json` | Seeded state file tracking the last-processed PR cursor |
| `.engineering-docs-agent/state.example.json` | Template showing the expected shape for new hosts |
| `.github/workflows/docs-agent-nightly.yml` | Nightly Actions workflow that runs the full agent pipeline |

The config uses `framework: none` — a first-class plugin value added in
CCE-64 — so no SSG toolchain is required. A synthetic mkdocs scaffold was
briefly included in an earlier draft of the PR but was removed once CCE-64
landed.

## The nightly pipeline

`docs-agent-nightly.yml` runs the agent stages in order:

```
source-collector → pr-summarizer → page-author → content-validator → gap-detector → notifier
```

Two stages are intentionally skipped:

- **`framework_build` lint** — there is no SSG build step when `framework: none`
- **`publish-verifier`** — no published site to verify against

Everything else runs on schedule. When the pipeline finds merged PRs that
affect `doc_targets`, it opens a documentation PR against this repo.

## What this enables

- **Automated page creation**: new feature work that ships with `doc_targets`
  in its PR summary gets a corresponding docs page authored and opened as a PR
  without manual effort.
- **What's-new entries**: the notifier stage appends entries to
  `docs/site-src/whats-new.md` for each batch of merged changes.
- **Gap detection**: the gap-detector stage surfaces dimensions or features
  that have no documentation coverage yet and files issues or PR comments
  flagging them.

## Post-merge setup

Three manual steps are needed after the bootstrap PR merges:

1. **Branch protection**: configure branch protection on `main` if not already
   set — the nightly workflow opens PRs that should go through review, not
   force-push to main directly.
2. **Smoke test**: run `gh workflow run docs-agent-nightly.yml` to confirm the
   pipeline reaches the notifier stage without error.
3. **Per-host runbook**: a runbook covering rotation of the agent token and
   re-seeding `state.json` after a gap in runs is tracked in the plugin repo.
   See the engineering-docs-agent CLAUDE.md for the current state.

## Related tickets

CCE-41 / CCE-45 / CCE-49 / CCE-53 / CCE-57 / CCE-64 — the ticket chain that
drove `framework: none` support and the bootstrap design. CCE-64 is the
direct prerequisite: without it, enrolling a plain-markdown repo required
shipping a synthetic mkdocs scaffold that would have diverged from the repo's
actual shape immediately.
