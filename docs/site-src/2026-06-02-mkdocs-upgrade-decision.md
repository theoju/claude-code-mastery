---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: upgrade engineering-docs-agent to `framework: mkdocs`

**Date:** 2026-06-02  
**PR:** [#121](https://github.com/theoju/claude-code-self-assessment/pull/121)  
**Outcome:** Accepted — published docs site live at <https://theoju.github.io/claude-code-self-assessment/>

## Context

The `.engineering-docs-agent/config.yml` had been set to `framework: none` since
the docs agent was first wired up. That choice was deliberate: the upgrade path was
already documented in the agent config spec (`swap framework to mkdocs and fill in
base_url + build_workflow`), but the preconditions — a clean `docs/site-src/`
structure, working relative links, and a CI gate — weren't met yet.

With those preconditions now satisfiable, the framework upgrade unblocked the
nightly agent's publish-verifier stage, which had been skipping with
`verify_skipped` on every run.

## Decision

Switch `.engineering-docs-agent/config.yml` from `framework: none` to
`framework: mkdocs`, scaffold the build toolchain, and activate the
publish-verifier stage.

### What was scaffolded

| Artifact | Purpose |
|---|---|
| `mkdocs.yml` | Material theme config with `search`, `awesome-pages`, and `literate-nav` plugins |
| `requirements-docs.txt` | Five pinned Python dependencies for reproducible builds |
| `docs/site-src/` | New canonical source root; existing `docs/*.md` files migrated here with broken relative links repaired |
| `.github/workflows/docs-agent-pages.yml` | Push-to-main deployment via GitHub Pages artifact upload |
| `.github/workflows/docs-build-check.yml` | PR-level `mkdocs build --strict` gate |

Three new vitest test files (21 cases) cover path migration correctness, scaffold
existence and content, and the config contract.

## Alternatives considered

**Keep `framework: none` indefinitely.** The agent would continue skipping the
publish-verifier stage. Documentation would exist only as local markdown with no
published URL, reducing discoverability and losing the nightly freshness check.
Rejected: the upgrade path was explicitly pre-planned and the preconditions were met.

**Use a different static-site generator (Docusaurus, Astro, etc.).**
The engineering-docs-agent's built-in toolchain support targets mkdocs; a different
generator would require custom build-workflow integration outside the agent's scope.
Rejected: unnecessary complexity given the existing mkdocs support path.

## Pre-execution validation

Three independent validation agents ran before implementation and identified real
blockers:

1. **Broken `.claude/` cross-tree links** — paths in `.claude/commands/` referenced
   files relative to a directory structure that the migration would change.
2. **Missed path refs in `.claude/commands/`** — several slash-command files
   contained hardcoded relative paths that didn't account for the new `docs/site-src/`
   root.
3. **Missing CI gate** — without a `mkdocs build --strict` check on PRs, a broken
   internal link could land on `main` and fail the nightly publish silently.

All three were resolved before the migration ran. This validated the three-agent
pre-execution review approach: each agent independently identified a distinct failure
class that would have caused a post-merge regression.

## Post-merge incident: `configure-pages@v6 enablement: true`

The initial deploy failed. The `actions/configure-pages@v6` action's `enablement:
true` field does **not** bootstrap GitHub Pages on a first deploy — despite the
field name and the upstream action documentation. The workflow's `GITHUB_TOKEN`
lacks the admin scope required to call `POST /repos/.../pages`, and
`permissions: pages: write` can only restrict the default token's scopes, never
expand them.

**Recovery:** GitHub Pages was bootstrapped manually with:

```bash
gh api -X POST repos/theoju/claude-code-self-assessment/pages \
  -f build_type=workflow
```

`build_type=workflow` is durable — once set, subsequent push-triggered runs of
`docs-agent-pages.yml` work without any admin intervention, and the `enablement:
true` line in the workflow becomes a permanent no-op. The line was removed in this
same PR cycle.

For future repos using `framework: mkdocs`, this `gh api` call should run during
initial onboarding, before the first push-triggered deploy.

## Consequences

- **Published docs site** at <https://theoju.github.io/claude-code-self-assessment/>,
  rebuilt on every push to `main`.
- **Nightly publish-verifier** now runs instead of skipping; broken links or
  missing pages surface within 24 hours of a bad merge.
- **PR-level build gate** (`docs-build-check.yml`) catches `mkdocs build --strict`
  failures before they reach `main`.
- **Lens content** (`lens_paths.core: docs/site-src/`) is now the active source
  for the nightly agent's page authoring and gap-filling runs.
- **First-deploy footgun** documented in `CLAUDE.md` under the `configure-pages`
  convention entry; future host onboarding should bake the `gh api` call into the
  `setup_scaffold` script.
