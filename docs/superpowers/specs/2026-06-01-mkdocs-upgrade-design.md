# Path A: MkDocs Upgrade for engineering-docs-agent — Design

**Status:** Spec (pre-implementation)
**Date:** 2026-06-01
**Ticket:** CCE-XX — placeholder; resolve to a real key (existing or new) BEFORE opening the PR. See Open Questions §1 for the search-then-file procedure.
**Author flow:** Brainstorm → Spec → Plan → Implementation (this is the Spec)

## Context

The host repo (`theoju/claude-code-self-assessment`) has the
engineering-docs-agent plugin installed via
`.engineering-docs-agent/config.yml` with `framework: none` and
`publishing.base_url: null`. The docs/ directory holds plain markdown
that GitHub renders at `/blob/main/docs/`. The nightly
`docs-agent-nightly.yml` workflow runs, but the `publish-verifier`
stage skips with `verify_skipped` in `partial_reasons` because there's
no published site to verify against.

The config explicitly documents the upgrade path:

> If you later scaffold mkdocs and add a deploy workflow, swap
> framework to mkdocs and fill in base_url + build_workflow.

This spec covers **Path A — Upgrade to MkDocs**: scaffold the mkdocs
site, add the Pages deploy workflow, flip the three config fields,
verify the round-trip works end-to-end.

### Correction on the original prompt

The original prompt assumed the plugin ships a `setup_scaffold`
script that writes `docs/site-src/` + Material `mkdocs.yml`. **That
script does not exist** in the plugin
(`/Users/theo/.claude/plugins/cache/engineering-docs-agent-marketplace/engineering-docs-agent/0.1.1/scripts/`
contains only `setup_discover.py`, which is read-only). The plugin's
`templates/` dir holds workflow YAML and JSON schemas, not mkdocs
scaffold. The scaffold must be **authored by hand**, using the
engineering-docs-agent dogfood at `/Users/theo/Projects/engineering-docs-agent/`
as the working reference.

The dogfood ships a complete, tested setup: `mkdocs.yml` (Material
theme + awesome-pages + literate-nav + mkdocstrings), `requirements-docs.txt`
with pinned versions, `.github/workflows/docs-pages.yml`
(configure-pages → `mkdocs build --strict` → upload-pages-artifact →
deploy-pages), and `docs/site-src/` with index, setup-guide, api/,
architecture/, operations/, archive/, whats-new pages.

### Filing a plugin tech-debt follow-up

The missing `setup_scaffold` is real plugin-side tech-debt. Future
host repos taking Path A will repeat our manual work unless the
plugin ships the scaffold step. Filed as Open Question §2 below.

## Goals

1. Flip `framework: none` → `framework: mkdocs` cleanly, with a
   working scaffold in place before the flag activates.
2. Stand up a published docs site at
   `https://theoju.github.io/claude-code-self-assessment/`.
3. Wire the `publish-verifier` stage end-to-end so the next nightly
   no longer emits `verify_skipped`.
4. Migrate the four existing `docs/*.md` files into the published
   site **verbatim** (no content rewriting in this PR).
5. Keep `docs/superpowers/specs/` in-repo for plugin lens analysis
   but **unpublished** on the site.

## Non-goals

These were considered and intentionally cut. Each is a deliberate
"no, not now" with the reason.

1. **No IA restructuring.** Verbatim moves only — published site has
   a flat IA in this PR; structural reorganization happens later,
   ideally agent-driven via lens analysis.
2. **No automated content rewriting.** Migrated `.md` files keep their
   content verbatim. No heading reformatting, no fixing imperfections
   in original prose, no updating outdated references in this PR.
3. **No mkdocs-material social-cards / instant-loading / git-revision
   plugins.** All compelling, all defer-able. Adding them bloats the
   PR surface for marginal first-day value.
4. **No `mkdocstrings` for TypeScript** (via mkdocstrings-typescript
   or a TypeDoc bridge). API docs for the dashboard's TS code are out
   of scope; app/, scripts/, lib/ aren't a public API surface.
