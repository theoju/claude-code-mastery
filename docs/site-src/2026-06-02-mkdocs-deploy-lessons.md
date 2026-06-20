---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# MkDocs Deploy: Three Operational Lessons (2026-06-02)

**PR:** #122 (CCE-82 follow-up to CCE-81 / PR #121)  
**Date:** 2026-06-02  
**Scope:** Post-merge capture of incidents that deviated from the planned rollout in [`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md)

---

## Why this record exists

PR #121 squash-merged the MkDocs scaffold and Pages workflow for this site. Three things went wrong in ways the spec's Gate 5 didn't anticipate. This record captures them as durable operational lessons adjacent to the original plan, so future host repos onboarded with `framework: mkdocs` don't repeat the same failures.

---

## Lesson 1 — `configure-pages@v6 enablement: true` does not bootstrap GitHub Pages

### What happened

PR #121 merged at 06:26:27Z. The `docs-agent-pages.yml` workflow auto-fired on commit `6369065`. It failed at the `configure-pages@v6` step after ~3 seconds:

```
Get Pages site failed. Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
HttpError: Resource not accessible by integration
```

### Root cause

`enablement: true` is documented as a way to programmatically enable Pages on first run. It requires admin scope on the repository. The workflow's `GITHUB_TOKEN` — even with `pages: write` and `id-token: write` declared — does not carry that scope. The `permissions:` block can only *restrict* the default token's scopes; it cannot expand them. On first run against a repo where Pages has never been enabled, the action exits non-zero. On every subsequent run where Pages already exists, `enablement: true` is a silent no-op.

### Recovery (manual, ~2 minutes)

```bash
# Enable Pages from a personal admin gh login
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
# Returns: {"build_type":"workflow","html_url":"https://theoju.github.io/claude-code-self-assessment/", ...}

# Re-dispatch the deploy workflow
gh workflow run docs-agent-pages.yml \
  --repo theoju/claude-code-self-assessment --ref main

# Watch run 26802635123: build 16s, deploy 8s — both green
curl -sI https://theoju.github.io/claude-code-self-assessment/ | head -3
# HTTP/2 200
```

All six migrated pages returned HTTP 200. The Next.js `/methodology/` route correctly 404'd, confirming site scoping to `docs/site-src/`.

### Durable fix

For any new host repo onboarded with `framework: mkdocs`:

1. Before the first push-triggered deploy, run `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` from a personal admin login. The equivalent UI path is **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
2. `build_type=workflow` is durable — once set, all subsequent push-triggered runs of `docs-agent-pages.yml` work without intervention.
3. Delete the `enablement: true` line from `docs-agent-pages.yml`. It's misleading on first run (where it fails silently on token scope) and a no-op forever after. This was done in PR #125 / CCE-82.

The `configure-pages@v6 enablement: true` gotcha is now recorded in CLAUDE.md Conventions. The engineering-docs-agent plugin's `setup_scaffold` script should bake in the `gh api` call so this step is automatic for future hosts (filed as plugin tech-debt followup in PR #121's description).

---

## Lesson 2 — Monitor scripts must not use `status` or `pipestatus` as variable names under zsh

### What happened

Two separate monitor scripts used `status` as a loop-local variable name to track workflow run state. Both crashed immediately under the session's zsh shell with:

```
read-only variable: status
```

Both monitors exited non-zero with no event lines emitted. This initially appeared to mean the watched workflow had failed. Direct queries proved otherwise:

```bash
gh run view <run-id> --json status,conclusion,jobs
# Shows: "status":"completed","conclusion":"success"
```

The deploy had actually succeeded. The monitor failure was a script bug, not a system failure.

### Root cause

In zsh, `status` and `pipestatus` are read-only built-in parameters. `status` exposes the last command's exit code (analogous to `$?` in bash); `pipestatus` exposes the per-stage exit codes of the last pipeline. Assigning to either crashes the shell. Bash does not reserve these names, so scripts that work under bash fail under zsh.

The session environment notes `Shell: zsh`. Monitor scripts written without checking this produced false-negative incident signals.

### Fix

Two approaches, either works:

1. **Name loop locals away from the reserved set.** Use `run_status`, `pipe_state`, `poll_result` — anything not in zsh's read-only set.
2. **Shebang the script `#!/usr/bin/env bash`.** Run it explicitly under bash, where `status` and `pipestatus` are not reserved.

### Corollary

A monitor exiting non-zero with *no emitted event lines* is almost always a script bug, not a failure of the watched system. Confirm by direct query (`gh run view <ID> --json status,conclusion,jobs`) before treating monitor failure as evidence the underlying task failed.

---

## Lesson 3 — Post-merge outcomes section added to the upgrade plan

The plan at `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` received a **"Post-merge outcomes"** section (added by PR #122) recording all three deviations above with their run IDs, exact error text, recovery commands, and verification results. The spec at `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` received a correction block under Gate 5 with the same root-cause analysis.

Both files are in `docs/superpowers/` and are intentionally *not* published to the MkDocs site (per non-goal §7 of the spec). This dated decision record in `docs/site-src/` is the published-site surface for the same lessons.

---

## Summary of changes in PR #122

| File | Change |
| ---- | ------ |
| `CLAUDE.md` | Two new Conventions bullets: `configure-pages@v6 enablement: true` footgun; zsh `status`/`pipestatus` reserved-name crash |
| `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` | Correction block under Gate 5 with exact error, root cause, recovery, and `build_type=workflow` fix |
| `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` | "Post-merge outcomes" section with all three deviations |
| `docs/site-src/2026-06-02-mkdocs-deploy-lessons.md` | This file |

No code or test changes in PR #122. The site itself (scaffold, workflows, config) was already green after the manual Pages-enablement recovery.

---

## References

- Original scaffold PR: [#121](https://github.com/theoju/claude-code-self-assessment/pull/121) (CCE-81)
- Follow-up corrections PR: [#122](https://github.com/theoju/claude-code-self-assessment/pull/122) (CCE-82 follow-up)
- Spec with Gate 5 correction: [`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)
- Plan with post-merge outcomes: [`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md)
- Site live since: 2026-06-02T06:29:12Z — https://theoju.github.io/claude-code-self-assessment/
