---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
---

# Pages bootstrap fix — CCE-82 consumer-side mirror

**Date:** 2026-06-03  
**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125)  
**Related:** CCE-81 (PR #121 incident) · CCE-82 (engineering-docs-agent#103, plugin-side fix)

## What happened

The `docs-agent-pages.yml` GitHub Actions workflow contained this line:

```yaml
- uses: actions/configure-pages@v6
  with:
    enablement: true
```

`enablement: true` implies that the action can bootstrap GitHub Pages on a
first deploy. It cannot. The `GITHUB_TOKEN` that workflows run under lacks the
admin scope required to call `POST /repos/.../pages`. The very first run of the
deploy workflow fails with `Resource not accessible by integration` regardless
of the `permissions: pages: write` declaration — `permissions:` can only
restrict the default token's scopes, never expand them.

The line was therefore a no-op on any repo where Pages was already set up, and
silently misleading on any repo that hadn't yet bootstrapped Pages. The CCE-81
incident (PR #121) hit exactly this: `enablement: true` masked the fact that
Pages had not been bootstrapped, leading to a failed first deploy that was
initially diagnosed as a workflow misconfiguration rather than a missing Pages
setup step.

## The actual bootstrap path

To bootstrap Pages for the first time on a repo, run this from a personal or
admin `gh` login — **not** from a workflow token:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

Equivalent UI path: **Settings → Pages → Build and deployment → Source →
"GitHub Actions"**.

`build_type=workflow` is durable. Once set, all subsequent push-triggered runs
of `docs-agent-pages.yml` work cleanly. The `enablement: true` line is
meaningless after that point and should not exist in the workflow.

## What PR #125 changes

Three files, no behavioral change:

1. **`docs-agent-pages.yml`** — `enablement: true` removed from the
   `actions/configure-pages@v6` step. The step itself stays; it still
   configures the base URL for the site; it just no longer carries a field
   that implies admin capability it doesn't have.

2. **`scripts/__tests__/docs-mkdocs-scaffold.test.mjs`** — the existing test
   that checked workflow structure is flipped into a regression guard: it now
   asserts `enablement: true` is **absent**. The line cannot silently
   re-appear through a future copy-paste or template merge.

3. **`CLAUDE.md`** — the Pages-bootstrap gotcha bullet is shortened to defer
   to the plugin's own CLAUDE.md as the durable source of truth. The
   per-repo detail is preserved in `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
   under the "Post-implementation correction" block, which gained a one-line
   "Resolved by PR #125" footer.

## Why the durable fix is on the plugin side

The root-cause fix lives in
[engineering-docs-agent#103](https://github.com/theoju/engineering-docs-agent/pull/103)
(CCE-82). Future host repos onboarded by the plugin will get a workflow that
never contained `enablement: true` in the first place, and the plugin's own
CLAUDE.md now documents the `gh api` bootstrap call as a required onboarding
step before the first deploy.

PR #125 is the already-onboarded repo's mirror: it removes the no-op from the
live workflow and adds the guard so the fix doesn't regress.

## Gotcha: test guards on workflow structure

The regression test checks for the **absence** of a field. This pattern is
worth knowing: testing that a removed footgun stays removed is as valid as
testing that a required piece is present. Absence assertions in workflow
structure tests are the right tool when the risk is "someone copy-pastes a
template with the bad field back in."