5. **No CNAME / custom domain.** `theoju.github.io/claude-code-self-assessment/`
   is the chosen URL. Custom domains follow once the canonical URL is
   proven stable.
6. **No nightly cadence change.** The 07:07 UTC daily cron stays.
7. **No archival of `docs/superpowers/specs/` to the published site.**
   They stay in-repo for plugin lens analysis but unpublished.
8. **No edits to existing app/-side rendering of in-repo markdown**
   beyond the one path change for `ship-pattern`.
9. **No `.env` / `.env.example` changes.** All existing secrets stay
   where they are; Pages workflow runs on `GITHUB_TOKEN`.
10. **No version-bump or release** in this PR. Release can follow.

## Architecture

### Two workflows, two responsibilities

| Workflow                          | Trigger                                            | Purpose                                                                                | What it doesn't do                           |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `docs-agent-nightly.yml` (exists) | cron 07:07 UTC + `workflow_dispatch`               | Run plugin orchestrator → opens/updates `docs-agent/YYYY-MM-DD` PR with authored pages | Doesn't build the site, doesn't deploy Pages |
| `docs-agent-pages.yml` (new)      | push to `main` on docs paths + `workflow_dispatch` | `mkdocs build --strict` → upload-pages-artifact → deploy-pages                         | Doesn't author content, doesn't open PRs     |

**Why separated:** the nightly runs on Claude OAuth + Jira creds with
a 60-minute timeout. The Pages workflow has no secrets and runs in
~30s. Failures are isolated — a nightly outage doesn't take down the
published site; a Pages build break doesn't stop authoring.

### Dependency order (matters for review)

1. **`mkdocs.yml` + `docs/site-src/`** must exist before `mkdocs build`
   can succeed.
2. **`.github/workflows/docs-agent-pages.yml`** needs the scaffold to
   point at; needs Pages-write permission (handled by
   `configure-pages@v6 enablement: true` on first run).
3. **`.engineering-docs-agent/config.yml` flips** are last. Flipping
   `framework: mkdocs` activates the publish-verifier stage of the
   nightly, which expects the URL reachable.

Bottom-up review (does the config flip make sense?) is the wrong
direction — verify the scaffold builds locally first.

## Deliverables

All paths absolute to the worktree root
`/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/`.

### New files (6)

#### 1. `mkdocs.yml`

```yaml
site_name: Claude Code Self-Assessment
site_url: https://theoju.github.io/claude-code-self-assessment/
repo_url: https://github.com/theoju/claude-code-self-assessment
docs_dir: docs/site-src
site_dir: site

theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.indexes
    - navigation.top
    - toc.follow
    - search.suggest
    - content.code.copy

plugins:
  - search
  - awesome-pages
  - literate-nav:
      nav_file: SUMMARY.md

markdown_extensions:
  - admonition
  - attr_list
  - md_in_html
  - tables
  - toc:
      permalink: true
  - pymdownx.highlight
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.details
```

Minimal plugin set: `search`, `awesome-pages`, `literate-nav`. Dropped
`mkdocstrings` (Python-only, useless for TS) and `gen-files` (Python
source auto-doc).

The `site_url` trailing slash matters — mkdocs uses it for canonical
link resolution.

#### 2. `requirements-docs.txt`

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

Pinned versions from the dogfood (battle-tested against mkdocs 1.6.1).
`pymdown-extensions` is pinned explicitly because we use
`pymdownx.superfences` + mermaid; pinning prevents silent behavior
changes from future material upgrades.

No `playwright`, no `mkdocstrings`, no `gen-files`.

#### 3. `.github/workflows/docs-agent-pages.yml`

