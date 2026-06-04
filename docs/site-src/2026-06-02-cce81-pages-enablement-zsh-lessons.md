---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
---

# CCE-81 lessons: Pages enablement and zsh monitor traps

PR #121 (mkdocs upgrade) surfaced two non-obvious failure modes during the v0.9.20
host-onboarding incident. Both are likely to recur in future host onboardings or in
any monitoring script written in zsh. This page records them as durable conventions.

## `actions/configure-pages@v6 enablement: true` does not bootstrap Pages

Despite the field name and the action's documentation, `enablement: true` does **not**
create the GitHub Pages resource on a repository's first deploy. The workflow's
`GITHUB_TOKEN` lacks the admin scope required to call `POST /repos/.../pages`, so the
very first CI run fails with `Resource not accessible by integration` even when
`permissions: pages: write` is declared.

`permissions:` can only _restrict_ a token's default scopes — it cannot expand them.
Once Pages exists via any path, `enablement: true` becomes a permanent silent no-op.

**Fix for host onboarding.** Before the first deploy, run this from a personal or admin
`gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source = "GitHub
Actions"**.

`build_type=workflow` is durable. Once set, all subsequent push-triggered runs of
`docs-agent-pages.yml` work without any manual step. The `enablement: true` line was
deleted from the workflow in PR #125 / CCE-82 (2026-06-02) — it was meaningless after
the initial bootstrap and actively misleading during onboarding.

**Side effect worth knowing:** `build_type=workflow` disables branch-deploy publishing.
The only path to `<owner>.github.io/<repo>/` is via `deploy-pages@v5`'s artifact
upload. That is the correct shape for an mkdocs build, but it means static files pushed
directly to `main` will not appear on the published site.

For future host repos onboarded via the engineering-docs-agent's `setup_scaffold`
script, the `gh api` call should be baked into that script before the first workflow
run. See the PR #121 description for the open followup ticket.

## Monitor scripts must use bash, not zsh

`status` and `pipestatus` are read-only built-in parameters in zsh — they expose the
last command's exit code and the per-stage exit codes of the last pipeline. Assigning
to either inside a poll loop crashes the shell immediately:

```
read-only variable: status
```

The monitor exits non-zero with **zero event lines emitted**, which masks successful
deploys entirely. Both deploy monitors written during the PR #121 cycle hit this. The
symptom looked like a deployment failure; the deploy had already succeeded.

**Two ways to avoid this:**

1. Name loop-local variables away from the reserved set. Use `run_status` or
   `deploy_result` instead of `status`; use `pipe_state` instead of `pipestatus`.
2. Shebang the script `#!/usr/bin/env bash` and run under bash, where these names are
   not reserved.

The session environment lists `Shell: zsh` — weight that whenever you write a monitor
or poll loop.

**Corollary:** a monitor that exits non-zero with zero emitted event lines is almost
always a script bug, not a failure of the watched system. Confirm with a direct query
before treating monitor failure as evidence that the underlying task failed:

```bash
gh run view <ID> --json status,conclusion,jobs
```

## Recovery steps (v0.9.20 incident)

The full recovery sequence for the PR #121 onboarding incident is captured in the
post-implementation correction section of the mkdocs upgrade design spec:

- [`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`](../superpowers/specs/2026-06-01-mkdocs-upgrade-design.md)

Short form:

1. Run `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` from an
   admin login.
2. Re-trigger the failed workflow run: `gh run rerun <ID>`.
3. Verify success: `gh run view <ID> --json status,conclusion`.
4. Confirm the published URL resolves.
