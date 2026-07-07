---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Onboarding this repo onto engineering-docs-agent

PR #100 brought `claude-code-self-assessment` under the
engineering-docs-agent plugin's automated nightly documentation
maintenance. This page records what the bootstrap actually shipped and
why the config looks the way it does.

## What landed

Three files:

- `.engineering-docs-agent/config.yml` — the host config the
  orchestrator reads on every nightly run.
- `.engineering-docs-agent/state.json` (plus a `state.example.json`
  template) — the seeded run-state the orchestrator uses to know which
  commit it last processed.
- A nightly GitHub Actions workflow that checks out both this repo and
  the plugin repo, installs the `claude` CLI, and runs the
  orchestrator against `$GITHUB_WORKSPACE`.

The config declared a single `core` lens rooted at `docs/`. At bootstrap
time it set `docs.framework: none`, because this repo rendered plain
markdown straight through GitHub rather than through a static-site
generator — there was no build step to point the plugin at.

## Why `framework: none` in the first place

An earlier version of the branch worked around the plugin's
older config schema by adding a synthetic mkdocs scaffold — an
`mkdocs.yml` and `requirements-docs.txt` that existed only to satisfy
the plugin, not because the repo actually built or published a site.
That scaffold was removed once the plugin landed first-class support
for `docs.framework: none` (CCE-64): the host config could then say
plainly what the repo actually did, instead of pretending to be an
mkdocs site to satisfy a schema requirement.

## What the bootstrap did *not* include

At the time this page was first written, the `core` lens had no
`architecture/`, `operations/`, or `archive/` subsections — only an
`images/` directory alongside the lens root. This page therefore sits
as a flat dated slug at the lens root rather than nested under a
subsection. Future PRs that introduce real subsection structure under
the `core` lens should route new decision/reference pages there instead
of continuing to flatten everything at the root.

## Superseded by the mkdocs migration

This bootstrap's `framework: none` posture didn't last: the repo later
adopted mkdocs for real (see
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` and the
corresponding plan), and the current
`.engineering-docs-agent/config.yml` now declares `docs.framework:
mkdocs` with `lens_paths.core: docs/site-src/`, built by
`.github/workflows/docs-agent-pages.yml` and verified by
`.github/workflows/docs-build-check.yml` on every PR. The nightly
authoring workflow described above (`docs-agent-nightly.yml`) is
unchanged in shape — it still checks out the plugin, installs the
`claude` CLI, and runs `orchestrator_runner.py` — but the config it
reads has moved on from the `framework: none` shape this page
documents. Treat this page as a record of the original onboarding
decision, not as the current state of `config.yml`.
