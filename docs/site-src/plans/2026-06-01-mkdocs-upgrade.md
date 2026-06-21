---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# MkDocs Upgrade — Plan & Post-Merge Record

**Ticket:** CCE-81  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121) (scaffold) · [#122](https://github.com/theoju/claude-code-self-assessment/pull/122) (post-merge lessons) · [#125](https://github.com/theoju/claude-code-self-assessment/pull/125) (CCE-82 cleanup)  
**Merged:** 2026-06-02  
**Full spec:** `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`

---

## What this was

PR #121 upgraded the engineering-docs-agent integration from `framework: none` to
`framework: mkdocs`, scaffolding a Material-theme MkDocs site at
<https://theoju.github.io/claude-code-self-assessment/>. Before this PR the
`publish-verifier` stage of the nightly workflow skipped with `verify_skipped`
because there was nothing to verify against.

The plan shipped in three layers:

- **Test-first (TDD red phase):** three Vitest files asserting scaffold files
  exist, no stale path references remain in the source tree, and
  `.engineering-docs-agent/config.yml` matches the mkdocs contract.
- **Scaffold + file moves:** `mkdocs.yml`, `requirements-docs.txt`,
  `docs/site-src/index.md`, `docs/site-src/SUMMARY.md`,
  `docs/site-src/whats-new.md`, `.github/workflows/docs-agent-pages.yml`, and
  five `git mv` operations to relocate `docs/*.md` + `docs/images/` under
  `docs/site-src/`.
- **Config flip:** `.engineering-docs-agent/config.yml` fields flipped last,
  after the scaffold passed `mkdocs build --strict` locally.

**Tech stack:** MkDocs 1.6.1 + Material 9.5.49, `awesome-pages` +
`literate-nav` plugins, `pymdown-extensions` for mermaid and admonitions,
GitHub Pages deploy via `actions/upload-pages-artifact@v5` +
`actions/deploy-pages@v5`.

---

## Post-merge outcomes (2026-06-02)

The plan executed cleanly through all 20 tasks. Three deviations from the
designed rollout were recorded in PR #122 and landed as durable institutional
memory in `CLAUDE.md` Conventions.

### Deviation 1 — Pages enablement failed on first push-triggered deploy

The spec's Gate 5 assumed `actions/configure-pages@v6 enablement: true` would
programmatically enable GitHub Pages on the first deploy, given `pages: write`
+ `id-token: write` permissions in the workflow.

**What actually happened:** the merge commit (`6369065`) auto-triggered
`docs-agent-pages.yml`, which failed at the `configure-pages@v6` step after
~3 s:

```
Create Pages site failed. Error: Resource not accessible by integration
```

**Root cause:** `GITHUB_TOKEN` lacks the admin scope required for
`POST /repos/.../pages`. The `permissions:` block can only _restrict_ the
default token's scopes, never expand them. The `enablement: true` flag is a
misleading no-op before Pages exists and a silent no-op after it does.

**Recovery (~2 min):**

```bash
# Enable Pages from a personal admin gh login
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow

# Re-dispatch the deploy workflow
gh workflow run docs-agent-pages.yml \
  --repo theoju/claude-code-self-assessment --ref main
```

The dispatched run took 16 s (build) + 8 s (deploy). The site came live at
<https://theoju.github.io/claude-code-self-assessment/> within ~90 s. All six
migrated pages returned HTTP 200; the Next.js `/methodology/` route correctly
404d, confirming site scoping to `docs/site-src/`.

**Durable fix:** PR #125 / CCE-82 deleted `enablement: true` from the workflow
template and this repo's workflow. For future host repos onboarded with
`framework: mkdocs`, run the `gh api` call before the first push-triggered
deploy — or use Settings → Pages → Source = "GitHub Actions" in the UI.
`build_type=workflow` is durable: once set, all subsequent push-triggered runs
work cleanly.

### Deviation 2 — Jira ticket created post-execution

The plan and PR opened with `CCE-XX` as a literal placeholder per the
spec's Open Question §1. After PR creation, a backlog search confirmed no
existing ticket matched scope. Filed **CCE-81** with PR #121 linked, then
updated the PR title and body before merge.

### Deviation 3 — Monitor scripts crashed under zsh

Two separate monitor invocations used `status` as a loop-local variable name.
Under zsh (the session shell), `status` and `pipestatus` are read-only
built-in parameters exposing the last command's exit code and per-stage
pipeline exit codes. Assigning to either crashes the shell:

```
read-only variable: status
```

Both monitors exited non-zero with **no event lines emitted**, which initially
looked like the watched workflow had failed. Direct `gh run view <ID>` queries
showed the deploys had actually succeeded.

**Rule:** name loop locals away from the reserved set (`run_status`,
`pipe_state`) or shebang the script `#!/usr/bin/env bash`. A monitor exiting
non-zero with no event lines is almost always a script bug, not a failure of
the watched system — confirm by direct query before acting on it.

---

## Final state

| Item                      | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| PR #121 merged            | 2026-06-02T06:26:27Z, commit `6369065`                               |
| Site live since           | 2026-06-02T06:29:12Z                                                 |
| Site URL                  | <https://theoju.github.io/claude-code-self-assessment/>              |
| Ticket                    | CCE-81                                                               |
| Pages bootstrap fix       | CCE-82 / PR #125 — `enablement: true` removed from workflow template |
| Future host onboarding    | `gh api -X POST .../pages -f build_type=workflow` before first push  |

Subsequent docs-touching merges fire `docs-agent-pages.yml` automatically;
`build_type=workflow` is durable and requires no further manual intervention.
