---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/122
synthesized_into: []
doc_kind: decision
---

# Decision record: MkDocs upgrade for the docs site

**Date:** 2026-06-01 (PR #121 / CCE-81)
**Post-implementation corrections:** 2026-06-02 (PR #122)

This page records the decisions made to upgrade the published docs site from
`framework: none` to `framework: mkdocs` and the three durable operational
lessons that emerged from the deploy incident. The full design spec is in
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` (in-repo only).

---

## The decision

The engineering-docs-agent plugin was installed with `framework: none` and
`publishing.base_url: null`. The nightly workflow ran, but the
`publish-verifier` stage skipped every time (`verify_skipped` in
`partial_reasons`) because there was no published site to check against.

The upgrade flipped three config fields:

| Field                    | Before     | After                                                    |
| ------------------------ | ---------- | -------------------------------------------------------- |
| `docs.framework`         | `none`     | `mkdocs`                                                 |
| `publishing.base_url`    | `null`     | `https://theoju.github.io/claude-code-self-assessment/`  |
| `publishing.build_workflow` | `null`  | `docs-agent-pages.yml`                                   |

The scaffold — `mkdocs.yml`, `requirements-docs.txt`, `docs/site-src/` layout,
and the Pages deploy workflow — was authored by hand using the plugin's own
dogfood repo as the reference. (The plugin does not ship a `setup_scaffold`
script; that gap is filed as future plugin-side tech-debt.)

---

## Architecture: two workflows, separated by concern

| Workflow                   | Trigger                         | Does                                                                    |
| -------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `docs-agent-nightly.yml`   | cron 07:07 UTC + manual dispatch | Plugin orchestrator → opens/updates `docs-agent/YYYY-MM-DD` PR         |
| `docs-agent-pages.yml`     | push to `main` on docs paths    | `mkdocs build --strict` → upload artifact → deploy to Pages             |

The nightly carries Claude OAuth + Jira creds and has a 60-minute budget. The
Pages build has no secrets and runs in ~30s. Failures are isolated — a nightly
outage doesn't take the published site down; a build break in Pages doesn't
stop authoring.

---

## Post-implementation corrections (PR #122, 2026-06-02)

Three assumptions in the original design were wrong. Each produced a real
failure during the first deploy. They're recorded here so future host
onboarding doesn't repeat them.

### 1. `configure-pages@v6 enablement: true` does NOT bootstrap Pages

The original spec's Gate 5 said the workflow's `enablement: true` flag
"programmatically enables Pages on first run." This is wrong.

The workflow's `GITHUB_TOKEN` lacks the admin scope required to call
`POST /repos/.../pages`. The `permissions:` block in a workflow YAML can only
*restrict* the default token's scopes — it cannot expand them. The first
push-triggered run of `docs-agent-pages.yml` failed with:

```
Resource not accessible by integration
```

**Fix (one-time, per host repo):** before the first deploy, run this from
a personal admin `gh` login:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: Settings → Pages → Build and deployment → Source →
"GitHub Actions". Once Pages exists (either path), `enablement: true` is a
permanent silent no-op. The line was deleted from `docs-agent-pages.yml`
in PR #125 / CCE-82 to remove the footgun.

`build_type=workflow` also disables branch-deploy publishing — the only path
to the live site is via `deploy-pages@v5`'s artifact upload. That is the
intended behavior (mkdocs builds from `main`), but worth knowing if static
files pushed to a branch don't appear on the site.

**Recovery used:** `gh api` call → manual `gh workflow run docs-agent-pages.yml --ref main` → build succeeded (16s), deploy succeeded (8s), site came live at the canonical URL within ~90s.

### 2. Monitor/poll scripts must avoid zsh's read-only builtins

Both polling scripts written to watch the deploy used `status` as a loop-local
variable name. In zsh, `status` and `pipestatus` are read-only built-ins —
assigning to either crashes the shell immediately:

```
read-only variable: status
```

The monitor exited non-zero with no event lines emitted, which looked like a
system failure but was a script bug. The underlying deploy had actually
succeeded.

**Rule:** if a monitor script exits non-zero with no emitted event lines,
assume a script bug first. Confirm the real system state with a direct query
(`gh run view <ID> --json status,conclusion,jobs`) before treating monitor
failure as evidence the watched system failed.

**Fix:** rename loop locals away from the reserved set (`run_status`,
`pipe_state`, etc.), or shebang the script `#!/usr/bin/env bash` where those
names are not reserved.

### 3. `build_type=workflow` disables branch-deploy publishing

When you set `build_type=workflow` (or via the Settings UI "GitHub Actions"
source), GitHub disables automatic publishing from pushed branches. The only
path that updates the live site is the Pages deploy action uploading an
artifact. Static files committed to `main` (or any branch) will not appear
without going through `mkdocs build` + `actions/upload-pages-artifact`.

This is the correct behavior for an mkdocs site, but it surprises engineers who
expect GitHub's default static-file serving to be a fallback.

---

## Future host onboarding checklist

For each new host repo using `framework: mkdocs`:

1. Scaffold `mkdocs.yml`, `requirements-docs.txt`, `docs/site-src/` by hand
   (or from the engineering-docs-agent dogfood as a reference).
2. Add `.github/workflows/docs-agent-pages.yml` — **without** `enablement: true`.
3. Before merging to `main`:
   ```bash
   gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
   ```
   from a personal admin login.
4. Merge to `main`. The Pages workflow fires automatically (paths filter picks
   up `docs/site-src/**` and `mkdocs.yml`).
5. Flip `.engineering-docs-agent/config.yml` fields **after** Gate 6
   (site live, HTTP 200). The publish-verifier checks the URL on the next
   nightly; flipping before the site is live produces `verify_skipped`.

Baking step 3 into the plugin's `setup_scaffold` script is filed as
plugin-side tech-debt (see Future work in the full design spec).

---

## References

- Full design spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Scaffold + deploy PR: [PR #121 / CCE-81](https://github.com/theoju/claude-code-self-assessment/pull/121)
- Post-implementation corrections PR: [PR #122](https://github.com/theoju/claude-code-self-assessment/pull/122)
- Cleanup (remove `enablement: true`): [PR #125 / CCE-82](https://github.com/theoju/claude-code-self-assessment/pull/125)
- CLAUDE.md Conventions: "actions/configure-pages@v6 enablement: true does NOT actually bootstrap GitHub Pages on a first deploy" and "Monitor scripts must use bash, not zsh's defaults"
