---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
---

# GitHub Pages first-deploy and zsh monitor lessons (2026-06-02)

PR #121 (CCE-81) shipped the mkdocs upgrade and triggered the live docs deploy.
Three edge-case failures surfaced only during the actual GitHub Pages bootstrap —
not during spec or plan review. PR #122 records them as durable operational lessons.

## 1. `configure-pages@v6 enablement: true` does not bootstrap Pages

The `actions/configure-pages@v6` action has an `enablement: true` field that
looks like it will create the Pages site for you on first deploy. It does not.
The workflow `GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages`, so the very first run fails with:

```
Resource not accessible by integration
```

This happens even with `permissions: pages: write` declared in the workflow.
The `permissions:` block can only _restrict_ the token's default scopes — it
cannot expand them beyond what a `GITHUB_TOKEN` can hold.

**Fix:** Before the first deploy, run this once from a personal or admin `gh`
login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source =
"GitHub Actions"**.

Once Pages exists by any path, `enablement: true` becomes a silent no-op on
every subsequent run. The `build_type=workflow` flag is durable — it keeps the
source set to GitHub Actions, so push-triggered runs of `docs-agent-pages.yml`
work cleanly without trying to publish branch files directly.

The `enablement: true` line was removed from the workflow in PR #125 / CCE-82
since it provides no value after the one-time bootstrap. If you are onboarding a
new host repo with `framework: mkdocs`, run the `gh api` call before the first
push — the workflow alone cannot do it for you.

## 2. Zsh built-in collision: avoid `status` and `pipestatus` as loop locals

In zsh, `status` and `pipestatus` are **read-only built-in parameters** — they
expose the last command's exit code and per-stage exit codes of the last
pipeline, respectively. Assigning to either inside a poll loop crashes the shell
immediately:

```
read-only variable: status
```

The monitor exits non-zero with no event lines emitted, silently masking
successful deploys. Both monitors written during the PR #121 cycle hit this
before the root cause was identified.

**Fix:** Either rename loop locals away from the reserved set (`run_status`,
`pipe_state`) or shebang the script with `#!/usr/bin/env bash`, where these
names are not reserved:

```bash
#!/usr/bin/env bash
# 'status' and 'pipestatus' are safe to assign here
```

The session environment reminder lists `Shell: zsh` — weight that when writing
monitor scripts or any shell utility that uses common single-word variable names.

## 3. A monitor exiting non-zero with no output is almost always a script bug

When a monitor exits non-zero and emits zero event lines, the failure is almost
certainly in the monitor itself, not in the system it watches.

Confirm the underlying task's real state directly before treating the monitor's
exit as evidence of failure:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs
```

The deployment could have succeeded cleanly while the monitor crashed on line 3.
The PR #121 cycle's monitors did exactly this — deploy was clean, monitor was
broken.

**Pattern:** if a monitoring script exits non-zero with no output, run the real
query first. Only debug the monitored system after confirming it actually failed.

## Context

These lessons came from the live deploy of the mkdocs upgrade (PR #121 / CCE-81).
The original spec and plan captured the implementation path correctly; these are
three failure modes that only appear at first-deploy time and under zsh's
variable-name restrictions. All three are now recorded in `CLAUDE.md`
Conventions and in the spec's Gate 5 block so future developers encounter the
fix before the footgun.

The engineering-docs-agent plugin scaffold followup — baking the `gh api`
bootstrap call into `setup_scaffold` so new host repos don't hit lesson 1 — is
deferred to the plugin repo as a post-implementation tech-debt item.
