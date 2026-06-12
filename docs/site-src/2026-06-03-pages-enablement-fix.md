---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# Decision: drop `enablement: true` from `configure-pages@v6`

**PR #125 · 2026-06-03 · CCE-82**

## What changed

The `enablement: true` parameter was removed from the `actions/configure-pages@v6`
step in `.github/workflows/docs-agent-pages.yml`. The step now reads:

```yaml
- uses: actions/configure-pages@v6
```

A regression-guard assertion was added to
`scripts/__tests__/docs-mkdocs-scaffold.test.mjs` that will fail CI if the
line is re-introduced:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

## Why

`enablement: true` does not bootstrap GitHub Pages on a first deploy. The
workflow's `GITHUB_TOKEN` only carries the scopes declared in `permissions:`
(`pages: write`, `id-token: write`, `contents: read`); it cannot call the
`POST /repos/.../pages` admin endpoint that actually enables the Pages
feature. The very first run fails with `Resource not accessible by
integration`.

Once Pages is already enabled — via `gh api -X POST repos/<owner>/<repo>/pages
-f build_type=workflow` or via Settings → Pages in the GitHub UI — the flag
becomes a permanent silent no-op. Keeping it in the workflow was misleading
because it implied the workflow was self-bootstrapping when it was not.

## How to bootstrap Pages on a new host

`enablement: true` never worked for first-run bootstrapping. The one-time
setup step is manual:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Run this from a personal or admin `gh` login before the first deploy. The
equivalent UI path is Settings → Pages → Build and deployment → Source →
"GitHub Actions". Either way, `build_type=workflow` is durable — all
subsequent push-triggered runs of `docs-agent-pages.yml` deploy cleanly
once it is set.

The durable fix for the engineering-docs-agent plugin (so future hosts are
scaffolded correctly) is tracked in
[theoju/engineering-docs-agent PR #103](https://github.com/theoju/engineering-docs-agent/pull/103).
The consumer-side change here removes the misleading line from this repo's
workflow and locks it out via the test above.

## Context

This was surfaced during the v0.9.20 onboarding incident (PR #121 / CCE-81),
where the initial `docs-agent-pages.yml` run failed because Pages had not been
enabled in Settings before the first push. The `enablement: true` field gave
the false impression that the workflow would handle that step itself.

Full incident detail is in
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` under "Post-implementation
correction."
