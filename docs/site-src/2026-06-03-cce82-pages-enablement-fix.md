---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# CCE-82: Drop `enablement: true` from the Pages Workflow

**Date:** 2026-06-03  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)  
**Ticket:** CCE-82

## Decision

Remove the `enablement: true` field from `actions/configure-pages@v6` in
`.github/workflows/docs-agent-pages.yml`. Add a vitest regression guard that
rejects any re-introduction of the field. No behavior changes — Pages was
already bootstrapped manually during the CCE-81 recovery.

## Context

PR #121 (CCE-81) stood up the mkdocs site and GitHub Pages deployment. The
original design spec
(`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`) called for
`configure-pages@v6` with `enablement: true` to bootstrap Pages on the first
workflow run.

That assumption turned out to be wrong. `GITHUB_TOKEN` — even with
`permissions: pages: write` declared — lacks the admin scope required to call
`POST /repos/.../pages`. The `enablement: true` field is permanently
non-functional in this context: it fails on the first run (before Pages
exists) with `Resource not accessible by integration`, and becomes a silent
no-op on every subsequent run (after Pages is bootstrapped some other way).
`permissions:` can only restrict the default token's scopes, never expand them.

During the CCE-81 incident, Pages was bootstrapped by running this from an
admin `gh` login:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
```

`build_type=workflow` is durable. Once set, all subsequent push-triggered runs
of `docs-agent-pages.yml` deploy cleanly and the `enablement: true` line is
meaningless — but it looks authoritative to future readers and misleads anyone
onboarding a new host repo. The engineering-docs-agent plugin (PR #103) landed
the same cleanup on the plugin side (CCE-82); this PR mirrors it to the
already-onboarded consumer repo.

## What changed

**`.github/workflows/docs-agent-pages.yml`** — `enablement: true` field and
its associated comment block removed from the `actions/configure-pages@v6`
step. The step itself remains; it still sets up the Pages environment for the
`deploy-pages` action. The final workflow structure is:

```yaml
- uses: actions/configure-pages@v6
# no enablement: true — see CCE-82
```

**`scripts/__tests__/docs-mkdocs-scaffold.test.mjs`** — the existing
`docs-agent-pages.yml` test gained a negative assertion:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

This is a regression guard, not a behavioral test. It fails CI if the field is
re-introduced without understanding why it was removed.

**`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`** — a
one-line resolution footer was appended to the POST-IMPLEMENTATION CORRECTION
block, noting the CCE-82 cleanup.

**`CLAUDE.md`** — the Pages-enablement gotcha bullet was shortened to point at
the engineering-docs-agent plugin's CLAUDE.md as the durable authoritative
source, rather than repeating the full incident write-up inline.

## What did not change

No scoring logic, application code, or content was touched. The docs site at
`https://theoju.github.io/claude-code-self-assessment/` continues to deploy
from every push to `main` that touches `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or `.github/workflows/docs-agent-pages.yml`.

## Onboarding implication

If you are bootstrapping Pages for a new host repo using the
`engineering-docs-agent` plugin with `framework: mkdocs`, the one required
manual step is:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Run this once from an admin `gh` login before the first workflow push. After
that, the workflow deploys without any `enablement:` field. See the
engineering-docs-agent plugin's CLAUDE.md for the full onboarding procedure.
