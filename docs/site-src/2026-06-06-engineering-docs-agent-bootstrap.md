---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-docs-agent bootstrap (PR #100)

PR #100 onboards this repository onto the
[engineering-docs-agent](https://github.com/theoju/engineering-docs-agent) plugin.
The plugin automates documentation gap-detection and nightly PR generation; this
change is what wires the two repositories together.

## What was added

**`.engineering-docs-agent/config.yml`** — the host configuration file that tells
the plugin how to treat this repo:

```yaml
framework: none
lenses:
  - name: core
    root: docs/
```

`framework: none` is a first-class value introduced by CCE-64. Before CCE-64 the
plugin required a valid SSG enum value (e.g. `mkdocs`), which forced hosts to
include a synthetic scaffold they didn't actually use. The earlier iteration of
this PR included a throwaway `mkdocs.yml` + `requirements-docs.txt` for exactly
that reason; once CCE-64 landed, both files were removed and the config could
accurately describe the repo's real shape: plain markdown, no site generator.

**`.engineering-docs-agent/state.example.json`** — a placeholder that documents the
shape of the plugin's state file. The real `state.json` is seeded at the branch
HEAD SHA on first run and is gitignored; the example gives contributors a
reference without exposing live state.

**`.github/workflows/docs-agent-nightly.yml`** — a GitHub Actions workflow that
runs the plugin nightly. The workflow pins to the version of the plugin that
includes the following fixes:

| Fix ticket | What it covers |
| ---------- | -------------- |
| CCE-45 | App-token wiring for the GitHub API calls |
| CCE-49 | OAuth validation guard before the plugin attempts any write |
| CCE-41 | Forensics artifact upload on failure |
| CCE-53 | Jira wiring for automatic ticket transitions |

## What the plugin does once wired

The nightly run walks the `core` lens (rooted at `docs/`) and compares the
existing pages against recent merged PRs. When it detects a documentation gap it
opens a PR with a draft page. It also updates `whats-new.md` from the PR log.

The single lens named `core` covers everything under `docs/` — there is no
separate `operations/` or `architecture/` section yet. New sections can be
added to `config.yml` as the docs grow.

## Post-merge steps (not yet reflected in docs)

The PR body called out three follow-up items that are still pending:

1. **Branch protection** — add a status check for `docs-build-check` on `main`
   so a bad docs link can't merge silently.
2. **Smoke-test the nightly workflow** — trigger a manual run of
   `.github/workflows/docs-agent-nightly.yml` to confirm the app-token and Jira
   wiring resolve correctly in this repo's Actions context.
3. **Plugin-repo runbook** — the engineering-docs-agent repo should document the
   `framework: none` onboarding path; the current runbook predates CCE-64.

These are tracked separately; this page will be updated when they close.