```yaml
name: docs-agent-pages
on:
  push:
    branches: [main]
    paths:
      - "docs/site-src/**"
      - "mkdocs.yml"
      - "requirements-docs.txt"
      - ".github/workflows/docs-agent-pages.yml"
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/configure-pages@v6
        with:
          enablement: true
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Build site
        run: |
          pip install -r requirements-docs.txt
          mkdocs build --strict
      - name: Write .nojekyll
        run: touch site/.nojekyll
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

Filename matches the upgrade path documented in the existing
`config.yml`. Critical bits:

- `paths:` filter prevents rebuilding when only non-docs files change
- `mkdocs build --strict` fails on broken links + missing nav refs
- `configure-pages@v6 enablement: true` programmatically enables
  Pages on first run (no Settings UI click required)
- `concurrency: group: pages` serializes deploys

#### 4. `docs/site-src/index.md`

Hand-authored landing page (one-time). Short markdown introducing the
dashboard, linking to the four migrated pages, naming the
agent-generated area as "Updates" once the agent populates
`whats-new.md`.

#### 5. `docs/site-src/SUMMARY.md`

Literate-nav ordering — explicit nav so order matches editorial
intent rather than alphabetical:

```markdown
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
  - [Boris Tips](boris-tips-reference-2026-05-10.md)
  - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

#### 6. `docs/site-src/whats-new.md`

Stub the agent will populate. Required because the config declares
`whats_new_file: docs/whats-new.md` and the path needs to flip to
`docs/site-src/whats-new.md`. Initial content is a placeholder so
the first nightly has somewhere to append.

### Modified files (5)

#### 7. `.engineering-docs-agent/config.yml`

Five field changes:

