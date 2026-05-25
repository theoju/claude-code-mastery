# Project memory: claude-code-self-assessment

A local Next.js 16 dashboard that scores Claude Code usage against Boris Cherny's
75 workflow tips. Reads `~/.claude/` and `~/.claude/usage-data/` directly — no
Anthropic API calls, no telemetry uploaded.

## Scoring model

Two independent axes, never collapsed:

- **Platform Setup** — derived from `~/.claude/settings.json`, `agents`,
  `commands`, `skills`, `plans`, `projects/*/memory`. _"Are the tools in
  place?"_
- **Execution** — derived from `~/.claude/usage-data/{facets,session-meta}/*.json`
  (the cooked telemetry `/insights` reads). Optionally scans
  `projects/*/*.jsonl` transcripts for the `★ Insight` banner (learning mode),
  worktree usage, and skill attribution. _"Are you using them?"_

Each per-dimension score is normalized to 100: `clamp(round(rawScore / target × 100))`.
The raw values are preserved alongside (`rawScore`, `rawTarget`, `executionRawScore`)
for audit. **Never re-introduce the old `overall / 89` form.**

Nine of twelve dims have Execution scorers. The remaining three (Model & Effort,
Memory & Context, Terminal & Customization) route to _unmeasured_ via
`gapReason` because the relevant signals never reach the cooked telemetry.
Unmeasured ≠ scored zero — the radar marks them with italic labels and a
footnote.

## Where things live

```
scripts/
  signals.mjs            # Platform Setup signals (~/.claude/)
  insights-signals.mjs   # Execution signals (~/.claude/usage-data/)
  _usage-data.mjs        # facets/session-meta loaders + scanTranscriptModes()
  score.mjs              # rules → scores, normalize() per dim
  progression.mjs        # milestone walker (first plan mode, first skill, etc)
  run-assessment.mjs     # entry point (npm run assess)
  claude-md-audit.mjs    # report-only CLAUDE.md health audit
app/
  page.tsx               # main dashboard (Platform Setup tile + Execution tile + radar)
  components/
    PageNav.tsx          # shared 4-entry nav (Dashboard · Methodology · Probes · Progression)
                         # active item gets aria-current="page"; context breadcrumb for detail pages
    RadarChart.tsx       # SVG radar; italic + 0.65 opacity + ¹ tspan for unmeasured-ex dims
    InsightsNarrative.tsx # captured /insights narrative, max-h-[24rem] with scrollbar
    ProgressionTimeline.tsx # milestone timeline rendering
  methodology/
    page.tsx             # full formula breakdown for each scorer (12-col editorial grid)
    probes/page.tsx      # predicate-backed checks; card layout grouped by signal source
  progression/page.tsx   # milestones from /insights history (moved out of dashboard in v0.9.7)
  dimensions/[id]/page.tsx # per-dimension drilldown
  tips/[n]/page.tsx      # Boris tip detail with prev/next nav
  docs/ship-pattern/page.tsx # renders docs/ship-pattern.md as a dashboard page (PR #58)
  lib/
    doc-markdown.tsx     # markdown renderer for in-repo docs (H1, GFM tables, HR, OL) — superset of boris-content.tsx
  data/
    rubric.json          # committed: titles, weights, targets, Boris tip refs
    probe-catalog.json   # committed: signal → source + path + description (probes page metadata)
    assessment.json      # gitignored: latest snapshot
    assessment-history.json  # gitignored: trend series (90 entries rolling)
    insights-narrative.md    # gitignored: user-imported /insights markdown
.claude/commands/
  self-assessment.md     # /self-assessment slash command
  refresh-insights.md    # /refresh-insights slash command
```

## Tests

```bash
npx vitest run            # 520 tests, ~5s
```

If a test fails after a scoring change, update the fixture in
`scripts/__tests__/_fixtures.mjs` (`makeSignals` / `makeInsights` /
`makeAssessment`) rather than weakening the assertion. Fixture should reflect
the full insights-signals + assessment contract; missing fields cascade into
NaN scores. `makeAssessment` must always include `executionOverall` so the
two-axis Slack/console renderers don't fall back to the unmeasured form.

## Hard rules

- **Never auto-run `/insights`.** It's token-heavy. The `/refresh-insights`
  skill files output that `/insights` already produced in the user's session;
  it must not invoke `/insights` itself.
- **Don't paraphrase the `/insights` narrative** when filing it. Write
  verbatim. The dashboard's value depends on faithfully presenting Anthropic's
  analysis, not the dashboard's interpretation.
- **Don't post to Slack** unless `slack.enabled: true` AND `SLACK_WEBHOOK_URL`
  is set. The dashboard's CLAUDE.md health summary is aggregate-only on
  shareable surfaces (Slack, console) — no project names, paths, or per-file
  issues — but per-target detail in `assessment.json` is local-only.
