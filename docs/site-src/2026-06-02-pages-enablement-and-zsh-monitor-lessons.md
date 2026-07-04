---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# Pages enablement and zsh-monitor lessons (2026-06-02)

Two operational lessons came out of the real GitHub Pages deploy for the
mkdocs upgrade (PR #121 / CCE-81). Neither was anticipated in the original
design spec or plan — both were caught by watching the actual rollout fail
in ways the docs didn't predict. This page exists so the next person (or
the next host repo) doesn't repeat either failure. The change itself
(PR #122) is docs-only: it updates `CLAUDE.md` Conventions and adds
post-implementation notes to the mkdocs-upgrade spec and plan.

## Lesson 1: `configure-pages@v6 enablement: true` doesn't bootstrap Pages on a first deploy

The `docs-agent-pages.yml` workflow's Gate 5 assumed that
`actions/configure-pages@v6` with `enablement: true` would programmatically
turn on GitHub Pages on the very first run — no Settings UI click required.
That assumption was wrong, and it wasn't a config typo; it's a scope
limitation of the default token.

**What actually happened:** the first push-triggered run of
`docs-agent-pages.yml` against the scaffold-PR merge commit failed at the
`configure-pages@v6` step with `Resource not accessible by integration`.
The workflow's default `GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages`. `permissions:` blocks in a workflow can only
_restrict_ the default token's scopes — never expand them — so no amount of
declaring `pages: write` in the workflow YAML fixes this.

**Recovery used:**

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
gh workflow run docs-agent-pages.yml --ref main
```

The first command ran from a personal/admin `gh` login — Pages has to be
bootstrapped by someone with admin rights on the repo, once. The equivalent
UI path is Settings → Pages → Build and deployment → Source = "GitHub
Actions". After that one-time bootstrap, the dispatched workflow run
succeeded cleanly (build 16s, deploy 8s) and the site came up at
`https://theoju.github.io/claude-code-self-assessment/` within about 90
seconds.

**What's durable and what isn't:** `build_type=workflow` sticks — once set,
every subsequent push-triggered run of `docs-agent-pages.yml` works without
intervention, and `enablement: true` becomes a silent no-op forever after.
It's only a footgun on the very first deploy, when it fails loud instead of
being the no-op the field name implies. Worth knowing too: `build_type=workflow`
disables branch-deploy publishing — `deploy-pages@v5`'s artifact upload is
the only path to the published URL, which is what we want for an mkdocs
build but easy to be confused by if you go looking for static files
published straight from `main`.

**Fixed for future host repos:** the `enablement: true` line was removed
from `docs-agent-pages.yml` in the follow-up (PR #125 / CCE-82) — it was
pure noise once Pages exists and a misleading footgun before. Onboarding a
new host repo under `framework: mkdocs` should run the `gh api` bootstrap
call (or the Settings UI equivalent) before the first deploy, not rely on
the workflow to self-enable.

## Lesson 2: monitor scripts must run under bash, not zsh

Two monitor scripts written during the PR #121 cycle to poll deploy status
crashed silently and reported nothing — no event lines, no error surfaced
to the operator, just an exited process. The cause: both scripts assigned
to a loop-local variable named `status` (or `pipestatus`) inside a polling
loop. Under zsh, `status` and `pipestatus` are **read-only built-in
parameters** — `status` exposes the last command's exit code and
`pipestatus` the per-stage exit codes of the last pipeline. Assigning to
either crashes the shell with `read-only variable: status`, and the crash
happens silently enough that a monitor loop can die mid-poll without ever
printing a failure.

The session's default shell here is zsh, which is exactly why this bit us:
a script with no shebang, or a bare `sh script.sh` invocation, inherits
zsh's reserved-name behavior.

**Two ways to avoid it:**

1. Name loop locals away from the reserved set — `run_status`,
   `pipe_state`, anything that isn't `status`/`pipestatus`.
2. Shebang the script `#!/usr/bin/env bash` and run it under bash, where
   these names aren't reserved.

**Corollary worth internalizing:** if a monitor script exits non-zero with
*no* emitted event lines, treat that as a bug in the monitor, not evidence
that the thing it's watching failed. Confirm independently with a direct
query — e.g. `gh run view <ID> --json status,conclusion,jobs` — before
concluding the watched deploy actually broke.

## Why this landed as its own PR

Both lessons came out of the same incident (PR #121 / CCE-81's mkdocs
rollout) but weren't captured in the original spec or plan, which had
already merged. Rather than amend merged work, they're recorded here as a
small, dedicated follow-up (PR #122): two new `CLAUDE.md` Conventions
bullets, plus matching post-implementation notes in the mkdocs-upgrade
design spec and plan. Docs-only — no code or workflow behavior changed by
this PR itself (the workflow fix landed separately in PR #125 / CCE-82).
