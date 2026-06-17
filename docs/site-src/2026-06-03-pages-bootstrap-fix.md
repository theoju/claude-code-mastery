---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# Decision: Drop `enablement: true` from the Pages Workflow (CCE-82)

**Date:** 2026-06-02  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)  
**Ticket:** CCE-82  
**Companion:** theoju/engineering-docs-agent PR #103 (plugin-side mirror)

## Context

During the CCE-81 / PR #121 mkdocs upgrade, the initial design spec assumed
that `actions/configure-pages@v6` with `enablement: true` would programmatically
bootstrap GitHub Pages on the first push-triggered run. The spec's Gate 5 read:

> The `enablement: true` flag works programmatically with the workflow's
> `pages: write` + `id-token: write` permissions. If it fails, the workflow
> exits non-zero — no silent skip.

That assumption was wrong. The first run of `docs-agent-pages.yml` against
merge commit `6369065` failed with:

```
Resource not accessible by integration
```

The root cause: `GITHUB_TOKEN`'s default permission set doesn't include the
admin scope required for `POST /repos/.../pages`. The `permissions:` block in
a workflow YAML can only *restrict* the default token's scopes — it can never
expand them. `enablement: true` is therefore incapable of bootstrapping a
repo where Pages has never been enabled, regardless of what `pages: write`
looks like in the workflow header.

**Actual recovery (CCE-81):**

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
```

Run from a personal admin GitHub login. Then:

```bash
gh workflow run docs-agent-pages.yml --ref main
```

The dispatched run succeeded (build: 16s, deploy: 8s) and the site came live
at `https://theoju.github.io/claude-code-self-assessment/` within ~90s.

Once Pages exists, `enablement: true` becomes a permanent silent no-op. The
line was doing nothing useful for the already-onboarded repo and was actively
misleading for anyone reading the workflow expecting it to handle fresh-repo
bootstrapping.

## Decision

Remove `enablement: true` from `.github/workflows/docs-agent-pages.yml`
entirely. The `configure-pages@v6` step remains — it still sets up the Pages
artifact upload path — but with no `with:` block.

The workflow after this change:

```yaml
- uses: actions/configure-pages@v6
```

No `with: enablement: true` below it.

## Consequences

**For the already-onboarded repo (this one):** no behavioral change. Pages
was already bootstrapped; the line was never doing anything.

**For future host repos:** the `gh api` call is now the documented
bootstrapping path, not a workflow flag. The equivalent UI path is:

> Settings → Pages → Build and deployment → Source = "GitHub Actions"

`build_type=workflow` is durable — once set, all subsequent push-triggered
runs of `docs-agent-pages.yml` work cleanly, and the `configure-pages@v6`
step is no longer misleading.

**Regression guard:** `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`
asserts the line is absent:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

Any re-introduction of `enablement: true` in the workflow fails CI.

## What changed in this PR

| File | Change |
|---|---|
| `.github/workflows/docs-agent-pages.yml` | Dropped the `with: enablement: true` block from the `configure-pages@v6` step |
| `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` | Flipped the test from asserting the line present to asserting its absence |
| `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` | Added "Resolved by PR #125 + engineering-docs-agent PR #103" to the POST-IMPLEMENTATION CORRECTION block |
| `CLAUDE.md` | Shortened the `enablement: true` gotcha bullet to point at the plugin's CLAUDE.md as the durable source |

No dashboard logic, scoring pipeline, or assessment data was touched.

## Durable onboarding fix

The companion plugin PR (theoju/engineering-docs-agent#103) removed
`enablement: true` from the scaffold template the plugin writes for new host
repos. Future hosts that onboard via the plugin's `setup_scaffold` step will
never see the misleading flag.

For host repos that hand-authored their workflow from the old design spec, the
remediation is a one-line removal from `docs-agent-pages.yml` — or running
this repo's workflow as the authoritative reference. The `gh api` bootstrap
call belongs in the onboarding runbook (or ideally in the plugin's
`setup_scaffold` script when that is eventually built — see Open Question §2
in the upgrade spec).