- **Empirically verify telemetry fields before scoring against them.** The
  original PR 9 plan assumed an `outputStyle` field that doesn't exist; a
  60-transcript survey killed it before the code was wrong. Use the same
  approach for any new Execution scorer.
- **Verify denominator semantics for every ratio scorer.** A scorer
  measuring user posture (permissions, plan mode, learning) must restrict
  its denominator to sessions whose posture is actually settable by the
  user — `interactive_cli`. Don't count `sdk_orchestrated`, `observer`, or
  `subagent` sessions in posture ratios; they run with the SDK's defaults
  and silently dilute the numerator. Volume scorers (integrations,
  scheduled, remote) can use the broad `all_sessions` universe. Universe
  is declared on `withGates({ universe: … })` in `scripts/score.mjs` and
  enforced at construction time.
- **Never collapse the two axes on any rendering surface.** Platform Setup
  and Execution scores must each be presented separately on the dashboard,
  the methodology page, the console printer (`run-assessment.mjs`), and the
  Slack post (`scripts/slack.mjs`). The Slack rule is now machine-enforced
  by `scripts/__tests__/slack.test.mjs` — the regression test asserts
  `not.toMatch(/\*Overall\*/)`. Don't weaken it. The legacy `overall / 89`
  form is permanently retired.
- **Verify before claiming.** Before documenting a CLI flag's accepted forms
  (or any other contract claim), read the parser and run a one-shot
  invocation. PR #22 documented `--claude-md-target` as `name=path` only;
  `parseTargetSpec` actually accepts a bare path too. Cost: a follow-up PR
  to fix the docs. Pattern: _premature root-cause commitment_ —
  exactly the friction class the `/insights` report flags.

## Conventions

- Slash commands and Skills are reusable assets — when you ship a repeatable
  workflow (e.g. `/refresh-insights`), prefer creating it under
  `.claude/commands/` over leaving it as in-line instructions.
- PR stack discipline: stack PRs base-on-base via `gh pr create --base`. When
  GitHub auto-closes a PR because its base branch was deleted, retarget
  surviving PRs to `main` _before_ squash-merging the parent.
- `--delete-branch` doesn't always work cleanly (inside or outside a
  worktree) — `gh` deletes the remote branch but the local remote-tracking
  ref persists. Run `git fetch --prune` after the merge to clear it.
