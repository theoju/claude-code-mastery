---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# MkDocs Upgrade Design — CCE-81

**Date:** 2026-06-01 · **Post-implementation corrections:** 2026-06-02 (PR #122)
**Ticket:** CCE-81 · **Status:** Shipped (PR #121, merged 2026-06-02T06:26:27Z)

This page captures the design decisions and operational lessons from upgrading the
engineering-docs-agent integration from `framework: none` to `framework: mkdocs`,
scaffolding a Material-theme site at
`https://theoju.github.io/claude-code-self-assessment/`, and standing up the
GitHub Pages deploy workflow. The full implementation spec and plan live in
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` and
`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` (unpublished, in-repo only).

## What was built

Six new files, five modified files, five `git mv` renames, one small TS path edit.
The scaffold:

| File / path | Purpose |
| --- | --- |
| `mkdocs.yml` | Material theme, `awesome-pages` + `literate-nav`, `pymdownx.superfences` |
| `requirements-docs.txt` | Pinned Python deps (`mkdocs==1.6.1`, `mkdocs-material==9.5.49`, etc.) |
| `.github/workflows/docs-agent-pages.yml` | `mkdocs build --strict` → upload → deploy on push to `main` |
| `.github/workflows/docs-build-check.yml` | PR-level build gate (no deploy) |
| `docs/site-src/index.md` | Site landing page |
| `docs/site-src/SUMMARY.md` | Literate-nav ordering |
| `docs/site-src/whats-new.md` | Stub the agent populates on each nightly |

Four existing markdown files and the `docs/images/` directory moved verbatim from
`docs/` to `docs/site-src/` via `git mv` (no content rewriting). The
`.engineering-docs-agent/config.yml` flipped five fields (`framework`, `whats_new_file`,
`lens_paths.core`, `publishing.base_url`, `publishing.build_workflow`).

## Architecture

Two workflows, two responsibilities, isolated failure modes:

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `docs-agent-nightly.yml` (existing) | cron 07:07 UTC + `workflow_dispatch` | Claude orchestrator → opens/updates `docs-agent/YYYY-MM-DD` PR with authored pages |
| `docs-agent-pages.yml` (new) | push to `main` on docs paths + `workflow_dispatch` | `mkdocs build --strict` → upload artifact → deploy to GitHub Pages |

A nightly outage doesn't take down the published site; a Pages build break doesn't
stop authoring. The `paths:` filter on `docs-agent-pages.yml` prevents rebuilding
when only `scripts/`, `app/`, or test files change.

## Dependency order

Matters for review and for future host onboardings:

1. Scaffold (`mkdocs.yml` + `docs/site-src/`) must exist and pass `mkdocs build --strict` locally.
2. Deploy workflow (`.github/workflows/docs-agent-pages.yml`) needs the scaffold to point at.
3. **GitHub Pages must be bootstrapped** before the workflow can deploy (see Operational Lessons below).
4. `.engineering-docs-agent/config.yml` flips last. `framework: mkdocs` activates the publish-verifier stage of the nightly, which expects the site URL to be reachable.

Verify bottom-up. Do not push until `mkdocs build --strict` exits 0 locally.

## Key design decisions

**Separate build and deploy workflows.** The nightly runs with Claude OAuth + Jira
credentials under a 60-minute timeout. The Pages workflow runs in ~30s with no
secrets beyond `GITHUB_TOKEN`. Isolation means a nightly outage doesn't pull down
the site.

**`mkdocs build --strict` everywhere.** Both the PR-level gate
(`docs-build-check.yml`) and the push-triggered deploy (`docs-agent-pages.yml`)
run `--strict`. Broken inter-doc links, missing nav refs, and malformed frontmatter
all fail loudly before the artifact ever reaches Pages.

**`docs/superpowers/specs/` stays unpublished.** The `lens_paths.core` config points
at `docs/site-src/` only. Design history and implementation plans live in-repo for
the plugin's lens analysis but are not surfaced on the public site.

**Verbatim migration.** The four existing markdown files moved without content
rewriting. Links to files outside `docs_dir` (`.claude/skills/`, `docs/superpowers/`)
were converted to absolute GitHub blob URLs rather than omitted.

## Operational lessons (PR #121 / CCE-81 deploy incident)

Three deviations from the planned rollout, recorded here so future hosts onboarded
with `framework: mkdocs` don't repeat them.

### 1. `configure-pages@v6 enablement: true` does not bootstrap Pages on first deploy

**What happened:** PR #121 squash-merged → `docs-agent-pages.yml` auto-fired on
commit `6369065` → failed at the `configure-pages@v6` step after ~3s:

```
Get Pages site failed. Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
HttpError: Resource not accessible by integration
```

**Why:** The `GITHUB_TOKEN` that the workflow uses for `actions/configure-pages@v6`
lacks the admin scope required for `POST /repos/.../pages`. The `permissions:` block
in a workflow YAML can only _restrict_ the default token's scopes — never expand
them. So `enablement: true` is effectively a no-op on the first run when Pages
doesn't exist yet, and a silent no-op on every subsequent run once Pages is enabled
by other means.

**Recovery (manual, ~2 min):**

```bash
# 1. Bootstrap Pages from a personal admin gh login
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
# Returned: {"build_type":"workflow","html_url":"https://theoju.github.io/..."}

# 2. Re-dispatch the workflow
gh workflow run docs-agent-pages.yml \
  --repo theoju/claude-code-self-assessment --ref main
# Build: 16s, deploy: 8s → HTTP/2 200 within ~90s
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
`build_type=workflow` is durable — all subsequent push-triggered runs work cleanly.

**Permanent fix:** the `enablement: true` line was deleted from `docs-agent-pages.yml`
in PR #125 / CCE-82. It's misleading before Pages exists and meaningless after.
For future host repos, bake the `gh api` call into the onboarding runbook (or the
plugin's `setup_scaffold` script, filed as plugin tech-debt).

### 2. Monitor scripts must not assign to zsh reserved built-ins

Two monitor scripts written during the PR #121 rollout used `status` as a loop-local
variable name. Under zsh (the project's session shell), `status` and `pipestatus`
are read-only built-in parameters exposing the last command's exit code and per-stage
pipeline codes. Assigning to either crashes the script:

```
read-only variable: status
```

Both monitors exited non-zero with **no event lines emitted** — which initially looked
like the watched workflow had failed.

**Fix:** name loop locals away from the reserved set. Use `run_status`, `pipe_state`,
or similar. Alternatively, shebang the script `#!/usr/bin/env bash` — these names
aren't reserved in bash.

### 3. A monitor that exits non-zero with no event lines is almost always a script bug

When a monitor exits non-zero but has printed nothing, the failure is almost always
in the monitor itself, not the system it's watching. Before treating monitor failure
as evidence that the underlying task failed, confirm by direct query:

```bash
gh run view <RUN_ID> --json status,conclusion,jobs
```

The PR #121 deploy had already succeeded before both monitor crashes were
investigated.

## Verification

The site came live at `https://theoju.github.io/claude-code-self-assessment/` on
2026-06-02T06:29:12Z. All six migrated pages returned HTTP 200; the Next.js
`/methodology/` route correctly 404s (confirming site scoping to `docs/site-src/`).

```bash
curl -sI https://theoju.github.io/claude-code-self-assessment/ | head -3
# HTTP/2 200
# content-type: text/html; charset=utf-8
```

Future docs-touching merges trigger `docs-agent-pages.yml` automatically via the
`push.paths` filter; no manual dispatch needed.
