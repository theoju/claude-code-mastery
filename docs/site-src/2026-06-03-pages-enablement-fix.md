---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# Decision: Remove `enablement: true` from `configure-pages@v6`

**Date:** 2026-06-03  
**Ticket:** CCE-82  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)

## Problem

The `docs-agent-pages.yml` deploy workflow included `enablement: true` on
the `actions/configure-pages@v6` step:

```yaml
- uses: actions/configure-pages@v6
  with:
    enablement: true
```

During the v0.9.20 onboarding incident (PR #121 / CCE-81), this line caused
active confusion. It reads as though the action can bootstrap GitHub Pages
on a brand-new repository — but it cannot. The `GITHUB_TOKEN` that GitHub
Actions provides lacks the admin scope required to call `POST /repos/.../pages`.
On a first deploy, the step fails with:

```
Resource not accessible by integration
```

Even with `permissions: pages: write` declared in the workflow, `permissions:`
can only restrict the default token's granted scopes, never expand them. Once
Pages was manually bootstrapped via `gh api`, `enablement: true` became a
silent no-op on every subsequent run. The field's presence implied an
authoritative capability that does not exist.

## Decision

Remove `enablement: true`. The field is permanently non-functional for the
`build_type=workflow` publishing path and misleads future maintainers who see
it and assume it handles first-deploy bootstrapping.

## Bootstrap procedure (one-time, per host repo)

Before the first deploy of a new repository, run:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

This requires a personal or admin `gh` login (not the default Actions token).
Equivalent UI path: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Once set, `build_type=workflow` is durable. All subsequent push-triggered
runs of `docs-agent-pages.yml` work without any `enablement:` field.

## Regression guard

A companion vitest assertion was flipped to catch re-introduction. The test
asserts that the `configure-pages` step in `docs-agent-pages.yml` does **not**
contain an `enablement: true` line. Any PR that adds it back fails CI.

## Related

- PR #121 (CCE-81) — the onboarding incident that surfaced this; full
  incident timeline in
  `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` →
  "Post-implementation correction"
- engineering-docs-agent PR #103 — the consumer-side mirror of this fix,
  which removed `enablement: true` from the plugin's workflow template
- CLAUDE.md convention note: "GitHub Pages bootstrapping — `enablement: true`
  does NOT bootstrap Pages on first deploy" (shortened to reflect resolved
  state post-CCE-82)