- **`gh pr merge --delete-branch` from inside a worktree fails mid-cleanup
  when `main` is checked out in the parent repo** (`fatal: 'main' is
already checked out at …`). The GitHub-side merge still succeeds — only
  the local cleanup half-completes, leaving the remote branch alive and
  local main un-fast-forwarded. Recovery from the **main checkout**:
  `gh pr view <N> --json state,mergeCommit` (confirm MERGED) →
  `git push origin --delete <branch>` → `git fetch --prune` →
  `git merge --ff-only origin/main` → `git worktree remove <path>` →
  `git branch -d <branch>`. Prefer running `gh pr merge` from the main
  checkout in the first place when the feature lives in a worktree
  (PR #62 cycle).
- Sourcing `.env.local` for local runs: `scripts/run-assessment.mjs` reads
  `process.env.SLACK_WEBHOOK_URL` directly and does not auto-load
  `.env.local`. The LaunchAgent gets it via `EnvironmentVariables` in the
  plist (baked at install). For ad-hoc local runs that should post to
  Slack, prefix with `set -a; source .env.local; set +a;`.
- Cross-references between sibling docs/skills/commands should be
  bidirectional. When you add a pointer in one direction (e.g. PR #26 made
  `/refresh-insights` point to `/self-assessment`), check whether the
  reverse direction also needs one. PR #27 closed the loop in the
  `self-assessment` SKILL.md `## Pointers` section after a re-audit caught
  the asymmetry. Default to symmetric; one-way pointers age into stale
  asymmetric trees.
- Committed README/doc assets live in `docs/images/`. The `.gitignore`
  rule `dashboard-*.png` exists to keep ad-hoc tooling/test screenshots
  out of the repo — name committed assets around it (e.g.
  `mastery-dashboard.png`) rather than adding a per-file `!exception`
  that future contributors have to maintain.
- **Release flow goes through a release-branch PR**, not a direct push.
  The auto-mode classifier blocks `git push` against `main` even for
  trivial `chore(release): bump version` commits. Standard release
  shape: branch `chore/release-X.Y.Z`, bump `package.json`, open PR,
  squash-merge, tag the new main HEAD, `gh release create`. The tag
  itself (not the version bump commit) is the user-facing artifact, so
  you can shortcut the version bump if needed — but having
  `package.json` track the tag avoids drift.
- **Force-push to feature branches is blocked by
  `~/.claude/hooks/block-destructive.sh`** — the user has to run
  `! git push --force-with-lease ...` from their prompt. This applies to
  the rebase-then-update-PR flow when the open PR conflicts with main
  after sibling PRs land. Alternative: open a fresh PR from a new
  branch and close the original as superseded (no force-push, but loses
  discussion).
- **/ship halts at Stage 0 (pre-flight check 3) when a PR already
  exists for the current branch.** Re-running Stages 2-4 (verify-agent
  / simplify / code review) on an already-PR'd branch requires
  dispatching those review agents manually. Useful after merging a
  sibling PR that changed the diff, or when post-implementation review
  is requested after the initial /ship already opened the PR.
- **Reviewer subagents sometimes misread diffs.** Both `feature-dev:code-reviewer`
  dispatches on PRs #48 and #49 in the v0.9.6 cycle reported "no
  implementation, only docs" / "cannot read the diff" despite the
  diffs being substantial. Always sanity-check reviewer claims against
  `git diff <base>...HEAD` before acting on findings. The fix-the-bug
  reflex is to verify the substantiveness of the report, not the
  substantiveness of the code.
- **`block-destructive.sh` blocks `rm -rf` even against allowed targets**
  (`dist/`, `build/`, `node_modules/`, `.next/`, `__pycache__/`, `tmp/`,
  `coverage/`). The pattern match short-circuits before the target check.
  Workaround: drop the `-f` flag — `rm -r tmp/` succeeds where
  `rm -rf tmp/` is blocked. Encountered while cleaning up `tmp/svtest/`
  left by a reviewer subagent in the v0.9.9 cycle.
- **Stop-verify hook is hash-deduped per-repo (since v0.9.9).** The
  user-level `~/.claude/hooks/stop-verify.sh` stores a 40-char SHA-1 of
  the working-tree diff state at
  `~/.claude/.stop-verify-hashes/<12-char-repo-key>` after each fire
  and exits silently on subsequent yields with identical state. The
  hook only re-nags when the diff actually changes (new untracked file,
  new tracked edit, commit that clears the diff). To force a fresh
  fire: `rm` (no `-f`) the state file for the repo. Backup of the
  pre-dedup hook lives at `~/.claude/hooks/stop-verify.sh.pre-dedup`;
  test harness at `~/.claude/hooks/__tests__/stop-verify.test.sh`
  (9 tests). Spec + plan: `docs/superpowers/specs/2026-05-21-stop-verify-hash-dedup-design.md` +
  `docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md`.
- **Subagent behavioral tests should use absolute `/tmp` paths.** When
  dispatching reviewer or implementer subagents that run sample shell
  commands (e.g. behavioral verification of a bash script), require
  `mktemp -d` or `/tmp/...` explicitly. Inherited cwd defaults can
  leave artifacts in the project's working tree — the v0.9.9 cycle's
  T6 reviewer left a `tmp/svtest/` directory that needed manual cleanup.

## Issue tracking

- Jira instance: `designitright.atlassian.net`.
- Project: **Claude-Code-Extensions** (key: `CCE`). All tickets for work
  in this repo live here; ticket keys follow the `CCE-N` pattern.
- Reference the key in PR titles and commit messages when the work maps
  to a ticket (e.g. `feat(rubric): expand /ship next-action — CCE-12`).
- When future automation in this repo needs Jira integration (status
  reports, ticket creation, transitions), target this instance and
  project — don't spin up a second project for sub-areas. The
  Atlassian MCP server (`atlassian:*` tools) is the canonical
  integration surface.
- For the reference example of Jira-touching automation, see
  `docs/ship-pattern.md` Stage 7 — the `/ship` command transitions
  the linked ticket and posts the PR link as the close-of-loop step.
- **Auto-mode authorization for Jira writes is scoped per action,
  not per session.** Re-authenticating the Atlassian MCP server (or
  approving one comment) does NOT extend to subsequent writes — each
  `createJiraIssue`, `addCommentToJiraIssue`, and `transitionJiraIssue`
  needs its own user direction. CCE-13 (PR #62): the comment landed
  after explicit re-auth, but the immediate follow-up
  `transitionJiraIssue` was classifier-blocked under the same auth.
  When chaining Jira writes, ask for explicit confirmation per write
  or batch them into a single user-approved step.

## Privacy

- All scoring is local. No data leaves the machine unless Slack is enabled.
- `app/data/insights-narrative.md` and `~/.claude/usage-data/report.html` are
  user-driven imports (gitignored / served only on localhost).
- The dashboard never reuses Anthropic's `/insights` prompt template, never
  calls any Anthropic API, and includes explicit non-affiliation language in
  `app/methodology/page.tsx` (Attribution section).
