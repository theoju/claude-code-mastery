---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/125
synthesized_into: []
doc_kind: decision
---

# Decision: drop `enablement: true` from the Pages deploy workflow

**PR:** [#125](https://github.com/theoju/claude-code-self-assessment/pull/125) · **Ticket:** CCE-82 · **Date:** 2026-06-02

## What changed

`.github/workflows/docs-agent-pages.yml`'s `configure-pages@v6` step used to
carry an `enablement: true` field. PR #125 removes it. The rest of the step
is unchanged:

```yaml
- uses: actions/configure-pages@v6
```

The matching vitest assertion in `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`
was flipped from an assertion the line existed to a regression guard:

```js
expect(body).not.toMatch(/enablement:\s*['"]?true['"]?/);
```

`CLAUDE.md` and `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
were also updated to record the real bootstrap mechanism (below), so the next
person reading either doc doesn't repeat the mistake this PR is cleaning up.

## Why

`enablement: true` reads like it should bootstrap GitHub Pages on a repo's
first deploy — that's the field's name and what the action's docs imply.
It doesn't. The workflow's default `GITHUB_TOKEN` doesn't carry the admin
scope `POST /repos/<owner>/<repo>/pages` requires, and a workflow's
`permissions:` block can only **restrict** the default token's scopes, never
expand them. `permissions: pages: write` in this repo's workflow does not
help here — write access to an existing Pages site is a different privilege
than creating one.

That gap surfaced for real during the mkdocs-upgrade onboarding cycle
(CCE-81, 2026-06-02): the first push-triggered run of `docs-agent-pages.yml`
against the newly-merged scaffold failed at the `configure-pages@v6` step
with `Resource not accessible by integration`. The fix was a one-time,
out-of-band call from an admin `gh` login:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow
```

(equivalently: Settings → Pages → Build and deployment → Source = "GitHub
Actions"). Once Pages exists via either path, `build_type=workflow` is
durable — every subsequent push-triggered run of `docs-agent-pages.yml`
deploys cleanly, and `enablement: true` becomes a silent no-op. So the field
was never doing useful work: misleading before Pages existed, dead weight
after. PR #125 deletes it from this repo's own workflow as the
consumer-side half of CCE-82; the durable fix on the producer side lives in
the engineering-docs-agent plugin (`theoju/engineering-docs-agent` PR #103),
which is where future host repos onboarded with `framework: mkdocs` should
get this handled automatically going forward.

## What this means for you

Nothing changes about how you deploy. If you're onboarding a **new** repo
onto this same mkdocs + Pages pattern, the one-time `gh api -X POST
.../pages -f build_type=workflow` call (or the equivalent Settings → Pages
UI toggle) still has to happen once, by hand, from an account with admin
rights on the repo, before the first push-triggered deploy. No workflow YAML
field does it for you.

## Sources

- [PR #125](https://github.com/theoju/claude-code-self-assessment/pull/125)
- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — "Post-implementation correction" note under Gate 5
- `CLAUDE.md` — Conventions section, `actions/configure-pages@v6 enablement: true` entry
