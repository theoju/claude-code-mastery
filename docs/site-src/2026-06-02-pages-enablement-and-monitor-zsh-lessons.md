---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
---

# GitHub Pages first-deploy and zsh monitor pitfalls — CCE-81 lessons

Three operational lessons surfaced during the v0.9.20 MkDocs upgrade (PR #121 / CCE-81)
and recorded as durable corrections in PR #122. If you're onboarding a new host repo
with `framework: mkdocs`, read these before you run the first deploy.

---

## Lesson 1: `actions/configure-pages@v6 enablement: true` does not bootstrap Pages

The field name is misleading. On a repository where GitHub Pages has never been enabled,
`enablement: true` does **not** call the Pages bootstrap API. The workflow's `GITHUB_TOKEN`
lacks the admin scope required for `POST /repos/<owner>/<repo>/pages`, so the very first
run fails:

```
Resource not accessible by integration
```

This happens even with `permissions: pages: write` declared in the workflow — that
declaration can only _restrict_ the default token's scopes, never expand them.

**Fix:** before running the first deploy, bootstrap Pages once from a personal/admin
`gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

`build_type=workflow` is durable. Once set, all subsequent push-triggered runs of
`docs-agent-pages.yml` work cleanly and the `enablement: true` line in the workflow
is a silent no-op. The line was deleted from the workflow in PR #125 / CCE-82.

Note that `build_type=workflow` also disables branch-deploy publishing — the only path
to `<org>.github.io/<repo>/` is the `deploy-pages@v5` artifact upload, which is what
you want for MkDocs builds. Static files committed to `main` will not appear there.

---

## Lesson 2: monitor scripts must not use zsh's read-only built-ins

`status` and `pipestatus` are **read-only** built-in parameters in zsh. They expose
the last command's exit code and the per-stage exit codes of the last pipeline,
respectively. Assigning to either inside a poll loop crashes the shell immediately:

```
read-only variable: status
```

The monitor exits non-zero with **no event lines emitted**, which silently masks the
underlying system's success. Both monitors written during the PR #121 cycle hit this.

**Two ways to avoid it:**

1. Name your loop locals away from the reserved set — `run_status`, `poll_state`,
   `pipe_result` — instead of `status` / `pipestatus`.
2. Shebang the script `#!/usr/bin/env bash`. Under bash these names are not reserved.

The session environment lists `Shell: zsh` — weight that when writing any monitoring
or automation script. If a monitor exits non-zero with zero emitted event lines, treat
it as a script bug first, not evidence the watched system failed. Confirm by direct query:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs
```

---

## Where the corrections live

The full post-implementation record is in:

- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — **POST-IMPLEMENTATION
  CORRECTION** block covers the Pages failure, recovery procedure, and `build_type=workflow`
  semantics.
- `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` — **Post-merge outcomes** section
  records all three deviations from the original plan (Pages failure + recovery, CCE-81
  filing, monitor crash).
- `CLAUDE.md` (project memory) — two hard-rule entries: one for `enablement: true`
  behavior and one for the zsh read-only built-ins, both with the full recovery procedure
  and a pointer to this incident.
