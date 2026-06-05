---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
---

# Lessons from the MkDocs / GitHub Pages deploy incident (CCE-81)

PR #121 landed the MkDocs upgrade cleanly, but the first deploy surfaced two
high-recurrence failure modes that don't appear in any CI log until they bite
you. This page codifies them so you don't repeat the same afternoon of
debugging on the next host onboarding.

## 1. `actions/configure-pages@v6 enablement: true` does not bootstrap Pages

If GitHub Pages has never been enabled for a repository, setting
`enablement: true` in `actions/configure-pages@v6` **does nothing useful on
the first run**. The workflow's `GITHUB_TOKEN` does not have the admin scope
required to call `POST /repos/<owner>/<repo>/pages`, and a `permissions:`
block can only _restrict_ the default token's scopes — it cannot expand them.
The run fails with `Resource not accessible by integration`.

Once Pages has been bootstrapped by any method, `enablement: true` becomes a
silent no-op and the workflow proceeds normally. That asymmetry is what makes
this footgun hard to spot: every run after the first one works, so the
failure feels environmental rather than structural.

**Fix for host onboarding — run this once, before the first deploy:**

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

This call requires an admin token or a personal `gh` login with repo admin
rights. The equivalent UI path is: Settings → Pages → Build and deployment →
Source = "GitHub Actions". Either way, `build_type=workflow` is the durable
setting: it persists across all subsequent push-triggered runs of
`docs-agent-pages.yml` and disables branch-deploy publishing (files in `main`
don't appear automatically — only `deploy-pages@v5` artifact uploads do, which
is the intended behaviour for an MkDocs build).

The `enablement: true` line was removed from the workflow in PR #125 / CCE-82
to avoid misleading future readers.

## 2. Monitor scripts must not assign to zsh built-in parameters

`status` and `pipestatus` are read-only built-in parameters in zsh. They
expose the last command's exit code and the per-stage exit codes of the last
pipeline respectively. Assigning to either inside a poll loop crashes the
shell with `read-only variable: status` — and because the crash happens
silently inside the loop, the monitor exits non-zero with **no event lines
emitted**.

Both monitor scripts written during the PR #121 cycle hit this:

```bash
# Crashes under zsh — "status" is reserved
while true; do
  status=$(gh run view "$RUN_ID" --json status --jq '.status')
  ...
done
```

Two ways to avoid it:

1. **Rename the local** away from the reserved set — `run_status`,
   `deploy_status`, anything that isn't a zsh built-in name:

   ```bash
   run_status=$(gh run view "$RUN_ID" --json status --jq '.status')
   ```

2. **Run the script under bash**, not zsh. Add `#!/usr/bin/env bash` as the
   shebang. Under bash, `status` and `pipestatus` are not reserved and the
   assignment works as expected.

The session environment shows `Shell: zsh` — weight that every time you write
a monitor or poll script.

## 3. A monitor that exits with no event lines is almost always a script bug

If a monitor script exits non-zero but emits _no_ event lines, do not treat
that as evidence that the underlying system failed. The monitor likely crashed
before it could observe anything. Confirm by direct query:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs
```

Both deploy-monitoring incidents from the PR #121 cycle produced a clean
`COMPLETED / success` from the direct query while the monitor itself had
already exited with a zsh crash. The deploy was fine; the script was broken.

The rule: **verify the watched system independently before acting on monitor
output**.

## Where these lessons live in CLAUDE.md

Both lessons were codified as permanent convention bullets in this repo's
`CLAUDE.md` during PR #122:

- "Monitor scripts must use bash, not zsh's defaults" (with the `status` /
  `pipestatus` detail and the two avoidance strategies).
- "A monitor exiting non-zero with no emitted event lines is almost always a
  script bug, not a failure of the watched system" (with the `gh run view`
  verification pattern).

The spec at
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` carries a
"Post-implementation correction" block with the full incident timeline. The
plan at `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` records the
post-merge outcomes section documenting what diverged from the original
rollout plan.
