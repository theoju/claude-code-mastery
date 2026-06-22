---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# Lessons from the GitHub Pages First-Deploy Incident (2026-06-02)

PR #122 (CCE-81 follow-up) recorded three durable operational lessons that
surfaced during the PR #121 mkdocs upgrade rollout. They are captured here as
a dated decision record so future host onboardings with `framework: mkdocs`
don't trip the same footguns.

## Background

PR #121 scaffolded the mkdocs site and wired up the `docs-agent-pages.yml`
GitHub Actions workflow. After squash-merge, the first push-triggered deploy
run failed immediately — before the build step even started. Two separate
monitoring scripts written to watch the recovery also crashed silently. All
three issues are independent; all three are documented here.

## Lesson 1 — `configure-pages@v6 enablement: true` does NOT bootstrap Pages on a first deploy

The original spec for Gate 5 assumed that including `enablement: true` in the
`actions/configure-pages@v6` step would programmatically enable GitHub Pages
on the repository's first deploy. It doesn't.

The first push-triggered run (on merge commit `6369065`) failed after ~3 seconds:

```
Get Pages site failed. Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
HttpError: Resource not accessible by integration
```

**Root cause:** The workflow's `GITHUB_TOKEN` lacks the admin scope required to
call `POST /repos/.../pages`. The `permissions:` block in a workflow YAML can
only *restrict* the default token's scopes — it cannot grant scopes the token
doesn't already have. `enablement: true` is a no-op on the first run when Pages
hasn't been enabled by other means, and a no-op on every subsequent run once it
has been.

**Recovery:** Run this once from a personal admin `gh` login before the
first deploy:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Or use the equivalent Settings UI path: **Settings → Pages → Build and
deployment → Source = "GitHub Actions"**. The `build_type=workflow` value is
durable — all subsequent push-triggered runs of `docs-agent-pages.yml` work
cleanly after this one-time call.

After the `gh api` call, re-dispatch the workflow manually:

```bash
gh workflow run docs-agent-pages.yml --repo <owner>/<repo> --ref main
```

**Clean-up:** The `enablement: true` line in `docs-agent-pages.yml` was removed
in PR #125 (CCE-82). It was misleading before Pages existed and meaningless
after. For future hosts onboarded with `framework: mkdocs`, the `gh api` call
should be part of the setup runbook (or baked into the engineering-docs-agent
plugin's `setup_scaffold` script — filed as a plugin-side tech-debt follow-up).

## Lesson 2 — Monitor scripts must avoid `status` and `pipestatus` under zsh

Two separate monitor scripts written during the recovery used `status` as a
loop-local variable name. Both exited non-zero with no event lines emitted.

**Root cause:** Under zsh, `status` and `pipestatus` are read-only built-in
parameters — they expose the last command's exit code and the per-stage
exit codes of the last pipeline, respectively. Assigning to either inside a
shell function or loop crashes the shell immediately:

```
read-only variable: status
```

The session environment is zsh (`Shell: zsh` appears in the session reminder).
Bash does not reserve these names, so scripts that work fine under bash can
silently break when run in a zsh session.

**Fix:** Rename loop locals away from the reserved set. Use `run_status`,
`pipe_state`, `exit_code`, or any name that doesn't collide. Alternatively,
shebang the script `#!/usr/bin/env bash` — bash does not treat `status` or
`pipestatus` as read-only.

## Lesson 3 — A monitor exiting non-zero with no event lines is almost always a script bug

This is a corollary of Lesson 2, worth making explicit because the failure
mode is counter-intuitive.

When a monitor script crashes (e.g., from the `status` assignment above), it
exits non-zero but emits *zero* event lines. On first inspection this looks
identical to "the watched system failed" — the monitor reported failure, no
events appeared. The natural instinct is to check the watched system.

In both cases during the PR #121 incident, direct `gh run view <ID>` queries
showed the deploy had actually **succeeded**. The monitor script was the broken
component, not the deployment pipeline.

**Rule:** Before treating a monitor's non-zero exit as evidence that the
watched system failed, confirm with a direct query:

```bash
gh run view <run-id> --json status,conclusion,jobs
```

If that returns `COMPLETED`/`success` and the monitor showed no events, the
monitor itself is the bug. A correctly-functioning monitor that watches a
failing system will emit at least one event line describing the failure before
it exits.

## What changed in the codebase

PR #122 was docs-only. Three files were updated:

- **`CLAUDE.md`** — two new bullets added to the Conventions section (the
  `configure-pages@v6 enablement: true` footgun and the zsh monitor crash
  pattern), each including the corollary and recovery steps.
- **`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`** — a
  `POST-IMPLEMENTATION CORRECTION` block added under Gate 5, documenting what
  actually happened, the recovery commands, and the permanent fix. The spec's
  original Gate 5 text is preserved verbatim; the correction block is additive.
- **`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`** — a "Post-merge
  outcomes" section appended documenting all three deviations (Pages
  enablement failure, Jira ticket created post-execution, monitor zsh crashes)
  plus the final state (PR #121 merged, CCE-81 open, site live as of
  `2026-06-02T06:29:12Z`).

## References

- PR #121 (mkdocs upgrade): `https://github.com/theoju/claude-code-self-assessment/pull/121`
- PR #125 (CCE-82, cleanup — removes `enablement: true`): `https://github.com/theoju/claude-code-self-assessment/pull/125`
- Spec with Gate 5 correction: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan with Post-merge outcomes: `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
- Live site: https://theoju.github.io/claude-code-self-assessment/
