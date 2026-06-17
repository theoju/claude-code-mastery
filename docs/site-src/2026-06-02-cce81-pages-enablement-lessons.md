---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# CCE-81 Post-Merge Lessons: Pages Enablement and zsh Monitor Crashes

**Date:** 2026-06-02  
**PR:** [#122](https://github.com/theoju/claude-code-self-assessment/pull/122) (follow-up to PR #121 / CCE-81)  
**Relates to:** `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`, `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`

PR #121 merged the mkdocs upgrade cleanly through all 20 planned tasks, but two operational failures during the rollout weren't fully crystallized until after merge. This page captures them as durable postmortem records so future contributors — and automated agents running in this repo — don't repeat them.

---

## Lesson 1 — `actions/configure-pages@v6 enablement: true` does not bootstrap GitHub Pages

### What happened

PR #121 squash-merged at 06:26:27Z. The `docs-agent-pages.yml` workflow auto-fired on the resulting merge commit (`6369065`). It failed after ~3s at the `configure-pages@v6` step:

```
Get Pages site failed. Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
HttpError: Resource not accessible by integration
```

### Root cause

The spec's Gate 5 claimed that `enablement: true` would programmatically enable GitHub Pages on the first workflow run, given `pages: write` and `id-token: write` permissions. This is **wrong**.

`GITHUB_TOKEN` never carries the admin scope required for `POST /repos/.../pages`. The `permissions:` block in a workflow can only _restrict_ the default token's built-in scopes — it cannot add new ones. `enablement: true` is therefore:

- A silent no-op on every run where Pages already exists.
- A failing no-op on the very first run, because the token can't call the Pages creation endpoint regardless of what `permissions:` declares.

The field name is misleading — it reads like an opt-in flag to enable Pages, but it only applies if the token already has the admin scope to do so.

### Recovery (manual, ~2 min)

```bash
# 1. Enable Pages from a personal admin gh session (not the workflow token)
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
# Returns: {"build_type":"workflow","html_url":"https://theoju.github.io/claude-code-self-assessment/", ...}

# 2. Manually dispatch the deploy workflow now that Pages exists
gh workflow run docs-agent-pages.yml \
  --repo theoju/claude-code-self-assessment --ref main

# 3. Build ran 16s, deploy ran 8s; site live at https://theoju.github.io/claude-code-self-assessment/
```

All six migrated pages returned HTTP 200. The Next.js `/methodology/` route correctly 404'd, confirming the site is scoped to `docs/site-src/` only.

### `build_type=workflow` is durable

Once you set `build_type=workflow` via the API, GitHub Pages serves only content uploaded by `actions/deploy-pages` — not files pushed to `gh-pages` or `main`. This is what you want for an mkdocs build. Static files committed to the repo do not appear on the site, which is also worth knowing if someone wonders why `README.md` isn't published.

All subsequent push-triggered `docs-agent-pages.yml` runs now work cleanly without manual intervention.

### What was updated after this incident

- `enablement: true` was removed from `.github/workflows/docs-agent-pages.yml` in PR #125 / CCE-82. The line was misleading before Pages exists and a silent no-op after.
- The plugin's `setup_scaffold` script (filed as a tech-debt followup) should bake in the `gh api` call so future hosts onboarded with `framework: mkdocs` don't hit the same footgun.
- CLAUDE.md Conventions now carries this gotcha for contributors and agents.
- The spec's Gate 5 block (`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`) carries a POST-IMPLEMENTATION CORRECTION recording the actual failure and recovery.

### Rule for future `framework: mkdocs` onboarding

Before the first push to `main` after adding a `docs-agent-pages.yml` workflow, run this **once** from a personal admin gh login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path if you prefer: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**. After this one-time step, the workflow's push trigger handles all subsequent deploys automatically.

---

## Lesson 2 — Monitor scripts must avoid zsh reserved variable names

### What happened

During the rollout, two separate monitor scripts used `status` as a loop-local variable to track workflow run outcomes. Both crashed under zsh with:

```
read-only variable: status
```

Both monitors exited non-zero with no event lines emitted. Because the output was empty, it initially looked like the watched workflow had failed — but direct queries via `gh run view <ID> --json status,conclusion,jobs` showed the deploy had actually succeeded. The monitors were masking success as failure.

### Root cause

In zsh, `status` and `pipestatus` are **read-only built-in parameters**. `status` exposes the exit code of the last command; `pipestatus` is an array of exit codes from the last pipeline stage. Assigning to either inside a script crashes the shell immediately with `read-only variable: <name>`.

Bash does not have this restriction — `status` is a writable variable in bash. Because the CLAUDE.md project context lists `Shell: zsh`, any monitor or shell script written without an explicit `#!/usr/bin/env bash` shebang runs under zsh and inherits this constraint.

### Fix

Two approaches, either works:

**Option A — Rename the variable** away from the zsh reserved set:

```bash
# Instead of:
status=$(gh run view "$run_id" --json status --jq '.status')

# Use:
run_status=$(gh run view "$run_id" --json status --jq '.status')
```

Prefer `run_status`, `poll_status`, `exit_code`, or any name not in the zsh reserved set. The same applies to `pipestatus` — use `pipe_state` or similar.

**Option B — Shebang the script as bash**:

```bash
#!/usr/bin/env bash
```

Under bash, `status` is writable, so no rename is needed. This is preferable when porting a script that already uses `status` extensively.

### Diagnostic heuristic

A monitor script that exits non-zero with **zero event lines emitted** is almost always a script bug, not evidence that the watched system failed. Before treating monitor failure as a signal, confirm the underlying system state directly:

```bash
gh run view <ID> --json status,conclusion,jobs
```

If `conclusion` is `success`, the monitor was broken, not the workflow.

### What was updated after this incident

CLAUDE.md Conventions now carries a dedicated bullet on this: name loop locals away from the reserved set (`run_status`, `pipe_state`) or shebang the script `#!/usr/bin/env bash`, with the diagnostic corollary documented inline.

---

## Summary

| Lesson | Symptom | Root cause | Fix |
|--------|---------|------------|-----|
| Pages enablement | First `docs-agent-pages.yml` run fails with `Resource not accessible by integration` | `GITHUB_TOKEN` can't call `POST /repos/.../pages`; `enablement: true` is a no-op | Run `gh api -X POST .../pages -f build_type=workflow` once from an admin session before first push |
| zsh reserved names | Monitor exits non-zero with no event lines | `status`/`pipestatus` are read-only in zsh | Rename to `run_status`/`pipe_state`, or use `#!/usr/bin/env bash` shebang |

Both lessons are now recorded in CLAUDE.md Conventions alongside the spec's POST-IMPLEMENTATION CORRECTION block, ensuring they surface during any future repeat of this onboarding pattern.