- `docs.framework: none` → `mkdocs`
- `docs.whats_new_file: docs/whats-new.md` → `docs/site-src/whats-new.md`
- `docs.lens_paths.core: docs/` → `docs/site-src/` (so the agent
  doesn't recurse into `docs/superpowers/specs/`)
- `publishing.base_url: null` → `https://theoju.github.io/claude-code-self-assessment/`
- `publishing.build_workflow: null` → `docs-agent-pages.yml`

The clarifying comment block at lines 32-36 (about the upgrade path)
becomes outdated — rewrite it to describe the current mkdocs setup
and what the publish-verifier checks.

#### 8. `.gitignore`

Append `site/` so local `mkdocs build` output doesn't get tracked. (No leading slash — matches the existing `.gitignore` style; see `node_modules`, `.next`, etc.)

#### 9. `README.md`

Three GitHub-rendered links that point at moving files. README is NOT
part of the mkdocs site — it stays at the repo root and is read by
GitHub. These three references rebreak after the `git mv`:

- Line 9: image link `docs/images/self-assessment-dashboard.png` →
  `docs/site-src/images/self-assessment-dashboard.png`
- Line 133: `[`docs/self-assessment.md`](docs/self-assessment.md)` →
  `[`docs/site-src/self-assessment.md`](docs/site-src/self-assessment.md)`
- Line 145: `[`docs/ship-pattern.md`](docs/ship-pattern.md)` →
  `[`docs/site-src/ship-pattern.md`](docs/site-src/ship-pattern.md)`

#### 10. `CLAUDE.md` (project memory)

Two stale path references that should track the move so the project
memory stays accurate:

- "Committed README/doc assets live in `docs/images/`" (line ~272) →
  `docs/site-src/images/`
- "`docs/ship-pattern.md` Stage 7 — the `/ship` command…" (line ~439)
  → `docs/site-src/ship-pattern.md`

(Line 77's `docs/ship-pattern/page.tsx` reference is the **app path**,
not the docs path — it does NOT need updating.)

#### 11. `app/data/rubric.json`

One reference inside a rubric action string (line ~21):

- `… and docs/ship-pattern.md for a reference design` →
  `… and docs/site-src/ship-pattern.md for a reference design`

Note: the same line also references
`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` —
that path is NOT moving (specs stay outside the published site), so
that reference stays as-is.

### File moves (5, via `git mv`)

Four markdown files and the image directory:

- `docs/boris-tips-reference-2026-05-10.md` → `docs/site-src/boris-tips-reference-2026-05-10.md`
- `docs/self-assessment.md` → `docs/site-src/self-assessment.md`
- `docs/ship-pattern.md` → `docs/site-src/ship-pattern.md`
- `docs/tip-classification-2026-05-10.md` → `docs/site-src/tip-classification-2026-05-10.md`
- `docs/images/` → `docs/site-src/images/` (so mkdocs includes images
  in the build artifact)

A sed sweep updates image references in the moved markdown files
(e.g., `docs/images/foo.png` → `images/foo.png` — relative to the new
`docs/site-src/` parent).

### Left in place (NOT moved)

- `docs/superpowers/specs/` — design history. Stays outside the
  published site. The plugin's `lens_paths` flip narrows agent
  analysis to `docs/site-src/` only.

### Small app-side edit (1 file, 2 changes)

`app/docs/ship-pattern/page.tsx` has **two** spots that reference the
markdown file:

1. The runtime path it passes to `app/lib/doc-markdown.tsx` to read
   and render the markdown at build time.
2. A literal display string at line ~33 (`<span className="mono">docs/ship-pattern.md</span>`)
   shown to users in the page header.

Both update from `docs/ship-pattern.md` to
`docs/site-src/ship-pattern.md`. No behavior change beyond the path.

## Rollout sequence

Two PRs and one workflow dispatch, executed in order. Each step has
verification gates that must pass before the next starts.

### Step 1 — Scaffold PR (this branch)

**Branch:** `engineering-docs-agent-integration`
**Title:** `feat(docs): scaffold mkdocs site + Pages workflow — CCE-XX`
**Contents:** 6 new files, 5 modified files, 5 `git mv` operations, 1 small TS edit (2 changes in one file).

**Local verification before opening the PR (mandatory):**

```bash
python3 -m venv .venv-docs && source .venv-docs/bin/activate
pip install -r requirements-docs.txt
mkdocs build --strict        # must exit 0
mkdocs serve                 # spot-check http://127.0.0.1:8000/
```

**Gate 1 — local build clean.** If `mkdocs build --strict` fails,
likely causes in order:

1. Image path didn't get rewritten in a moved file (sed missed a ref)
2. `SUMMARY.md` references a missing file (typo)
3. Migrated `.md` has a broken inter-doc link that worked under
   GitHub's renderer but not mkdocs (e.g. `[x](./foo)` without `.md`)

Fix locally; do not push until clean.

**Gate 2 — CI passes.** When the PR is up, `docs-agent-pages.yml`
does NOT fire (it's pinned to `push: branches: [main]`, not PRs).
Existing Vitest + Playwright suites should not regress. Confirm
`test:unit`, `test:integration`, `test:e2e` all pass.

**Gate 3 — `app/docs/ship-pattern/page.tsx` still renders.** Run
`npm run dev`; load `http://localhost:3737/docs/ship-pattern`. The
page should render the markdown — proves the in-app path edit
landed.

### Step 2 — Merge scaffold PR to main

Squash-merge via `gh pr merge --squash --delete-branch`. The merge
commit touches all four paths in the workflow's `paths:` filter, so
`docs-agent-pages.yml` auto-fires.

**Gate 4 — `docs-agent-pages.yml` fires automatically.**

**Gate 5 — `configure-pages@v6` enables Pages on first run.** The
`enablement: true` flag works programmatically with the workflow's
`pages: write` + `id-token: write` permissions. If it fails, the
workflow exits non-zero — no silent skip.

> **POST-IMPLEMENTATION CORRECTION (2026-06-02, PR #121 / CCE-81):**
> Gate 5 as written above is **WRONG**. The `enablement: true` flag
> does NOT actually bootstrap Pages on the first deploy. The
> workflow's `GITHUB_TOKEN` lacks the admin scope required for
> `POST /repos/.../pages`, and `permissions:` blocks can only
> _restrict_ the default token's scopes, never expand them. The first
> push-triggered run of `docs-agent-pages.yml` against merge commit
> `6369065` failed with `Resource not accessible by integration` at
> the `configure-pages@v6` step. **Actual recovery:** ran
> `gh api -X POST repos/theoju/claude-code-self-assessment/pages -f build_type=workflow`
> from a personal admin gh login, then dispatched the workflow via
> `gh workflow run docs-agent-pages.yml --ref main`. The dispatched
> run succeeded (build 16s, deploy 8s) and the site came live at
> https://theoju.github.io/claude-code-self-assessment/ within ~90s.
> All five migrated pages returned HTTP 200; the Next.js
> `/methodology/` route correctly 404s (confirms site scoping to
> `docs/site-src/`). **Future-host onboarding fix:** drop the
> `enablement: true` line from `docs-agent-pages.yml` (it's a no-op
> after Pages exists and a misleading footgun before) and bake the
> `gh api` call into either the engineering-docs-agent plugin's
> `setup_scaffold` script (see "Future work" below) or a per-repo
> onboarding runbook. Equivalent UI path: Settings → Pages → Build
> and deployment → Source = "GitHub Actions". The CLAUDE.md
> Conventions section now carries this gotcha for the project.
>
> **Resolved 2026-06-02 by PR #125 (this repo) + theoju/engineering-docs-agent PR #103 (plugin) under CCE-82:** template + this repo's workflow + plugin's own workflow all cleaned; bootstrap is now done by `scripts/enable_pages.py` from SKILL.md step 6c.

**Gate 6 — Site live at `https://theoju.github.io/claude-code-self-assessment/`.**
First deploy typically takes 60-120s after the `deploy` job. Verify:

```bash
curl -sI https://theoju.github.io/claude-code-self-assessment/ | head -5
# expect: HTTP/2 200
```

Spot-check rendered pages: index, self-assessment (incl. image),
ship-pattern, boris-tips, tip-classification, whats-new.

### Step 3 — Trigger first authored nightly

**ONLY after Gates 1-6 are green.**

```bash
gh workflow run docs-agent-nightly.yml \
  -f reason="first authored run after mkdocs upgrade"
```

**Gate 7 — Orchestrator completes without publishing-related
`partial_reasons`.** Watch the run summary. Confirm:

- `last_successful_run.head_sha` advanced from baseline
  `6c782ead5731960d3a0a9dd5b4e2ffcb9e1c2135`
- Opened PR (e.g., `docs-agent/2026-06-01`) has lens-page edits +
  populated `whats-new.md` entry
- No `verify_skipped` or `publish_verifier` in `partial_reasons` —
  if present, Gate 6 actually missed and the URL didn't resolve
  within `publishing.verify_timeout_seconds: 60`

**Gate 8 — First docs-agent PR has clean, mergeable content.**
Review the PR like any other (lens pages match the IA, whats-new
coherent, no hallucinated changelog items). Squash-merge it.

**Gate 9 — Post-merge Pages workflow re-fires.** Same auto-fire
path: docs-agent's PR touched `docs/site-src/**`. Site updates ~60s
later. Verify the new authored content is reachable on the live URL.

## Rollback decision tree

| Gate failed                              | Rollback action                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates 1-3 (pre-PR)                       | Fix locally; never opens the PR; zero exposure                                                                                                                                                                                           |
| Gates 4-6 (post-merge, no nightly fired) | One-line revert PR flipping `config.yml` back to `framework: none` + `base_url: null` + `build_workflow: null`. The scaffold + Pages workflow stay (no downside to having them sit unused); agent goes back to skipping publish-verifier |
| Gates 7-9 (nightly already fired)        | Same — revert the config flips. Authored PR can be closed without merging. State.json's partial `head_sha` does NOT need rolling back; next clean run advances it                                                                        |

## Verification matrix

Every claim has an evidence command. No "trust me it works" entries.

### Pre-merge (local, before scaffold PR opens)

| Claim                                   | Evidence command                                          | Pass criteria                                                                    |
| --------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Build is clean                          | `mkdocs build --strict`                                   | Exit 0, no warnings                                                              |
| Nav matches `SUMMARY.md`                | `mkdocs serve` → `http://127.0.0.1:8000/`                 | Sidebar: Home, Self-Assessment, Ship Pattern, Reference (2 children), What's New |
| Image renders                           | Open `/self-assessment/` locally                          | `self-assessment-dashboard.png` visible, not broken-image icon                   |
| Dashboard still loads `ship-pattern.md` | `npm run dev` → `http://localhost:3737/docs/ship-pattern` | Markdown renders; in-app docs page still works                                   |
| No `site/` leaked into git              | `git status --short`                                      | No `site/` entries                                                               |
| Existing tests green                    | `npm run lint && npx vitest run && npm run test:e2e`      | Same green as pre-scaffold                                                       |

### Post-merge to main (scaffold PR squashed)

| Claim                         | Evidence command                                                                                                     | Pass criteria                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Pages workflow auto-fired     | `gh run list --workflow=docs-agent-pages.yml --limit 1`                                                              | One run, `completed`/`success`, head matches squash commit |
| configure-pages enabled Pages | `gh api repos/theoju/claude-code-self-assessment/pages`                                                              | Returns `{"status":"built", ...}` not 404                  |
| Site is live                  | `curl -sI https://theoju.github.io/claude-code-self-assessment/`                                                     | `HTTP/2 200`, `content-type: text/html`                    |
| Image asset reachable         | `curl -sI https://theoju.github.io/claude-code-self-assessment/images/self-assessment-dashboard.png`                 | `HTTP/2 200`, `content-type: image/png`                    |
| Each migrated page reachable  | curl each `/{self-assessment,ship-pattern,boris-tips-reference-2026-05-10,tip-classification-2026-05-10,whats-new}/` | All five `HTTP/2 200`                                      |
| Search index built            | `curl -s .../search/search_index.json \| jq '.docs \| length'`                                                       | Integer ≥ 6                                                |

### Post-first-nightly (dispatched, before its PR merges)

| Claim                          | Evidence command                                                         | Pass criteria                         |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------- |
| Nightly finished cleanly       | `gh run view --workflow=docs-agent-nightly.yml --log \| tail -50`        | No `::error::` lines                  |
| `state.json.head_sha` advanced | Read `state.json` on the docs-agent PR's branch                          | Differs from baseline `6c782ead57...` |
| docs-agent PR opened           | `gh pr list --author engineering-docs-agent[bot] --limit 1`              | One open PR `docs-agent: YYYY-MM-DD`  |
| publish-verifier did NOT skip  | Inspect orchestrator step output for `partial_reasons`                   | No `verify_skipped` entry             |
| Forensics uploaded             | `gh run download <run-id> --name docs-agent-subagent-forensics-<run-id>` | Tarball non-empty                     |

### Post-merge of first authored docs-agent PR

| Claim                               | Evidence command                                        | Pass criteria                                           |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Pages workflow re-fired             | `gh run list --workflow=docs-agent-pages.yml --limit 2` | Two runs (scaffold + docs-agent merges), both `success` |
| Authored pages live                 | `curl -s .../whats-new/ \| grep -c '<article'`          | ≥1; content is authored body, not placeholder           |
| `mkdocs build --strict` still clean | Inspect second Pages run logs                           | No warnings on authored content                         |

### Negative tests (these MUST stay broken or design has a bug)

| Claim                                              | Evidence command                                                                                       | Pass criteria (claim should fail)                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Specs don't ship to site                           | `curl -sI .../superpowers/specs/2026-05-09-ship-slash-command-design/`                                 | `HTTP/2 404` — specs intentionally excluded                           |
| Pages workflow ignores non-docs pushes             | Push commit touching only `scripts/score.mjs`; `gh run list --workflow=docs-agent-pages.yml --limit 1` | No new run; `paths:` filter held                                      |
| Nightly orchestrator can't use framework=none path | `gh run view <nightly-run-id> --log \| grep -i 'framework_build'`                                      | Sees `framework_build` actually executing — confirms config flip took |

## Open questions (don't block, but worth answering before next docs cycle)

1. **Jira ticket key.** PR title placeholder is `CCE-XX`. CLAUDE.md
   says all CCE-N tickets live in `designitright.atlassian.net`
   Claude-Code-Extensions. Check the CCE backlog first via
   `searchJiraIssuesUsingJql` for "mkdocs OR site OR docs-agent
   framework" before filing a duplicate. Memory cites CCE-57 (the
   integration ticket) and CCE-64 (framework=none) — neither matches
   exactly; this is likely a new ticket.

2. **Plugin tech-debt follow-up for `setup_scaffold`.** The plugin's
   missing scaffold script means every future host repo doing Path A
   repeats this manual work. File a plugin-side ticket separately.

3. **`mkdocs.yml extra` block for analytics.** None proposed. If
   plausible/GA later, separate concern.

4. **PR-preview deploys.** Not configured here. Match dogfood
   behavior (push-to-main only). If wanted later, Vercel previews or
   artifact-upload pattern are separate work.

## Future work (filed; do NOT do in this PR)

| Item                                     | Why deferred                                                                            | Trigger                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `setup_scaffold` script in the plugin    | Plugin-side change; out of host-repo scope                                              | Separate ticket against engineering-docs-agent    |
| Lens IA restructure                      | Easier once agent has 1-2 nightlies of output to show what shape lens analysis produces | After 2-3 docs-agent PRs land                     |
| Bidirectional cross-refs (specs ↔ pages) | Requires specs discoverable + stable URLs                                               | Linked to "publish specs?" decision (non-goal §7) |
| PR-preview deploys for docs-agent PRs    | Real workflow change; needs Vercel preview or artifact-upload                           | Once docs-agent PRs are regular review surface    |
| Analytics / page-view tracking           | Plausible or GA; consent + privacy                                                      | Only if data actually wanted                      |
| Custom domain                            | DNS + CNAME + TLS via GitHub                                                            | If URL canonicalization becomes brand concern     |
| `docs/superpowers/specs/` on site        | One-line `lens_paths` edit + IA decision + possibly stale-content filtering             | Once IA matures; possibly agent-driven            |

## Scope sanity check

This PR ships:

- **6 new files** (mkdocs.yml, requirements-docs.txt,
  docs-agent-pages.yml, index.md, SUMMARY.md, whats-new.md)
- **5 modified files** (`.engineering-docs-agent/config.yml`,
  `.gitignore`, `README.md`, `CLAUDE.md`, `app/data/rubric.json`)
- **5 file moves** (4 markdown + 1 image dir) via `git mv`
- **1 small TS edit** in `app/docs/ship-pattern/page.tsx` (2 changes:
  runtime path + display string)
- **1 sed sweep** over moved markdown to update image references

Nothing else. No IA work, no plugin changes, no theme customization,
no release. Reviewable in one sitting; auditable in one diff.

## References

- Dogfood mkdocs setup: `/Users/theo/Projects/engineering-docs-agent/mkdocs.yml`
- Dogfood Pages workflow: `/Users/theo/Projects/engineering-docs-agent/.github/workflows/docs-pages.yml`
- Dogfood requirements: `/Users/theo/Projects/engineering-docs-agent/requirements-docs.txt`
- Current host config: `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/.engineering-docs-agent/config.yml`
- Current host nightly workflow: `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/.github/workflows/docs-agent-nightly.yml`
- Plugin setup skill: `/Users/theo/.claude/plugins/cache/engineering-docs-agent-marketplace/engineering-docs-agent/0.1.1/skills/engineering-docs-agent-setup/SKILL.md`
- Plugin scripts dir (note: no `setup_scaffold`): `/Users/theo/.claude/plugins/cache/engineering-docs-agent-marketplace/engineering-docs-agent/0.1.1/scripts/`
