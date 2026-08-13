---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# GitHub Pages enablement fix (CCE-81 → CCE-82)

`actions/configure-pages@v6`'s `enablement: true` field looked like it would
bootstrap GitHub Pages on first deploy. It doesn't, and PR #125 removes it
from `docs-agent-pages.yml` for that reason.

## What `enablement: true` actually does

The field's name and the action's docs suggest it enables Pages
programmatically if it isn't already turned on. In practice, the workflow's
default `GITHUB_TOKEN` lacks the admin scope `POST /repos/.../pages`
requires, and the `permissions:` block at the top of a workflow can only
**restrict** that token's scopes — never expand them. Declaring
`pages: write` and `id-token: write` (as `docs-agent-pages.yml` does) doesn't
help; those permissions govern the Pages deployment API, not the
site-creation API.

The first push-triggered run of `docs-agent-pages.yml` against this repo hit
exactly this: it failed at the `configure-pages@v6` step with `Resource not
accessible by integration`. Once Pages exists — by any path — `enablement:
true` becomes a silent no-op forever, which is why the field can sit in a
workflow for a while looking harmless before the gap surfaces on a repo's
very first deploy.

## The fix that shipped

The durable bootstrap step is a one-time, admin-authenticated API call, run
before the first deploy:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

(Equivalent UI path: repo Settings → Pages → Build and deployment → Source =
"GitHub Actions".) `build_type=workflow` is durable — once set, every
subsequent push-triggered run of the Pages workflow works cleanly, and
nothing about `enablement: true` was ever needed after that point.

PR #125 does the cleanup implied by that finding:

- Removes the `enablement: true` field (and its accompanying comment) from
  `docs-agent-pages.yml`'s `configure-pages@v6` step, since it never
  bootstrapped anything on this repo and is a no-op now that Pages already
  exists.
- Turns the corresponding check in
  `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` into a regression guard:
  the workflow-file test now asserts `enablement:\s*['"]?true['"]?` does
  **not** appear in the workflow body, so the line can't quietly come back.
- Appends a one-line "Resolved by" note to the existing POST-IMPLEMENTATION
  CORRECTION block in
  `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`, closing the
  loop that block left open.
- Shortens the corresponding CLAUDE.md gotcha bullet to point at the
  engineering-docs-agent plugin's own CLAUDE.md as the durable source of the
  fix, rather than re-explaining the root cause inline in two places.

## Where the durable fix lives now

The plugin-side companion, tracked as CCE-82, is the source of truth for
future host repos: it bakes the `gh api ... build_type=workflow` bootstrap
call into the engineering-docs-agent setup flow so a new host onboarding
onto `framework: mkdocs` doesn't have to rediscover this the hard way. This
repo's incident — tracked as CCE-81 — was the one host repo that had already
hit the gap manually; PR #125 mirrors the plugin's fix back into it rather
than duplicating the explanation.

If you're setting up Pages for a new host repo, treat `enablement: true` as
something to leave out of the workflow from the start, and run the `gh api`
bootstrap call (or the plugin's equivalent) before the first push-triggered
deploy.
