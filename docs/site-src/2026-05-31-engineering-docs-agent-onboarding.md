---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Engineering-Docs-Agent Onboarding (CCE-57)

PR #100 onboards this repository onto the engineering-docs-agent plugin. The
agent now runs nightly, generates lens pages automatically, and keeps
`docs/site-src/` in sync with merged PRs — no manual documentation passes
required.

## What landed

Three files were added to wire the plugin:

| File | Purpose |
| --- | --- |
| `.engineering-docs-agent/config.yml` | Plugin config declaring `framework: none` |
| `.engineering-docs-agent/state.json` | Per-repo run state (tracks last processed PR) |
| `.engineering-docs-agent/state.example.json` | Committed template for fresh clones |
| `.github/workflows/docs-agent-nightly.yml` | Nightly CI workflow |

A synthetic mkdocs scaffold that briefly existed to satisfy the plugin's old
framework enum was **removed**. CCE-64 landed just before this PR and added
`framework: none` as a first-class config value, making the scaffold
unnecessary. No static-site-generator is installed or invoked.

## Why `framework: none`

Before CCE-64, the plugin's `framework` field only accepted known SSG names.
Hosts without a published docs site either had to install a dummy SSG or were
blocked from onboarding. CCE-64 eliminated that constraint: `framework: none`
is now a valid value, and two pipeline stages skip cleanly when it is set:

- **`framework_build` lint** — skipped (nothing to build)
- **`publish-verifier`** — skipped (`publishing.base_url` is null)

All Tier-1 stages run normally: `source-collector`, `pr-summarizer`,
`page-author`, `content-validator`, `gap-detector`, and `notifier`.

## Nightly workflow

`.github/workflows/docs-agent-nightly.yml` incorporates bug-fix wiring
accumulated across four prior CCEs:

| CCE | Fix |
| --- | --- |
| CCE-45 | App-token wiring |
| CCE-49 | OAuth validation |
| CCE-41 | Forensics upload |
| CCE-53 | Jira wiring |

The workflow runs on a schedule and can also be triggered manually:

```bash
gh workflow run docs-agent-nightly.yml
```

Use the manual trigger for your first smoke-test after the branch protection
rules are in place.

## Post-merge checklist

These steps were noted in the PR as out-of-band tasks:

1. **Branch protection** — configure branch protection rules on `main` if not
   already done; the nightly workflow pushes generated content via a PR, which
   requires merge permissions.
2. **Smoke-test** — run `gh workflow run docs-agent-nightly.yml` and confirm
   the run completes without error. Check the Actions tab for the
   `forensics-upload` artifact if any stage fails.
3. **Per-host runbook** — a runbook for this repo's specific configuration
   belongs in the plugin repo. File it there so future operators have a
   single place to look when the nightly fails.

## Decision rationale

The core decision in this PR is accepting `framework: none` as the accurate
description of this repo's docs shape rather than installing infrastructure
(mkdocs, Jekyll, etc.) that wouldn't actually be used. The plain-markdown
rendering via GitHub is sufficient for the audience, and adding a build step
solely to satisfy an enum would have introduced a maintenance surface with no
user benefit. CCE-64 made this the canonical path for repos in that position.
