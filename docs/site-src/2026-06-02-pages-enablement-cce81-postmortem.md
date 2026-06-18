---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# CCE-81 Postmortem: GitHub Pages First-Deploy Footgun and zsh Built-in Collision

**Date:** 2026-06-02  
**Ticket:** CCE-81  
**PR:** #121 (scaffold) · #122 (post-merge corrections) · #125 (cleanup — deleted `enablement: true`)

PR #121 shipped the mkdocs upgrade cleanly through all 20 plan tasks. Three deviations from the planned rollout surfaced during the actual deploy. This page records them as durable lessons for future host onboarding and monitoring work.

---

## Deviation 1 — `configure-pages@v6 enablement: true` does not bootstrap Pages on first deploy

### What happened

PR #121 squash-merged at `2026-06-02T06:26:27Z`. The `docs-agent-pages.yml` workflow auto-fired on merge commit `6369065`. It failed after ~3 seconds at the `configure-pages@v6` step:

```
Get Pages site failed. Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
HttpError: Resource not accessible by integration
```

### Root cause

The spec's Gate 5 assumed `enablement: true` would programmatically enable Pages on first run, given `pages: write` + `id-token: write` permissions declared in the workflow. It doesn't work that way.

`permissions:` blocks can only _restrict_ the default `GITHUB_TOKEN`'s scopes — they cannot expand them. The token lacks the admin scope required for `POST /repos/.../pages`. On the very first deploy (when the Pages resource doesn't exist yet), `enablement: true` is silently a no-op; the action tries the API call, gets `Resource not accessible by integration`, and exits non-zero. After Pages is enabled by other means, `enablement: true` becomes a silent no-op on every subsequent run.

### Recovery (~2 minutes)

```bash
# 1. Enable Pages from a personal admin gh login
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
# Returns: {"build_type":"workflow","html_url":"https://theoju.github.io/claude-code-self-assessment/", ...}

# 2. Re-dispatch the workflow
gh workflow run docs-agent-pages.yml \
  --repo theoju/claude-code-self-assessment --ref main

# 3. Watch run 26802635123: build 16s, deploy 8s — both green
```

`build_type=workflow` is durable. After the `gh api` call, all subsequent push-triggered runs of `docs-agent-pages.yml` work cleanly. The call also disables branch-deploy publishing — the only path to the site is via `deploy-pages@v5`'s artifact upload, which is exactly what you want for a mkdocs build.

Equivalent UI path if you prefer: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

### Verification

All five migrated pages returned HTTP 200 after the dispatched deploy:

| Page | Status |
| --- | --- |
| `/` (root) | 200 |
| `/self-assessment/` | 200 |
| `/ship-pattern/` | 200 |
| `/boris-tips-reference-2026-05-10/` | 200 |
| `/tip-classification-2026-05-10/` | 200 |
| `/whats-new/` | 200 |
| `/methodology/` (Next.js route) | 404 — expected; confirms site scoping |

### Permanent fix

Two changes landed as follow-ups:

1. **PR #125 / CCE-82** deleted the `enablement: true` line from `docs-agent-pages.yml` in this repo, and from the plugin's own workflow template. The line is misleading before Pages is bootstrapped and meaningless after.
2. **Plugin tech-debt filed:** the engineering-docs-agent's `setup_scaffold` script should bake in the `gh api -X POST .../pages -f build_type=workflow` call so future hosts onboarded with `framework: mkdocs` don't trip the same footgun. Tracked as a plugin-side follow-up per PR #121's description.

**For future host onboarding:** before running the first `docs-agent-pages.yml` deploy against a new repo, run the `gh api` call above from an admin login. The workflow itself cannot do this.

---

## Deviation 2 — Monitor scripts crashed on zsh `status` and `pipestatus`

### What happened

Two separate monitor scripts written during the PR #121 deploy cycle used `status` as a loop-local variable name. Both exited non-zero with no event lines emitted, which initially looked like the watched workflows had failed. Direct `gh run view <ID> --json status,conclusion` queries confirmed the deploys had actually succeeded — the monitors were lying.

### Root cause

Under zsh (the session shell), `status` and `pipestatus` are **read-only built-in parameters** that expose the last command's exit code and the per-stage pipeline exit codes respectively. Assigning to either inside a loop crashes the shell:

```
read-only variable: status
```

The assignment happens silently on the first iteration — no output, just exit non-zero. The shell reports failure; no event lines are emitted before the crash; the watched system's actual state is unknown.

bash does not reserve these names. A script that works under bash can silently break if run under zsh with these variable names.

### Fix

Two options — either works:

1. **Name locals away from the reserved set.** Use `run_status`, `pipe_state`, or anything not in the zsh reserved parameter list instead of `status` / `pipestatus`.
2. **Shebang the script `#!/usr/bin/env bash`.** Under bash, `status` is an ordinary variable name.

The session environment shows `Shell: zsh` — weight that when writing monitor scripts in this project.

### Corollary

A monitor exiting non-zero with **no emitted event lines** is almost always a script bug, not a failure of the watched system. Always confirm by direct query (`gh run view <ID> --json status,conclusion,jobs`) before treating monitor failure as evidence the underlying task failed.

---

## Deviation 3 — Jira ticket created post-execution, not pre-execution

The plan and PR opened with `CCE-XX` as a literal placeholder per spec Open Question §1 and the executor notes. After the PR was created, a search of the CCE backlog found no existing ticket with matching scope (CCE-57 is the host-onboarding umbrella ticket; CCE-64 was the `framework=none` first-class ticket, both Done with different scope). **CCE-81** was filed with a full description linking PR #121, the spec, and the plan.

No workflow impact; recorded here because the plan's pre-execution ticket discipline wasn't followed and the deviation is worth noting for future plan executors.

---

## Post-merge corrections

All three deviations above are recorded in the original spec and plan as dated post-implementation corrections:

- **Spec** (`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`): Gate 5 now carries a `POST-IMPLEMENTATION CORRECTION` block documenting the enablement footgun, the exact recovery steps, and the CCE-82 resolution.
- **Plan** (`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`): A `## Post-merge outcomes` section documents all three deviations with timestamps, root causes, and lessons.
- **CLAUDE.md**: Two new convention bullets added — one for the `enablement: true` footgun, one for the zsh built-in collision pattern.

The corrections are committed separately (PR #122) rather than amending the original spec/plan content, so the original narrative and the corrections are both discoverable with their own timestamps.

---

## Final state

| Item | Value |
| --- | --- |
| PR #121 merged | `2026-06-02T06:26:27Z`, commit `6369065` |
| Site live | `2026-06-02T06:29:12Z` at `https://theoju.github.io/claude-code-self-assessment/` |
| Ticket | CCE-81 |
| `enablement: true` removed | PR #125 / CCE-82 |
| Plugin onboarding fix | Filed as plugin-side follow-up |

Future docs-touching merges trigger `docs-agent-pages.yml` automatically. No further manual intervention is required — `build_type=workflow` is durable.
