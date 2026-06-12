---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# GitHub Pages deploy: three lessons from the CCE-81 incident

**Date:** 2026-06-02  
**Incident:** PR #121 / CCE-81 — mkdocs upgrade first deploy  
**Related:** [mkdocs upgrade spec](../superpowers/specs/2026-06-01-mkdocs-upgrade-design.md) · [mkdocs upgrade plan](../superpowers/plans/2026-06-01-mkdocs-upgrade.md)

The PR #121 mkdocs upgrade deployed cleanly on the second attempt, but only after hitting three non-obvious gotchas not covered in the original spec. Each one is sharp enough to repeat — recording them here so future contributors and agentic workers don't rediscover them.

---

## Lesson 1: `configure-pages@v6 enablement: true` does not bootstrap Pages on a first deploy

The spec (Gate 5) stated that `actions/configure-pages@v6` with `enablement: true` would programmatically enable GitHub Pages on first run. It doesn't.

What actually happened: the first push-triggered run of `docs-agent-pages.yml` against merge commit `6369065` failed with `Resource not accessible by integration` at the `configure-pages@v6` step. The workflow's `GITHUB_TOKEN` lacks the admin scope required to call `POST /repos/.../pages`. The `permissions:` block in a workflow YAML can only _restrict_ the default token's scopes — it cannot expand them. `enablement: true` is a no-op before Pages is bootstrapped and a silent no-op forever after.

**Recovery:** run this once from a personal admin `gh` login before the first deploy:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Then dispatch the workflow manually:

```bash
gh workflow run docs-agent-pages.yml --ref main
```

The `build_type=workflow` flag is durable — once set, all subsequent push-triggered runs of the deploy workflow work without further intervention. Equivalent UI path: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

The `enablement: true` line was removed from `docs-agent-pages.yml` in PR #125 / CCE-82. For future host repos onboarding with `framework: mkdocs`, the `gh api` call should be baked into the engineering-docs-agent plugin's `setup_scaffold` script or an onboarding runbook before the first push.

---

## Lesson 2: Monitor scripts must use a bash shebang, not zsh

When watching the Pages deploy via a poll loop, two monitor scripts written during the PR #121 cycle crashed with `read-only variable: status` immediately after the first iteration and emitted no event lines, masking a successful deploy.

The cause: `status` and `pipestatus` are read-only built-in parameters in zsh. Assigning to either inside a shell function or loop crashes the shell. The session environment is zsh (`Shell: zsh` in the environment reminder) — scripts that run under the user's default shell inherit this constraint.

**Fix:** shebang the script `#!/usr/bin/env bash`, where `status` and `pipestatus` are ordinary writable variables. Or rename your loop locals away from the reserved set (`run_status`, `pipe_state`).

**Corollary:** a monitor script that exits non-zero with no event lines emitted is almost always a script bug, not a failure of the system being watched. Before treating monitor failure as evidence the underlying task failed, confirm directly:

```bash
gh run view <run-id> --json status,conclusion,jobs
```

---

## Lesson 3: Plan-step verification must use the actual consumer tool, not filesystem checks

The original rollout plan used `test -f` style checks to verify that scaffold files existed before proceeding. These pass even when the consumer — `mkdocs build --strict` — would reject the file.

The general pattern: a filesystem path can resolve correctly on disk while violating the consumer's validity contract. `mkdocs build --strict` rejects link targets outside `docs_dir`, broken nav refs in `SUMMARY.md`, and relative image paths that didn't survive the `git mv` sweep — none of which `test -f` catches.

**Rule:** when a plan step produces a published artifact — a markdown link inside a built docs site, a TypeScript import, a JSON Schema reference, an OpenAPI route — the verification step must invoke the tool that _consumes_ the artifact:

| Artifact type             | Verification command                    |
| ------------------------- | --------------------------------------- |
| MkDocs site pages/links   | `mkdocs build --strict`                 |
| TypeScript imports        | `npx tsc --noEmit`                      |
| JSON Schema references    | `ajv validate`                          |
| OpenAPI routes            | spec validator of your choice           |

Running the real consumer in a plan step is a one-off cost. The cost of a half-verified plan landing is a deploy outage or a CI failure that blocks the next PR.

---

## Summary

| Lesson | Root cause | Fix |
| --- | --- | --- |
| `configure-pages@v6 enablement: true` is a no-op on first deploy | `GITHUB_TOKEN` lacks admin scope; `permissions:` can only restrict scopes | Run `gh api -X POST .../pages -f build_type=workflow` once from an admin login before first push |
| Monitor scripts crash on `status` assignment under zsh | `status`/`pipestatus` are read-only zsh built-ins | Use `#!/usr/bin/env bash` or rename loop locals |
| Filesystem checks miss consumer-validity errors | `test -f` only checks existence, not contract conformance | Run `mkdocs build --strict` (or equivalent consumer) as the plan-step gate |

All three lessons are now carried in `CLAUDE.md` (Conventions section) and in the post-implementation correction block of the [mkdocs upgrade spec](../superpowers/specs/2026-06-01-mkdocs-upgrade-design.md).
