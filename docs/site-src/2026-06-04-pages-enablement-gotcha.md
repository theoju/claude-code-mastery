---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# `enablement: true` doesn't bootstrap GitHub Pages

**Date:** 2026-06-04  
**PR:** #125 (CCE-82)  
**Incident:** CCE-81 / PR #121 host onboarding

## What happened

When the mkdocs docs site scaffold landed (PR #121, CCE-81), the new
`docs-agent-pages.yml` workflow included `enablement: true` on the
`actions/configure-pages@v6` step:

```yaml
- uses: actions/configure-pages@v6
  with:
    enablement: true
```

The intent was to programmatically bootstrap GitHub Pages on the
first deploy so no manual Settings UI click was needed. It doesn't
work. The first push-triggered run failed at that step with:

```
Resource not accessible by integration
```

The debugging session ran approximately 45 minutes before the root
cause was identified.

## Why it fails

The workflow declares:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

`pages: write` allows the token to upload and deploy artifacts to an
*existing* Pages environment. It does not grant admin scope.
Bootstrapping Pages for the first time calls
`POST /repos/.../pages`, which requires admin. The `permissions:`
block can only *restrict* the default `GITHUB_TOKEN`'s scopes —
it cannot expand them past what the token is issued with.
`enablement: true` is documented as if it can self-enable Pages, but
the underlying API call hits this ceiling and returns 403.

Once Pages already exists (created by any means), `enablement: true`
becomes a permanent silent no-op. The action continues to run without
error and without effect.

## The correct bootstrap

Do exactly one of the following before the first workflow run on any
new host repo:

**Option A — CLI (preferred for automated onboarding):**

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Run this from a personal or admin `gh` session — not the Actions
token. `build_type=workflow` is durable: once set, all subsequent
push-triggered runs of the Pages workflow work without further
intervention.

**Option B — GitHub UI:**

Settings → Pages → Build and deployment → Source = "GitHub Actions"

After bootstrapping by either path, dispatch the workflow once
manually to confirm:

```bash
gh workflow run docs-agent-pages.yml --ref main
```

Note that `build_type=workflow` disables branch-deploy publishing.
After this, the only path to `theoju.github.io/<repo>/` is via the
`actions/deploy-pages@v5` artifact upload — which is exactly what
this workflow uses, but worth knowing if static files committed to
`main` don't appear on the live site.

## What PR #125 changed

**Removed** `enablement: true` from `.github/workflows/docs-agent-pages.yml`.
The `actions/configure-pages@v6` step now runs with no `with:` block.
Confirmed in the live file:

```yaml
- uses: actions/configure-pages@v6
```

**Added a regression test** in
`scripts/__tests__/docs-mkdocs-scaffold.test.mjs` that asserts the
misleading field is absent from the workflow:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

**Added a CLAUDE.md Conventions bullet** documenting the gotcha,
the correct `gh api` bootstrap path, and the `build_type=workflow`
side-effect for future contributors.

**Appended a post-implementation correction** to
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` § Gate 5,
replacing the original (incorrect) claim that `enablement: true`
"programmatically enables Pages on first run" with the actual recovery
sequence.

## Decision record

Keep the admin-scoped `gh api` call out of the recurring workflow.
A one-time setup operation with a different permission class belongs
in a setup script or runbook, not in a CI job that fires on every
docs push. The correct long-term home is the engineering-docs-agent
plugin's `setup_scaffold` step (filed as plugin-side tech-debt; see
PR #125 description and PR #103 on the plugin repo). In the interim,
any new host repo onboarding under `framework: mkdocs` must run the
`gh api` call — or the equivalent UI step — before the first merge to
`main` that touches the `docs/site-src/**` path filter.
