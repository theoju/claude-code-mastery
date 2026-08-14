---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
doc_kind: decision
---

# Decision: move the docs site from `framework: none` to `framework: mkdocs`

## Context

The engineering-docs-agent integration for this repo (CCE-57) originally
shipped with `docs.framework: none` in `.engineering-docs-agent/config.yml`
and `publishing.base_url: null`. Under that config, `docs/*.md` was plain
markdown rendered ad hoc by GitHub's blob viewer — no nav, no search, no
canonical published URL. The nightly orchestrator's publish-verifier stage
skipped every run with `verify_skipped` in `partial_reasons` (CCE-64),
because there was nothing published to check reachability against. The
config file itself documented the intended escape hatch: swap `framework`
to `mkdocs`, add a deploy workflow, and fill in `base_url` +
`build_workflow` once a real site exists.

The plugin does not ship a `setup_scaffold` step that generates that
site for you — the mkdocs config, requirements file, and Pages workflow all
had to be hand-authored, using the engineering-docs-agent plugin's own
dogfood site as the working reference. That gap is real plugin-side
tech-debt, filed separately against the plugin rather than worked around
here.

## Decision

Flip the docs pipeline to `framework: mkdocs`, in one bottom-up PR (#121,
CCE-81):

1. Hand-author the scaffold first — `mkdocs.yml` (Material theme +
   `search` + `awesome-pages` + `literate-nav`, no Python-only plugins like
   `mkdocstrings`), a pinned `requirements-docs.txt`, and `docs/site-src/`
   as the new `docs_dir` — and verify it builds locally
   (`mkdocs build --strict`) before touching CI or config.
2. Add two GitHub Actions workflows with separated responsibilities:
   `docs-agent-pages.yml` (push-to-`main` build + deploy via
   `configure-pages` → `mkdocs build --strict` → `upload-pages-artifact` →
   `deploy-pages`) and `docs-build-check.yml` (the same strict build as a
   PR-level gate, no deploy). Splitting them means a Pages outage can't
   block authoring, and a broken link fails the PR instead of surfacing
   only after a post-merge deploy.
3. Migrate the four existing `docs/*.md` files and the `docs/images/`
   directory into `docs/site-src/` **verbatim** via `git mv` — no content
   rewriting, no heading changes in this PR. Fix only what strict mode
   actually breaks: relative links that resolved under GitHub's renderer
   but point outside the new `docs_dir` (into `.claude/` or
   `docs/superpowers/specs/`) get rewritten to absolute GitHub blob URLs,
   since `mkdocs build --strict` rejects link targets outside `docs_dir`.
4. Flip the five `.engineering-docs-agent/config.yml` fields last, only
   after the scaffold builds and the workflow exists to point at:
   `framework: mkdocs`, `whats_new_file: docs/site-src/whats-new.md`,
   `lens_paths.core: docs/site-src/`, `publishing.base_url:
   https://theoju.github.io/claude-code-self-assessment/`, and
   `publishing.build_workflow: docs-agent-pages.yml`. This activation
   order matters: flipping `framework` first, before a working build
   exists to publish, would immediately turn `verify_skipped` into a hard
   `verify_failed` instead of fixing it.

`docs/superpowers/specs/` and `docs/superpowers/plans/` deliberately stay
outside `docs_dir` — they're in-repo design history for plugin lens
analysis, not user-facing site content. The `lens_paths.core` change to
`docs/site-src/` is what keeps the agent's per-lens page authoring scoped
to the published tree rather than recursing into that design-history
directory.

## Alternatives considered

- **Keep `framework: none` and live with `verify_skipped`.** Rejected —
  the publish-verifier stage exists specifically to catch a docs pipeline
  that silently stops publishing; permanently skipping it defeats the
  point of having the stage.
- **Restructure the information architecture while migrating.** Rejected
  for this PR. The four existing docs moved flat, unchanged, into
  `docs/site-src/`; any IA reshaping (subpaths under the `core` lens,
  cross-linking specs into the published site) is deferred until the
  agent has a few nightly cycles of authored output to react to, so
  restructuring decisions are informed by real generated content rather
  than guessed upfront.
- **Add `mkdocstrings` for TypeScript API docs.** Rejected — `app/`,
  `scripts/`, and `lib/` are the dashboard's implementation, not a public
  API surface worth generating reference docs for.
- **Wait for the plugin to ship a `setup_scaffold` script.** Rejected as
  a blocker — the script doesn't exist yet, and the dogfood site was a
  good enough reference to hand-author the scaffold now rather than stall
  on plugin-side work. The missing script is tracked as a separate
  plugin-side follow-up.

## Consequences

- The docs site is live and reachable at
  <https://theoju.github.io/claude-code-self-assessment/>, with search,
  a Material theme, and a literate-nav (`docs/site-src/SUMMARY.md`) that
  makes adding a page a one-line diff instead of a `mkdocs.yml` edit.
- `docs/site-src/**` is now a CI-gated surface: `docs-build-check.yml`
  fails any PR that breaks an internal link or drops a page from nav,
  before it merges — not after a broken Pages deploy is noticed.
- `docs.agent_editable_paths` in `.engineering-docs-agent/config.yml` is
  scoped to `docs/**`, but the scaffold files themselves
  (`mkdocs.yml`, `requirements-docs.txt`, the workflow YAML) live outside
  that tree and had to be hand-authored in the originating PR — future
  scaffold changes (theme, plugin set, CI structure) are a manual,
  human-reviewed edit, not something the nightly orchestrator can touch.
- The first push-triggered run of `docs-agent-pages.yml` failed with
  `Resource not accessible by integration`: `actions/configure-pages@v6`'s
  `enablement: true` does not actually bootstrap Pages on a repo where it
  has never been turned on, because the workflow's default `GITHUB_TOKEN`
  lacks the admin scope `POST /repos/.../pages` requires. Recovery was a
  one-time `gh api -X POST repos/theoju/claude-code-self-assessment/pages
  -f build_type=workflow` from an admin login, after which every
  subsequent run succeeded normally. The misleading `enablement: true`
  line was later removed from `docs-agent-pages.yml` (PR #125, CCE-82) —
  see the architecture page for the current state of that workflow.
- Rollback, if ever needed, is a one-line revert: flip
  `framework`/`base_url`/`build_workflow` back to their `none`/`null`
  originals. The scaffold and workflows can stay in place unused — there's
  no cost to having them idle.

## References

- Design spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
  (includes a post-implementation correction documenting the
  `configure-pages@v6` bootstrap gap above).
- Architecture of the resulting site: [Docs site architecture](2026-06-02-mkdocs-docs-site.md).
- Tickets: CCE-57 (original engineering-docs-agent integration),
  CCE-64 (`framework: none` / `verify_skipped` baseline), CCE-81 (this
  upgrade), CCE-82 (the `enablement: true` cleanup follow-up).
