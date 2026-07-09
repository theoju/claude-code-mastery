---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# Pages enablement and monitor-zsh lessons (CCE-81 follow-up)

Two operational lessons came out of the actual mkdocs Pages deploy for this
repo (CCE-81 / PR #121) that the original spec and plan didn't anticipate.
Both are now captured as durable Conventions in `CLAUDE.md` rather than left
buried in a planning doc, since they'll bite the next repo that takes the
same upgrade path.

## `configure-pages@v6 enablement: true` doesn't bootstrap Pages on a first deploy

The mkdocs upgrade plan's Gate 5 assumed `actions/configure-pages@v6` with
`enablement: true` would programmatically turn on GitHub Pages on the very
first run of `docs-agent-pages.yml` — no Settings-UI click required. That
assumption was wrong in practice.

The workflow's default `GITHUB_TOKEN` doesn't carry the admin scope needed
to call `POST /repos/.../pages`, and a `permissions:` block in a workflow
can only **restrict** the default token's scopes — it can never expand
them. So the first push-triggered run against the scaffold PR's merge
commit failed at the `configure-pages@v6` step with `Resource not
accessible by integration`.

The actual recovery, run once from a personal admin `gh` login:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
```

followed by dispatching the workflow directly:

```bash
gh workflow run docs-agent-pages.yml --ref main
```

That dispatched run succeeded (build 16s, deploy 8s), and the site came
live at https://theoju.github.io/claude-code-self-assessment/ within
about 90 seconds. Equivalent UI path: Settings → Pages → Build and
deployment → Source = "GitHub Actions".

Once Pages exists via either path, `enablement: true` becomes a silent
no-op forever — it's harmless to leave in, but it was never doing the
bootstrapping work the plan credited it with. The line was removed from
the workflow entirely in PR #125 / CCE-82. For host repos onboarding
`framework: mkdocs` in the future, the `gh api` bootstrap call belongs in
the engineering-docs-agent plugin's `setup_scaffold` step rather than a
one-off recovery command — filed as plugin-side tech debt in the mkdocs
spec's "Future work" table.

## Monitor/poll scripts must run under bash, not zsh

Separately, both ad-hoc monitor scripts written to poll the deploy
(watching `gh run list` / `gh run view` in a loop) crashed silently under
zsh. `status` and `pipestatus` are read-only zsh built-in parameters —
`status` exposes the last command's exit code, `pipestatus` the per-stage
exit codes of the last pipeline. A poll loop that assigns to either of
those names (a natural variable choice when you're tracking a run's
status) hits `read-only variable: status` and the shell exits non-zero
mid-loop, before emitting any event lines.

That's a nastier failure mode than it sounds: a monitor that dies with no
output looks identical to "the watched system is still pending," so both
monitors in this cycle silently masked the fact that the deploy had
already succeeded.

Two ways to avoid it:

1. Name loop locals away from the reserved set — `run_status`,
   `pipe_state` — instead of `status` / `pipestatus`.
2. Shebang the script `#!/usr/bin/env bash` and run it under bash, where
   those names aren't reserved.

The session's shell is zsh by default, so this is worth weighing any time
you write a Monitor script for this repo. The corollary matters more than
the fix: **a monitor script exiting non-zero with zero emitted event
lines is almost always a script bug, not evidence the watched task
failed.** Confirm directly — `gh run view <ID> --json status,conclusion,jobs`
— before treating a silent monitor as a signal.

## Where this is recorded

Both lessons live as Conventions bullets in `CLAUDE.md`, with the Pages
recovery detail cross-referenced into:

- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — the
  "POST-IMPLEMENTATION CORRECTION (2026-06-02, PR #121 / CCE-81)" note
  under Gate 5, including the eventual PR #125 / CCE-82 cleanup.
- `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` — the rollout
  sequence's gate table.

Neither planning doc was rewritten wholesale; the durable lesson is the
CLAUDE.md Conventions entry, not a retroactive edit to already-merged
spec prose.
