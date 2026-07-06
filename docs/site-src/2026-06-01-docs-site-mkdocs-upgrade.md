---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# Docs site: the mkdocs upgrade (CCE-81)

The published docs site at
[theoju.github.io/claude-code-self-assessment](https://theoju.github.io/claude-code-self-assessment/)
builds from a real mkdocs-Material scaffold, not a passthrough. Before
PR #121, `.engineering-docs-agent/config.yml` ran with `framework: none`
and `publishing.base_url: null` — the nightly's `publish-verifier` stage
skipped every run with `verify_skipped` in `partial_reasons` because
there was nothing to verify against. The config itself had documented
the intended fix ever since `framework: none` became first-class
(CCE-64):

> If you later scaffold mkdocs and add a deploy workflow, swap
> framework to mkdocs and fill in base_url + build_workflow.

CCE-81 is the PR that does that, after a spec, a plan, and a 3-agent
pre-execution validation pass that caught real blockers (broken
`.claude/`-relative links, missed path references, a missing PR-level
build gate) before merge.

## Two workflows, two responsibilities

The docs pipeline now runs as two independent CI workflows instead of
one:

| Workflow                    | Trigger                                                                 | Purpose                                                       | Secrets      |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------ |
| `docs-agent-nightly.yml`     | cron + `workflow_dispatch`                                              | Runs the plugin orchestrator; opens/updates the `docs-agent/YYYY-MM-DD` PR with authored lens pages | Claude OAuth, Jira |
| `docs-agent-pages.yml` (new) | push to `main` touching `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`, plus `workflow_dispatch` | `mkdocs build --strict` → uploads the artifact → deploys to Pages | none — `contents: read`, `pages: write`, `id-token: write` only |

They're separated on purpose: a nightly outage doesn't take the
published site down, and a Pages build break doesn't stop authoring.
`docs-agent-pages.yml` never opens PRs or writes content; it only
builds what's already on `main`.

A third workflow, `docs-build-check.yml`, gates pull requests: it runs
the same `mkdocs build --strict` (into a throwaway `/tmp/site`, no
deploy) whenever a PR touches `docs/site-src/**`, `mkdocs.yml`,
`requirements-docs.txt`, or either docs workflow file. Without this
gate, a broken internal link would only surface post-merge, when the
Pages workflow's own strict build fails against `main` — too late for
review feedback. It's a `concurrency`-cancelled group keyed on
`github.ref`, so only the latest commit on a PR branch pays the ~30s
build cost.

## What actually changed on disk

- **`mkdocs.yml`** — Material theme with `navigation.tabs`,
  `navigation.sections`, `navigation.indexes`, `navigation.top`,
  `toc.follow`, `search.suggest`, `content.code.copy`. Nav is built by
  the `literate-nav` plugin reading `docs/site-src/SUMMARY.md` rather
  than mkdocs' default alphabetical directory walk, so page order
  matches editorial intent. `docs_dir: docs/site-src`, `site_dir: site`
  (gitignored — local `mkdocs build` output never gets tracked).
- **`requirements-docs.txt`** — pinned versions: `mkdocs==1.6.1`,
  `mkdocs-material==9.5.49`, `mkdocs-awesome-pages-plugin==2.10.1`,
  `mkdocs-literate-nav==0.6.3`, `pymdown-extensions==10.11.2`. The
  `pymdown-extensions` pin matters specifically because the config uses
  `pymdownx.superfences` with a custom mermaid fence — an unpinned
  upgrade could silently change fence-rendering behavior.
- **Four previously-flat `docs/*.md` pages** — Self-Assessment, Ship
  Pattern, Boris Tips Reference, and Tip Classification — moved to
  `docs/site-src/` via `git mv`, along with `docs/images/` →
  `docs/site-src/images/`, with in-file image references and
  cross-tree links repaired to match the new layout. The move was
  deliberately verbatim: no heading changes, no prose rewrites, no
  fixing of outdated references — that's out of scope for this PR by
  design (see the design spec's non-goals).
- **`docs/site-src/index.md` and `SUMMARY.md`** — hand-authored, since
  the plugin ships no scaffold script for this (see below). `SUMMARY.md`
  is the literate-nav source of truth for sidebar order: Home,
  Self-Assessment, Ship Pattern, a Reference section (Boris Tips, Tip
  Classification), What's New.
- **Path references updated** across `README.md`, `CLAUDE.md`,
  `app/data/rubric.json`, the in-app `app/docs/ship-pattern/page.tsx`
  route, and the `self-assessment` command/skill — anywhere that still
  pointed at the old flat `docs/*.md` locations.

One thing this PR explicitly does **not** touch: `docs/superpowers/specs/`
and `docs/superpowers/plans/` stay in-repo, unpublished. The
`.engineering-docs-agent/config.yml` `lens_paths.core` flip to
`docs/site-src/` is what keeps the agent's lens analysis from recursing
into them.

## The five config flips

`.engineering-docs-agent/config.yml` changed five fields to activate
the nightly's publish-verifier stage against the new site:

```yaml
docs:
  framework: mkdocs # was: none
  whats_new_file: docs/site-src/whats-new.md # was: docs/whats-new.md
  lens_paths:
    core: docs/site-src/ # was: docs/

publishing:
  base_url: https://theoju.github.io/claude-code-self-assessment/ # was: null
  build_workflow: docs-agent-pages.yml # was: null
```

With `framework: mkdocs`, the publish-verifier now checks that
`build_workflow` ran for the current `main` HEAD and that `base_url`
plus each lens page resolves within `verify_timeout_seconds: 60`. A
failed check adds `verify_failed` to `partial_reasons` — it doesn't
block the nightly run, it just flags the gap for the next cycle to
notice.

## No scaffold script — this was hand-authored

Worth calling out because it'll bite the next host repo doing the same
upgrade: the engineering-docs-agent plugin does not ship a
`setup_scaffold` script. Its `scripts/` directory only has
`setup_discover.py` (read-only discovery), and `templates/` holds
workflow YAML and JSON schemas, not an mkdocs scaffold. Everything
under "What actually changed on disk" above — `mkdocs.yml`,
`requirements-docs.txt`, `docs-agent-pages.yml`, `index.md`,
`SUMMARY.md`, `whats-new.md` — was authored by hand against a working
reference (the plugin's own dogfooded mkdocs setup), not generated.
This is filed as plugin-side tech debt; a future host taking the same
path repeats this manual work until the plugin grows the script.

## Two items still open

The PR body flags two verification steps that hadn't landed by merge
time and are worth confirming before treating this migration as fully
closed out:

1. **GitHub Pages auto-deploy actually firing** from
   `docs-agent-pages.yml` on a push to `main`.
2. **The next scheduled nightly completing cleanly** against
   `framework: mkdocs` — i.e., no `verify_skipped` or `verify_failed`
   in `partial_reasons`.

Related historical note, if you're troubleshooting a first-deploy
failure on a similar setup: `actions/configure-pages@v6`'s
`enablement: true` does not actually bootstrap Pages on a repo's very
first deploy — the workflow's default `GITHUB_TOKEN` lacks the admin
scope `POST /repos/.../pages` needs, and `permissions:` blocks can only
restrict a token's scopes, never expand them. The fix is a one-time
`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` run
from an admin login (or the equivalent Settings → Pages → Build and
deployment → Source = "GitHub Actions" UI path) before the first
deploy; after that, `enablement: true` is a permanent no-op. See
`CLAUDE.md`'s Conventions section for the full incident writeup.

## Where the design detail lives

The full spec and rollout plan — architecture rationale, the 9-gate
rollout sequence, the rollback decision tree, and the verification
matrix — are source-tree planning docs, not published lens pages:

- `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- `docs/superpowers/plans/2026-06-01-mkdocs-upgrade.md`
