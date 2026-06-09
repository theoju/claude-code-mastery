---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# Plan: MkDocs upgrade (CCE-81)

**Executed:** 2026-06-01 → 2026-06-02 (PR #121)
**Post-merge record:** 2026-06-02 (PR #122)

This page is the published companion to the decision record at
[`specs/2026-06-01-mkdocs-upgrade-design.md`](../specs/2026-06-01-mkdocs-upgrade-design.md).
It summarises what was planned, how it executed, and the three deviations
discovered during the first deploy. The internal step-by-step task list lives
in `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` (not published).

---

## What was planned

Upgrade this repo's engineering-docs-agent integration from `framework: none`
to `framework: mkdocs`, scaffold a Material-theme site at
`https://theoju.github.io/claude-code-self-assessment/`, add a GitHub Pages
publish workflow, and migrate existing docs verbatim with no broken path
references anywhere in the source tree.

The plan ran 20 tasks across five phases:

| Phase | Scope |
| ----- | ----- |
| 1 — Test infrastructure | Three Vitest files (path-migration scan, scaffold existence, config-flip contract) — TDD red |
| 2 — Scaffold creation | `mkdocs.yml`, `requirements-docs.txt`, `docs/site-src/{index,SUMMARY,whats-new}.md`, `docs-agent-pages.yml` — TDD green |
| 3 — File moves & path updates | `git mv` of 5 doc paths; 8 files updated for stale `docs/` refs |
| 4 — Config flip & ignores | `.engineering-docs-agent/config.yml` flipped to mkdocs contract; `site/` added to `.gitignore` |
| 5 — End-to-end verification | Local `mkdocs build --strict`, dev-server smoke, full test suite + lint |

All 20 tasks completed. The plan also produced a PR-level `docs-build-check.yml`
workflow (Task 15c) that runs `mkdocs build --strict` on every PR touching docs
paths — no deploy, ~45s per run, catches broken links before they land on `main`.

---

## Post-merge outcomes (2026-06-02)

PR #121 squash-merged at 06:26:27Z. Three deviations from the planned rollout
occurred during the first deploy. Each is recorded below as a durable lesson.

### 1. `configure-pages@v6 enablement: true` does not bootstrap Pages on first deploy

**What happened:** the Pages workflow auto-fired on the merge commit and failed
immediately at the `configure-pages@v6` step:

```
Create Pages site failed. Error: Resource not accessible by integration
```

**Why:** the workflow's `GITHUB_TOKEN` lacks the admin scope required for
`POST /repos/.../pages`. The `permissions:` block in a workflow YAML can only
*restrict* the default token's scopes — it cannot expand them. `enablement: true`
is a silent no-op both on first run (when the token lacks admin) and on every
subsequent run (once Pages exists from another path).

**Recovery (one-time, ~2 min):**

```bash
# Enable Pages from a personal admin gh login
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow

# Re-dispatch the workflow
gh workflow run docs-agent-pages.yml --repo <owner>/<repo> --ref main
```

The `gh api` call is equivalent to Settings → Pages → Build and deployment →
Source → "GitHub Actions". Either path works.

**Permanent fix:** the `enablement: true` line was removed from
`docs-agent-pages.yml` in [PR #125 / CCE-82](https://github.com/theoju/claude-code-self-assessment/pull/125).
For future host repos: run the `gh api` call **before** the first push to
`main`, not after. The [onboarding checklist](#future-host-onboarding-checklist)
below codifies this as a required step.

**Side note — `build_type=workflow` disables branch-deploy publishing.** Once
you set this (via `gh api` or the UI), GitHub stops serving static files from
pushed branches. The only path that updates the live site is the Pages deploy
action uploading a build artifact. That is the correct behaviour for an mkdocs
site, but it surprises engineers who expect GitHub's default static-file serving
to be a fallback.

### 2. Monitor scripts must not use zsh's read-only built-ins

Two separate polling scripts monitoring the deploy run used `status` as a
loop-local variable. In zsh, `status` and `pipestatus` are read-only built-in
parameters — assigning to either crashes the shell immediately:

```
read-only variable: status
```

Both monitors exited non-zero with no event lines emitted. This looked like a
deploy failure, but a direct `gh run view <ID> --json status,conclusion,jobs`
query showed the actual deploy had already succeeded.

**Rule:** a monitor that exits non-zero with no emitted event lines is almost
always a script bug, not a failure of the watched system. Confirm real system
state with a direct query before treating monitor exit as evidence the
underlying task failed.

**Fix:** rename loop locals away from the reserved set — `run_status`,
`pipe_state`, etc. — or shebang the script `#!/usr/bin/env bash`, where those
names are not reserved.

### 3. Jira ticket filed post-execution, not pre-execution

The plan opened with `CCE-XX` as a literal placeholder per the executor note.
An investigation workflow searched the CCE backlog after PR creation; no existing
ticket matched the scope. Filed **CCE-81** ("feat(docs): upgrade
claude-code-self-assessment docs site to mkdocs + GitHub Pages") with full
description linking PR #121, the spec, and the plan. PR #121 title and body
were updated to reference CCE-81 before merge.

---

## Final state

| Item | Detail |
| ---- | ------ |
| PR #121 | MERGED at 2026-06-02T06:26:27Z, mergeCommit `6369065` |
| Ticket | CCE-81 |
| Site | Live at https://theoju.github.io/claude-code-self-assessment/ as of 2026-06-02T06:29:12Z |
| Cleanup (PR #125) | `enablement: true` removed from `docs-agent-pages.yml` |

---

## Future host onboarding checklist

For each new host repo using `framework: mkdocs`, run these steps in order:

1. Scaffold `mkdocs.yml`, `requirements-docs.txt`, and `docs/site-src/` — use the
   engineering-docs-agent dogfood repo as a reference.
2. Add `.github/workflows/docs-agent-pages.yml` — **without** `enablement: true`.
3. **Before merging to `main`**, enable Pages from a personal admin login:
   ```bash
   gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
   ```
4. Merge to `main`. The Pages workflow fires automatically on the paths filter.
5. Flip `.engineering-docs-agent/config.yml` fields **after** Gate 6 (site live,
   HTTP 200 on the base URL). The publish-verifier checks the URL on the next
   nightly; flipping before the site is live produces `verify_skipped`.

Baking step 3 into the plugin's `setup_scaffold` script is filed as plugin-side
tech-debt (see the design spec §Future work).

---

## References

- Decision record / architecture: [`specs/2026-06-01-mkdocs-upgrade-design.md`](../specs/2026-06-01-mkdocs-upgrade-design.md)
- Scaffold + deploy PR: [PR #121 / CCE-81](https://github.com/theoju/claude-code-self-assessment/pull/121)
- Post-implementation corrections PR: [PR #122](https://github.com/theoju/claude-code-self-assessment/pull/122)
- `enablement: true` cleanup: [PR #125 / CCE-82](https://github.com/theoju/claude-code-self-assessment/pull/125)
- Internal step-by-step task list: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
