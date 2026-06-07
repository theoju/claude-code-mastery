---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
---

# GitHub Pages Enablement and Monitor-Script Lessons (2026-06-02)

Two non-obvious pitfalls surfaced during the mkdocs upgrade deploy (PR #121 / CCE-81). PR #122 landed them as durable CLAUDE.md conventions and post-implementation notes in the spec and plan. Both apply to any future host repository onboarding.

## Lesson 1: `enablement: true` does not bootstrap GitHub Pages

`actions/configure-pages@v6` has an `enablement: true` field. Despite the name, it does **not** create the Pages endpoint on a repository that has never had Pages enabled.

The underlying issue is token scope. `GITHUB_TOKEN` in a workflow lacks the `admin` permission required to call `POST /repos/{owner}/{repo}/pages`. A `permissions: pages: write` declaration in the workflow only restricts the default token's scopes — it cannot expand them beyond what the token was issued. On the very first deploy against a fresh repository the action exits with:

```
Resource not accessible by integration
```

After Pages exists (via any path), `enablement: true` becomes a silent no-op forever. It never causes harm once the endpoint is live — it just does nothing useful on first run.

### Fix

Before running the workflow for the first time, bootstrap the Pages endpoint manually from an admin-scoped `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

`build_type=workflow` sets the source to "GitHub Actions" (not branch-deploy). That setting is durable: all subsequent push-triggered runs of the docs workflow work cleanly, and the `enablement: true` line becomes meaningless. The equivalent UI path is **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

`build_type=workflow` also disables branch-deploy publishing — the only path to `<owner>.github.io/<repo>/` is via `deploy-pages@v5`'s artifact upload. That is what mkdocs builds expect, but worth knowing if you wonder why static files pushed to `main` don't appear on the site.

The `enablement: true` line was removed from this repo's workflow in PR #125 / CCE-82 (2026-06-02); it was misleading dead weight.

**For future host onboarding:** the `gh api` call should be baked into the engineering-docs-agent's `setup_scaffold` script. Until it is, treat the bootstrap call as a required manual step on every new host repository.

## Lesson 2: Monitor scripts must not use zsh read-only built-ins

`status` and `pipestatus` are **read-only built-in parameters** in zsh. They expose the exit code and per-stage pipeline codes of the last command, respectively. Any assignment to either inside a shell script running under zsh crashes the shell immediately with:

```
read-only variable: status
```

The crash is silent from the caller's perspective: the monitor exits non-zero and emits no event lines. That looks identical to a failure of the watched system. During the PR #121 deploy cycle, two polling monitors hit this independently and masked successful GitHub Actions runs — the deploy had completed successfully while the monitors appeared to be reporting failure.

### How to avoid it

Two equivalent options:

1. **Rename loop-local variables away from the reserved set.** Use `run_status`, `pipe_state`, or any name that doesn't collide with `status` / `pipestatus`.
2. **Shebang the script `#!/usr/bin/env bash`.** Under bash, `status` and `pipestatus` are not reserved and can be assigned freely.

Either approach is correct. If you're writing a monitor for ad-hoc terminal use rather than a committed file, option 1 is the lighter fix. The session environment defaults to zsh in this repo — weight that when writing any inline poll loop.

### Diagnosing a monitor failure

A monitor that exits non-zero with **no emitted event lines** is almost always a script bug, not a failure of the watched system. Before treating monitor failure as evidence the underlying task failed, query the task's actual state directly:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs
```

If that returns a successful run, the monitor was the problem.

## What was updated in PR #122

| File | Change |
| ---- | ------ |
| `CLAUDE.md` | Two new Convention bullets: Pages bootstrap requirement; zsh read-only built-in conflict. |
| `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` | `POST-IMPLEMENTATION CORRECTION` block appended covering both pitfalls with recovery steps. |
| `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` | `Post-merge outcomes` section added summarising what the deploy produced and the two lessons discovered. |

No code was changed. The PR is purely documentation — preserving the lessons in CLAUDE.md (for future Claude sessions in this repo) and in the spec/plan (for future engineers onboarding a new mkdocs host).
