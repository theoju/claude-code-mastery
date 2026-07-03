---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
doc_kind: decision
---

# Bootstrapping engineering-docs-agent for this repo (PR #100)

PR #100 turned this repo into a host for the `engineering-docs-agent` plugin.
It adds three things: `.engineering-docs-agent/config.yml`, a seeded
`.engineering-docs-agent/state.json` (plus a `state.example.json` template),
and a `docs-agent-nightly.yml` GitHub Actions workflow. Nothing here is doc
content — it's the agent/CI scaffolding that lets a nightly job start writing
doc content into `docs/site-src/`.

## Config: one lens, and `framework: none` at the time

`config.yml` at the time of PR #100 declared a single `core` lens rooted at
`docs/`, with `docs.framework: none`. That value mattered: this repo renders
plain markdown through GitHub rather than through a static-site generator, and
until CCE-64 landed, the plugin's config schema only accepted
`docs.framework: mkdocs | docusaurus`. The branch had originally shipped a
synthetic `mkdocs.yml` + `requirements-docs.txt` scaffold purely to satisfy
that schema — files that didn't reflect anything real about the repo. Once
`framework: none` became a first-class config value, PR #100 deleted the
synthetic scaffold so the host config matched reality instead of carrying
placeholder tooling nobody used.

(This repo has since adopted mkdocs for real — see
`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` — and
`config.yml`'s `docs.framework` field now reads `mkdocs`, with `publishing`
fields pointing at `docs-agent-pages.yml` and
`https://theoju.github.io/claude-code-self-assessment/`. PR #100's contribution
was the `framework: none` phase that came before that upgrade; both
`agent_editable_paths: ["docs/**"]` and the single `core` lens it defined
carried forward unchanged.)

## State file: seeded at branch-creation HEAD

`state.json` is how the nightly job knows what's already been processed. PR
#100 seeded it with the branch-creation commit SHA and `pr_number: 0`:

```json
{
  "version": "1",
  "last_successful_run": { "head_sha": "<seed-commit-sha>", "pr_number": 0 },
  "dismissed_gap_flags": []
}
```

`state.example.json` ships alongside it as the placeholder template (its
`head_sha` reads `REPLACE_WITH_SEED_COMMIT_SHA` verbatim) — the pattern any
future re-seed or fork should follow. The live `state.json` is rewritten after
every successful nightly run, so its `head_sha` and `dismissed_gap_flags`
drift from the seed value over time; that's expected, not a sign of file rot.

## Nightly workflow: what actually runs

`docs-agent-nightly.yml` is this repo's *first* `.github/workflows/` file —
everything else here (Vitest, Playwright) runs via `package.json` scripts, not
CI-triggered workflows. It fires daily at 07:07 UTC (`cron: "7 7 * * *"`, the
off-minute chosen to dodge the `:00` scheduling pileup) and also accepts
`workflow_dispatch` with an optional `reason` input for manual runs.

The job:

1. Mints a GitHub App installation token (`actions/create-github-app-token`)
   rather than using the default `GITHUB_TOKEN`, so commits and PRs are
   attributed to `engineering-docs-agent[bot]`.
2. Checks out this repo, then checks out `theoju/engineering-docs-agent`
   itself into `.docs-agent-plugin` — the host repo isn't the plugin, so the
   plugin's orchestrator has to be vendored into the runner workspace to be
   invocable.
3. Installs Python 3.11 and only `pyyaml` + `jsonschema` (the orchestrator's
   own deps) — no mkdocs/docusaurus toolchain, since the host was
   `framework: none` at the time this workflow was authored. A comment in the
   workflow still notes this explicitly, even though `config.yml` has since
   moved to `framework: mkdocs`.
4. Installs the `claude` CLI and asserts `CLAUDE_CODE_OAUTH_TOKEN` is set and
   well-formed (`sk-ant-oat*` prefix, not the console `sk-ant-api*` key,
   and long enough not to be a truncated paste) before doing anything else.
5. Runs `.docs-agent-plugin/scripts/orchestrator_runner.py --repo-root
   "$GITHUB_WORKSPACE"` — the actual nightly authoring step.
6. Uploads subagent forensics (`${{ runner.temp }}/docs-agent-debug/`,
   14-day retention) unconditionally (`if: always()`), and writes a run
   summary that dumps the post-run `state.json` to `$GITHUB_STEP_SUMMARY`.

Permissions are scoped tightly to what the job needs: `contents: write` (to
commit and push the `docs-agent/YYYY-MM-DD` branch), `pull-requests: write`
(to open or append to the PR), and `issues: read` (the gap-detector reads
linked issues but never writes them). `concurrency.cancel-in-progress: false`
means a slow run is left to finish rather than superseded by the next
schedule tick.

## What this PR didn't do

All of this is agent/CI configuration, not doc content — no
architecture/operations/archive section directories exist yet under the
`core` lens (only `docs/site-src/images/`). Seeding those sections is left to
a future PR; PR #100's job was purely to get the nightly job wired up and
pointed at the right (real) config.
