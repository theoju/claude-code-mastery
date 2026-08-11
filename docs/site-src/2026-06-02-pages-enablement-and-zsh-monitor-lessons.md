---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# GitHub Pages enablement and zsh monitor-script lessons (CCE-81)

The mkdocs Pages rollout (PR #121 / CCE-81) shipped the scaffold and the
`docs-agent-pages.yml` workflow exactly as designed, but the *live* first
deploy surfaced two operational gotchas that the design spec's plan hadn't
anticipated. Both cost real diagnosis time, so they're recorded here — and in
`CLAUDE.md`'s Conventions section — for the next host repo that takes the same
upgrade path.

## `configure-pages@v6 enablement: true` doesn't bootstrap Pages on a first deploy

The original plan (`docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`,
Gate 5) assumed `actions/configure-pages@v6` with `enablement: true` would
programmatically enable GitHub Pages on the workflow's first run, with no
manual Settings-UI click required. It doesn't. The workflow's `GITHUB_TOKEN`
lacks the admin scope `POST /repos/.../pages` needs, and a `permissions:`
block in the workflow YAML can only *restrict* the default token's scopes —
never expand them. Declaring `pages: write` and `id-token: write` in the
workflow, as `docs-agent-pages.yml` did, doesn't change that.

The first push-triggered run against the scaffold PR's merge commit failed
at the `configure-pages@v6` step with `Resource not accessible by
integration`. The recovery, documented as a POST-IMPLEMENTATION CORRECTION in
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`, was to bootstrap
Pages out-of-band from a personal admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

— then dispatch the workflow manually (`gh workflow run docs-agent-pages.yml
--ref main`). The dispatched run succeeded (build 16s, deploy 8s) and the
site came up within about 90 seconds. The equivalent UI path is Settings →
Pages → Build and deployment → Source = "GitHub Actions".

Once Pages exists via either path, `build_type=workflow` is durable:
`enablement: true` becomes a permanent no-op on every subsequent
push-triggered run, so leaving the line in the workflow is harmless but
misleading — it looks load-bearing and isn't. `CLAUDE.md`'s Conventions
section now carries this as a standing rule: for future `framework: mkdocs`
host repos, the `gh api` bootstrap call needs to run once, before the first
deploy, from an admin login — either as a manual pre-step or, per the spec's
"Future work" table, baked into the engineering-docs-agent plugin's
`setup_scaffold` step. The plugin-side fix is tracked in the
engineering-docs-agent repo's own CLAUDE.md; this repo's plan records the
2026-06-02 incident and its resolution (PR #125 / CCE-82, which removed the
misleading `enablement: true` line and replaced the manual bootstrap step
with a scripted one) in its "Post-merge outcomes" section.

`build_type=workflow` also has a side effect worth knowing about: it
disables branch-deploy publishing. The only path to
`https://theoju.github.io/claude-code-self-assessment/` after that point is
the `deploy-pages@v5` artifact-upload flow — which is what the mkdocs build
wants anyway, but it means static files committed to `main` won't
independently appear on the Pages URL.

## zsh's read-only `status` and `pipestatus` crash monitor scripts

Both verification monitors written during the PR #121 cycle to poll the live
deploy hit the same bug: they assigned to a loop-local variable named
`status` (and, separately, `pipestatus`) inside a polling loop. Under zsh,
`status` and `pipestatus` are **read-only built-in parameters** — `status`
exposes the last command's exit code, `pipestatus` the per-stage exit codes
of the last pipeline. Assigning to either crashes the shell with
`read-only variable: status`, and the monitor exits non-zero having emitted
no event lines at all.

The session's shell is zsh, so this is a live hazard for any future
monitor/poll script written in this repo. Two independent fixes, either
sufficient on its own:

1. **Don't use the reserved names.** Name loop locals `run_status` or
   `pipe_state` instead of `status`/`pipestatus`.
2. **Shebang the script `#!/usr/bin/env bash`** and run it under bash, where
   neither name is reserved.

The corollary matters more than the fix itself: **a monitor script exiting
non-zero with zero emitted event lines is almost always a script bug, not
evidence that the watched system failed.** Both monitors in the PR #121
cycle silently masked a *successful* deploy this way. Before treating a
monitor's failure as a signal about the underlying task, confirm directly —
for a GitHub Actions run, `gh run view <ID> --json status,conclusion,jobs`.

## Where this is recorded

- `CLAUDE.md` — Conventions section, two new bullets (Pages enablement
  footgun; zsh read-only built-ins).
- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — the
  POST-IMPLEMENTATION CORRECTION block under Gate 5, with the exact failing
  step, the recovery commands, and the resolution PRs (#125 / CCE-82).
- `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md` — a "Post-merge
  outcomes" section recording what actually happened during the live deploy
  against what Gate 5 originally specified.

Neither lesson changes the target architecture from the original design —
the scaffold, the two-workflow split, and the `docs/site-src/` migration all
landed as planned. What changed is the *bootstrap* step for any future host
repo repeating Path A, and a standing caution about zsh reserved names in
this repo's shell tooling.
