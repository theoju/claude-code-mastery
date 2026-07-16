---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Engineering-docs-agent bootstrap (2026-05-31)

PR [#100](https://github.com/theoju/claude-code-self-assessment/pull/100) (CCE-57) onboarded the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin onto this
repo, giving it the same automated, PR-driven documentation pipeline the plugin's own
dogfood repo runs.

## What landed

- **`.engineering-docs-agent/config.yml`** — the host configuration. One lens, `core`,
  rooted at `docs/`. At the time of this PR the docs site was plain markdown rendered
  directly by GitHub, so the config declared `framework: none` — there was no
  static-site generator to build or lint.
- **`state.json` / `state.example.json`** — the orchestrator's run-state file
  (`last_successful_run.head_sha` + `pr_number`, plus a `dismissed_gap_flags` map). Seeded
  so the first nightly run has a known starting SHA to diff against.
- **`.github/workflows/docs-agent-nightly.yml`** — the scheduled pipeline. It checks out
  both this repo and the plugin repo (`theoju/engineering-docs-agent`, vendored into
  `.docs-agent-plugin` at runner time), then runs the plugin's
  `orchestrator_runner.py`, which chains source-collector → pr-summarizer → page-author →
  content-validator → gap-detector → notifier.

## Why `framework: none`

The plugin's config schema originally required `framework` to be one of a fixed enum of
supported static-site generators. This repo's actual docs shape — plain markdown files
rendered by GitHub with no build step — didn't fit any of them. An earlier draft of the
branch worked around the mismatch by inventing a synthetic mkdocs scaffold
(`mkdocs.yml`, `requirements-docs.txt`) purely to satisfy the enum, even though nothing
in the repo actually built or served it.

That workaround was removed once CCE-64 added `framework: none` as a first-class,
schema-supported option upstream in the plugin. With `framework: none` available, the
config could honestly describe the repo's real setup instead of pretending to run a
generator it didn't have, and the synthetic scaffold was deleted before merge.

## Follow-ups noted but not yet done

The PR description flagged three post-merge items that this decision record does not
mark as complete, because they either aren't documentation changes in this repo or
weren't finished at merge time:

- Branch protection setup for the `docs-agent/*` branches the nightly workflow pushes to.
- Smoke-testing an actual nightly run end-to-end.
- A host-onboarding runbook — tracked as a follow-up in the plugin repo itself, not here.

## Note for later readers

The `framework: none` choice reflected the repo's docs shape as of this PR. The site
later migrated to an mkdocs-Material build (see the mkdocs upgrade design spec under
`docs/superpowers/specs/`), and `.engineering-docs-agent/config.yml`'s `framework` field
was updated accordingly at that point. This page documents the bootstrap decision as it
was made on 2026-05-31, not the config's current value.
