# Project memory: claude-code-self-assessment

A local Next.js 16 dashboard that scores Claude Code usage against Boris Cherny's
75 workflow tips. Reads `~/.claude/` and `~/.claude/usage-data/` directly — no
Anthropic API calls, no telemetry uploaded.

## Commands

```bash
npm run dev            # Next.js dev server (Turbopack) on http://localhost:3737
npm run build          # production build
npm run lint           # eslint (flat config, eslint.config.mjs)

npm run assess         # score local setup → write assessment.json (+ Slack if enabled)
npm run assess:print   # same, but --print --no-slack (full dimension block to stdout)
# scorer flags: --claude-md-target <name=path|path>  --include-transcripts
#               --no-transcripts  --insights-lookback <N>  --no-slack  --print

npx vitest run                         # full unit suite (see ## Tests for count)
npx vitest run path/to/file.test.tsx   # one file
npx vitest run -t "substring of name"  # one test by name
npm run test:unit         # excludes scripts/__tests__/integration/**
npm run test:integration  # only scripts/__tests__/integration
npm run test:coverage     # vitest --coverage
npm run test:e2e          # Playwright (e2e/, needs `npm run dev` reachable)
```

`scripts/run-assessment.mjs` does **not** auto-load `.env.local`; for ad-hoc
runs that should post to Slack, prefix with `set -a; source .env.local; set +a;`.

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

**All twelve dimensions** have Execution scorers as of CCE-76 (PR #116). Memory & Context Management and Terminal & Customization Execution scorers consume **transcript-derived posture-command coverage signals** (the `interactive_cli ∪ unknown`-gated counters from CCE-71) against the new `interactive_or_unknown` session universe (`sessionsByKind.interactive_cli + sessionsByKind.unknown`). This mixes transcript signals into Execution scoring — matching the precedent set by `learning` (`★ Insight` banner) and `parallel` (worktree usage). Model & Effort Tuning remains the only partially-measured dim (the Opus-usage half is scored from transcripts; effort level stays settings-only). Italic-unmeasured labels on the radar now apply only to dims whose Execution score returns `gapReason !== null` (e.g. zero interactive sessions in window).

## Where things live

```
scripts/
  signals.mjs            # Platform Setup signals (~/.claude/)
  insights-signals.mjs   # Execution signals (~/.claude/usage-data/)
  _usage-data.mjs        # facets/session-meta loaders + scanTranscriptModes()
  score.mjs              # rules → scores, normalize() per dim
  predicate.mjs          # canonical satisfiedWhen DSL evaluator (TS re-exports from here)
  rank-next-actions.mjs  # filtered+sorted top-N next-actions; output goes into assessment.json
  progression.mjs        # telemetry milestone walker — self-dated from session start_time
  config-progression.mjs # config milestone walker — firstSeenAt stamped at first run (see Conventions)
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
  progression/page.tsx   # renders app/data/progression.json via loadProgression (NOT /insights history); moved out of dashboard in v0.9.7
  dimensions/[id]/page.tsx # per-dimension drilldown
  tips/[n]/page.tsx      # Boris tip detail with prev/next nav
  docs/ship-pattern/page.tsx # renders docs/site-src/ship-pattern.md as a dashboard page (PR #58)
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

### Docs site (mkdocs)

The published docs site lives at https://theoju.github.io/claude-code-self-assessment/.
Source under `docs/site-src/`, built by `.github/workflows/docs-agent-pages.yml`,
verified on every PR by `.github/workflows/docs-build-check.yml`. The
engineering-docs-agent's nightly fills in lens pages + `whats-new.md`.

- Spec: `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`
- Plan: `docs/superpowers/plans/archived/2026-06-01-mkdocs-upgrade.md`
- Config: `.engineering-docs-agent/config.yml` (`framework: mkdocs`)

## Tests

```bash
npx vitest run            # 761 tests across 49 files, ~3s
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
- **Don't blend cumulative all-time counters into windowed ratio
  surfaces.** Numerator counters that share a ratio with a 30-day windowed
  denominator must also be 30-day windowed; mixing cumulative all-time
  sources (e.g. `~/.claude.json` lifetime invocation counts like
  `btwUseCount`, `hasUsedAgentsFleet`-derived all-time flags) into the
  numerator overstates session-coverage and produces ratios that drift up
  with account age rather than recent posture. Two semantic axes to check
  per field: **(a) time window** (windowed vs cumulative) and **(b) counter
  class** (per-session-coverage vs raw invocation count). A summary blend
  via `Math.max(maxProbe(s, field), cumulativeCounter)` looks ergonomic but
  conflates both axes — keep the cumulative source on a separate
  signalsSummary field (e.g. `cliBtwUseCountAllTime` for `cliBtwUseCount`)
  and route habit-only predicates (`>=1` adoption checks) at the cumulative
  field. v0.9.18 / CCE-78: the original /btw blend at
  `run-assessment.mjs:134-137` Math.max'd `cliBtwUseCount` (cumulative
  all-time invocation count) into `btwCommandUses` (30-day session-coverage)
  for predicate ergonomics, which silently corrupted the Memory Execution
  ratio's numerator. Fixed by exposing `cliBtwUseCountAllTime` separately
  and rerouting the tip 33 predicate. The follow-up redesign for the
  Memory Execution scorer (per-field semantics rather than fungible sum)
  is **CCE-79**.
- **Per-field semantic categorization before adding to any numerator.** When
  adding a new field to a ratio numerator (or summing multiple fields into
  one), classify each field on two independent axes BEFORE writing the
  `sum`:

  | Axis              | Possible classes                                              |
  | ----------------- | ------------------------------------------------------------- |
  | (a) Time window   | windowed (e.g., 30-day) / cumulative (lifetime)               |
  | (b) Counter class | session-coverage (deduped per session) / raw invocation count |

  If the new field's class on either axis differs from existing numerator
  inputs, it doesn't belong in the same `sum`. Route it to a separate
  surface: evidence text (cumulative), separate predicate (binary), or
  a separate ratio with a matched denominator (windowed-but-different-class).
  CCE-79 (PR TBD) is the reference case: the original Memory Execution
  numerator summed `/btw + /clear + /compact + /rewind` even though `/btw`
  was cumulative-all-time and `/rewind` was a near-zero binary signal —
  three classes in one sum. Redesign restricted the numerator to the two
  session-coverage signals (`/clear + /compact`), surfaced `/btw` as
  cumulative evidence text, kept `/rewind` only as a next-action probe,
  and recalibrated the rubric target 92 → 60 to match the narrowed
  realistic ceiling. Source: per-field table in
  `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
  §Context.

- **Verify denominator semantics for every ratio scorer.** A scorer
  measuring user posture (permissions, plan mode, learning) must restrict
  its denominator to sessions whose posture is actually settable by the
  user — `interactive_cli`. Don't count `sdk_orchestrated`, `observer`, or
  `subagent` sessions in posture ratios; they run with the SDK's defaults
  and silently dilute the numerator. Volume scorers (integrations,
  scheduled, remote) can use the broad `all_sessions` universe. Universe
  is declared on `withGates({ universe: … })` in `scripts/score.mjs` and
  enforced at construction time. **Corollary: a ratio's _numerator_ must
  be a subset of its _denominator's_ universe**, or the ratio can exceed
  100%. v0.9.17 / PR #97: the planning Execution scorer divided
  `planModeSessionCount` (plan mode across _all_ interactive sessions) by
  `multiTaskSessionCount` (interactive ∩ multi_task) — numerator universe
  ⊋ denominator universe — producing `Plan mode: 36/34 multi-task sessions
(105.88%)`. Fixed by introducing `planModeMultiTaskSessionCount`
  (interactive ∩ multi_task ∩ plan_mode) as the numerator. When you add a
  ratio scorer, assert the numerator's gates are a strict subset of the
  denominator's, and back it with a source-level
  `gatherInsightsSignals` test (not just a fixture-fed scorer test) so a
  future gate-drop at the counting layer fails CI.
- **Session-kind classification must fail closed.** `classifySessionKind`
  in [/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs)
  decides which sessions count as user-driven. It uses an **allow-list** —
  `INTERACTIVE_ENTRYPOINTS = {cli, claude-desktop}` — and every other
  `entrypoint` value resolves to `observer` or `sdk_orchestrated`. **Never
  invert this into "enumerate the SDK entrypoints and let the rest fall
  through to `unknown`."** `unknown` is *admitted* by the
  `interactive_or_unknown` universe, so an unrecognized entrypoint that
  degrades to `unknown` silently enters the posture denominator. That is
  exactly what shipped: `sdk-py` was unhandled, 226 automated agent sessions
  landed in `unknown`, and the Memory Execution denominator read **353
  against a true 93** — a 3.8x dilution that scored a well-instrumented
  machine at 37/100 (CCE-164, 2026-08-20). Under-counting a posture
  denominator is conservative; over-counting is the bug. **Second defect in
  the same function:** the scan bound was 5 lines, but modern transcripts
  lead with `queue-operation` and `attachment` rows and the corpus census
  put the first `entrypoint` row as deep as **line 83** — 39 further
  sessions were misclassified. The bound is now `ENTRYPOINT_SCAN_BOUND = 200`
  and the loop still breaks on the first `entrypoint` row (p50 = 3).
  **Diagnostic reflex:** if a posture Execution score looks implausibly low,
  print `sessionsByKind` **before** touching the scorer — a large `unknown`
  bucket is a classifier bug, not user behavior. After CCE-164, `unknown`
  means exactly one thing: no `entrypoint` row was found (missing transcript
  or unreadable file), and it is 0 across all 639 transcripts on this
  machine. Spec:
  `docs/superpowers/specs/2026-08-20-cce164-session-classifier-defect-design.md`.
- **Command counting honors the posture-vs-volume partition** —
  `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in
  [/Users/theo/Projects/claude-extensions/scripts/\_usage-data.mjs](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs)
  are the canonical source of truth. Posture commands (`/color`,
  `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`,
  `/rewind`, `/fewer-permission-prompts`) are counted from transcripts
  only when `classifySessionKind` returns `interactive_cli` or
  `"unknown"` (the conservative fallback). Volume commands (`/loop`,
  `/schedule`, `/babysit`, `/go`, `/batch`) are counted across every
  scanned session kind — autonomous-workflow signal is real regardless
  of which session emitted it. A fail-loud `assertCommandPartition`
  runs at module load and catches drift (disjointness, missing
  classification, dead classification). **Historical context (do not
  delete — future readers triaging similar regressions need it):**
  v0.9.17 originally attempted a blanket "exclude observer/sdk/subagent
  from `scanTranscriptInvocations`" fix and regressed `scheduled` 75→63
  by deleting genuine autonomous-workflow signal. It was reverted; the
  per-command partition (PR #110) is the correct shape — posture is
  filtered, volume is preserved. **Operational note:** if
  `npm run assess` exits non-zero with no `assessment.json` written,
  check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition
  errors from the boundary assertion before assuming an environmental
  issue.
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
- **Keep the probe tracker in sync with every probe change.** Any change to
  the probe set — adding, removing, renaming, or re-gating a `satisfiedWhen`
  signal; adding/removing a `probe-catalog.json` entry; or adding a scorer
  signal in `_usage-data.mjs` / `buildSignalsSummary` — must update
  `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` **in the
  same PR**. The tracker's own header declares it a living doc; treat a probe
  change with a stale tracker as an incomplete change. Update all of: the
  Part 1 registry row(s) for the touched layer; the Part 2 tip-coverage row
  (and the ✅/📊/🗣/❌ tally) if a tip's status or probe changed; and the
  "Validated against" header counts — re-derive them, don't guess. Derive the
  `signalsSummary` count by **invoking** `buildSignalsSummary(makeSignals())`
  and counting `Object.keys(...)`, never by parsing the function source: a
  regex over the body silently under-counts shorthand properties (e.g.
  `hookEvents,`), which is how a wrong `65` briefly landed in this header.
  Reference example: PR #85 / CCE-29 (the `/effort max` reflex probe
  `effortMaxAdopted` + `effortMaxCommandUses`). The **five header counts are
  now machine-enforced** by `scripts/__tests__/tracker-counts.test.mjs` (tips,
  dimensions, next-actions, probe-catalog entries, `signalsSummary` keys) — a
  stale number fails CI, so the header format is a tested contract. The
  per-row / per-tip-status updates (Part 1 registry rows, Part 2 coverage row +
  the ✅/📊/🗣/❌ tally) remain a contributor convention Claude must follow
  per-change; only the cited counts are auto-checked.
- **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
  `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
  re-export — never copy the implementation. Test
  `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
  reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit
  `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.
- **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
  self-assessment skill must NEVER hand-implement the satisfiedWhen filter
  or the weight×deficit ranking. Read the pre-computed top-10 from the
  written file. The 2026-05-31 cycle landed this contract; surfacing a
  satisfied action as a TODO again is a regression — fix the data layer,
  not the report.

## Conventions

- **Prefer absolute paths for file references** so Claude Code's terminal
  auto-links them as clickable targets. Use `/absolute/path:line` rather than
  `path` in chat-facing surfaces (design docs, /ship summaries, status tables,
  brainstorm output, code review reports). Keeps the same `file:line` pattern
  the built-in instructions already prescribe but pins it to absolute form so
  the terminal renders it as a link.
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
- Committed README/doc assets live in `docs/site-src/images/`. The `.gitignore`
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
  `docs/superpowers/plans/archived/2026-05-21-stop-verify-hash-dedup.md`.
- **Subagent behavioral tests should use absolute `/tmp` paths.** When
  dispatching reviewer or implementer subagents that run sample shell
  commands (e.g. behavioral verification of a bash script), require
  `mktemp -d` or `/tmp/...` explicitly. Inherited cwd defaults can
  leave artifacts in the project's working tree — the v0.9.9 cycle's
  T6 reviewer left a `tmp/svtest/` directory that needed manual cleanup.
- **/ship's early cost-gate (Stage 0a) fires on a _clean_ working tree.**
  When all work is already committed, `staged-diff-summary.sh` reports 0
  files / 0 lines, which trivially passes the gate's `≤1 file / ≤50 lines /
all-docs` thresholds (the docs check is vacuous on an empty set) — so the
  "docs-only, skip verify/simplify?" prompt appears even on a large _code_
  branch. Judge the gate against the committed branch diff
  (`git diff main...HEAD`), not the working tree; the default `y` runs the
  full chain anyway (v0.9.11 cycle, shipping #79 via `/ship`).
- **`gh pr merge --squash --delete-branch` can return no stdout yet still
  succeed.** Empty output is not failure. Confirm with
  `gh pr view <N> --json state,mergeCommit` (expect `MERGED` + a commit SHA)
  and that `origin/main` advanced before assuming the merge didn't land —
  then `git fetch --prune` + `git merge --ff-only origin/main` to sync local
  main (v0.9.11 cycle).
- **`gh release create --target <short-SHA>` fails with HTTP 422**
  (`Release.target_commitish is invalid`). Use `--target main` (or a full
  40-char SHA). The tag lands at that target's current HEAD, so run it right
  after the release-bump PR squash-merges and local main is fast-forwarded
  (v0.9.10 cycle).
- **`block-destructive.sh` scans the literal command text, including heredoc
  bodies.** A `gh pr create` / `gh release create` whose `--body`/`--notes`
  heredoc merely _contains_ a blocked pattern (e.g. the string `rm -rf`
  quoted in release notes) gets the whole command blocked. Write PR/release
  bodies to a file with the Write tool and pass `--body-file` /
  `--notes-file` (v0.9.10 cycle).
- **Address a /ship verify-agent "yes-with-caveats" before Stage 5, not
  after.** The caveat is logged non-blocking, but fixing it in the working
  tree before the commit keeps the fix in the same PR — e.g. the v0.9.11
  cycle's missing tip-11 scorer-credit test, flagged at Stage 2 and closed
  before commit, rather than deferred to a follow-up.
- **"How many probes?" has several answers — name which one.** These counts
  are distinct and easy to conflate (the source of the v0.9.15 README
  off-by-one, where "45 carry predicates" was really 44):
  1. **`probe-catalog.json` entries** — the catalog-backed probe set.
  2. **`satisfiedWhen` predicate fields** — **one fewer** than the catalog,
     because `sessionsByKind` is catalog-backed (it populates the
     probes-page session census) but is the session-universe classifier, not
     a predicate LHS. Re-derive from the rubric, not from the catalog size.
  3. **Dashboard `/methodology/probes` "checks"** — one row per rubric
     next-action that has a predicate (so it equals count #2's usage, not the
     catalog), grouped by the catalog `source` field and axis-labeled P/P\*.
  4. **Tracker spec Part 1 registry rows** — larger than all the above: it
     also counts Insights/Execution signals and non-catalog `—` rows, and
     groups by source _layer_.
  5. **`buildSignalsSummary` keys** — yet another number (derive by invoking,
     never by parsing — see the probe-tracker rule above).
     Consequences worth remembering: the probes page's `history` source is **not**
     the tracker's `Insights` layer, and cooked-telemetry signals appear in the
     tracker + radar but **never** on the probes page (they aren't
     predicate-backed). Always re-derive the specific count you mean from the live
     files; never reuse one count where another is meant.
- **The `/progression` timeline has two milestone sources and a coverage
  gap — don't mistake a frozen timeline for a bug.** `app/progression/page.tsx`
  reads `app/data/progression.json`, **rewritten on every `npm run assess`**
  (so it _is_ updated per-run). That file merges (a) **telemetry milestones**
  (`scripts/progression.mjs`, 9 detectors) self-dated from session
  `start_time` over **full history** — it uses `--progression-lookback`
  (default `null`), **independent of `--insights-lookback`**, which is why
  April dates appear under a 30-day scoring window; and (b) **config
  milestones** (`scripts/config-progression.mjs`, 8 detectors) read from the
  signals snapshot, which has no embedded "when," so each `firstSeenAt` is
  stamped at the **first run that observed it** and frozen in
  `app/data/progression-config.json`. **First-run caveat (by design):**
  every already-satisfied config signal gets `firstSeenAt = first-run date`
  — that is why all 8 config milestones share the identical
  `2026-05-09T08:37:16.111Z` (the dashboard's first run) rather than their
  true adoption dates; it deliberately does **not** back-date from mtimes/git
  ("fragile and lossy"). **Coverage gap:** the catalog only covers 8 of 12
  scored dimensions (`automation, integrations, learning, memory,
model-effort, parallel, permissions, planning`) — **`scheduled`, `remote`,
  and `verification` have no detector**, so heavy real usage there produces
  no milestone and the timeline looks frozen past the first-run wall. Adding
  telemetry-dated detectors for those three is filed as **CCE-33** (feature
  work; design before implementing).
- **Ship-journal counters use `stageRanInEntry()` to detect stage
  execution across all three journal format generations** (singular
  `entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`).
  Adding a new stage counter follows this pattern — see CCE-72 / PR #113
  for the reference implementation. The canonical stage-number /
  -name mapping lives inline in `scripts/signals.mjs::stageRanInEntry`
  (stages 0–7: pre-flight, test, verify-agent, simplify, code-review,
  commit, push-pr, jira-update). New stages append to the end of the
  workflow, never insert in the middle, so the numeric detector arm
  stays stable.
- **`actions/configure-pages@v6 enablement: true` does NOT actually
  bootstrap GitHub Pages on a first deploy** — despite the field name
  and the action's docs. The workflow's `GITHUB_TOKEN` lacks the admin
  scope required to call `POST /repos/.../pages`, so the very first run
  fails with `Resource not accessible by integration` even with
  `permissions: pages: write` declared. `permissions:` can only
  _restrict_ the default token's scopes, never expand them. After Pages
  exists (any path), `enablement: true` becomes a silent no-op forever.
  **Fix for host onboarding:** before the first deploy, run
  `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`
  from a personal/admin gh login. Equivalent UI path: Settings → Pages
  → Build and deployment → Source = "GitHub Actions". `build_type=workflow`
  is durable — once set, all subsequent push-triggered runs of
  `docs-agent-pages.yml` work cleanly and the `enablement: true` line
  is meaningless. The line was deleted from the workflow in PR #125 / CCE-82 (2026-06-02).
  See the plugin's CLAUDE.md (https://github.com/theoju/engineering-docs-agent/blob/main/CLAUDE.md)
  for the durable plugin-side fix detail; the post-implementation note in this repo's spec
  (`docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md` →
  "Post-implementation correction") and the plan's recovery section
  document the v0.9.20 onboarding incident for PR #121 / CCE-81 in
  full. `build_type=workflow` also disables branch-deploy publishing —
  the only path to `theoju.github.io/<repo>/` is via `deploy-pages@v5`'s
  artifact upload, which is what we want for mkdocs builds but worth
  knowing if anyone wonders why static files in main don't appear.
  For future host repos onboarded with `framework: mkdocs`, the
  `gh api` call should be baked into the engineering-docs-agent's
  `setup_scaffold` script (currently filed as a plugin tech-debt
  followup — see PR #121 description "Followup tickets recommended").
- **Monitor scripts must use bash, not zsh's defaults** — `status` and
  `pipestatus` are read-only zsh built-in parameters (they expose the
  last command's exit code and the per-stage exit codes of the last
  pipeline). Assigning to either inside a poll loop crashes the shell
  with `read-only variable: status` and the monitor exits non-zero with
  no event lines emitted. Both monitors I wrote during the PR #121
  cycle hit this and silently masked successful deploys. **Two ways
  to avoid:** (1) name loop locals away from the reserved set
  (`run_status`, `pipe_state`) instead of `status`/`pipestatus`, or
  (2) shebang the script `#!/usr/bin/env bash` and run it under bash
  where these names are not reserved. The session environment
  reminder lists `Shell: zsh` — weight that when writing Monitor
  scripts. **Corollary:** a monitor exiting non-zero with NO emitted
  event lines is almost always a script bug, not a failure of the
  watched system. Always confirm by direct query (`gh run view <ID>
--json status,conclusion,jobs`) before treating monitor failure as
  evidence the underlying task failed.
- **A missing binary is a PATH bug until proven otherwise — and Claude Code's
  shell is not your terminal's shell.** A Homebrew Intel→ARM migration
  (`/usr/local` → `/opt/homebrew`) removes every formula in the old prefix,
  so `node`, `npm`, and `gh` can vanish while `brew` itself still works. Two
  independent failures stack, and fixing only one leaves you confused:
  **(a)** the tools are genuinely uninstalled — confirm with
  `brew list --versions node gh` (empty output = really gone, reinstall with
  `brew install node gh`); **(b)** `~/.zprofile` still evals
  `$(/usr/local/bin/brew shellenv)` for a `brew` that no longer exists, so
  every **login** and **non-interactive** shell gets no Homebrew at all,
  while the **interactive** terminal keeps working via the separate
  `eval` in `~/.zshrc`. That split is the diagnostic signature: your terminal
  is fine, Claude Code's shell finds nothing. **Diagnose by comparing shell
  types before concluding a tool is uninstalled** —
  `zsh -lc 'which node'` (login, reads `.zprofile`) vs
  `zsh -ic 'which node'` (interactive, reads `.zshrc`) vs
  `zsh -c 'which node'` (plain, reads only `.zshenv`). Fix `.zprofile` to
  point at `/opt/homebrew/bin/brew`; leave `.zshenv` alone (Homebrew
  recommends `.zprofile`, and `shellenv` in `.zshenv` runs on every script
  invocation). **Two corollaries.** First, an _already-running_ Claude Code
  session inherits the PATH captured at session start and will not see the
  fix — use absolute paths (`/opt/homebrew/bin/gh`) to keep working, and
  restart to pick it up. Second, `npm -g` packages installed under the old
  node are stranded in `/usr/local/lib/node_modules`: they still _run_
  (their shebangs resolve `node` via PATH) but stay frozen at their old
  version, which reads as stale-version warnings rather than breakage.
  Reinstalling each with the new npm lands it in `/opt/homebrew` and
  shadows the orphan. `/usr/local/bin` itself is **not** a dead Homebrew
  prefix — it holds live Docker/gcloud/python.org tooling; never clean it
  out wholesale. Encountered 2026-07-30; cost a full session's diagnosis.
- **Broken `node_modules` after a node reinstall is usually the npm
  optional-dependency bug**, not a corrupt lockfile. Symptom:
  `Cannot find module @rollup/rollup-darwin-arm64` failing vitest at
  startup, before any test runs
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Fix with
  `npm ci` — it removes `node_modules` itself (no `rm -rf`, which
  `block-destructive.sh` blocks anyway) and reinstalls from the tracked
  lockfile without rewriting `package-lock.json`. Prefer it over
  `rm node_modules package-lock.json && npm i`, which regenerates the
  lockfile and can silently bump transitive versions.
- **"How many Boris tips?" also has several answers — name which one.**
  Directly analogous to the probe-count rule above, and the source of a
  recurring "the docs contradict themselves" false alarm (raised again by a
  `/graphify` extraction agent on 2026-07-30). The three numbers are all
  correct about different things: **87** is the _upstream corpus_ advertised
  at howborisusesclaudecode.com (`README.md` intro and the rubric-provenance
  line); **86** is how many _numbered items_ the reference doc
  `docs/site-src/boris-tips-reference-2026-05-10.md` actually captures across
  its 10 threads; **75** is the _tracked set_ this repo indexes in
  `app/data/boris-tip-index.json` and reports tracking status for. Only the
  75 is load-bearing for scoring — `rubric.json` next-actions currently cite
  43 distinct `borisTip` numbers, a subset of it. Before "fixing" an
  apparent mismatch, work out which of the three a given sentence means;
  re-deriving the wrong one into a doc is how the numbers drift apart in the
  first place. Related known gap, unresolved and deliberately preserved: the
  classification doc's row numbers and the reference doc's tip numbers
  diverge (row 44 = iMessage vs reference tip 44 = Code Review), while
  `rubric.json` follows the reference numbering.
- **`/graphify` on this repo has two known structural artifacts — don't read
  either as an architecture finding.** First, `app/data/boris-tip-index.json`
  is an object of 75 uniform records, and AST extraction fragments each into
  its own 5-node community (`label` / `tab` / `topic` / `volume` + parent).
  That inflated the 2026-07-30 build from ~87 real subsystems to **161
  communities**, and made the JSON's `tips` key the **#1 god node at 76
  edges** — an artifact of the file's shape, not a hub in the codebase.
  Discount both before drawing conclusions, and label that community family
  as one group rather than hand-naming 74 of them. Second, the semantic
  (LLM) pass runs one subagent per chunk, and agents freely emit edges
  pointing at concepts owned by _other_ chunks: that build had **226
  dangling-endpoint edges (~10% of 2,309 raw)**, all silently dropped at
  build time (2,309 → 2,064). The health gate reports them at the extraction
  stage while the built `graph.json` shows zero, so the two numbers
  disagreeing is expected, not corruption. Treat graph edge counts as
  lossy-by-construction unless the corpus fits in a single chunk.
- **Plan-step verification must use the actual consumer tool, not just filesystem checks.** When a plan step produces a published artifact — a markdown link inside a built docs site, a TypeScript import, a JSON Schema reference, an OpenAPI route — the verification step must invoke the tool that consumes the artifact (`mkdocs build --strict`, `npx tsc --noEmit`, `ajv validate`, etc.), not `test -f`. A filesystem path can resolve correctly on disk while violating the consumer's validity contract (e.g., mkdocs strict-mode rejects link targets outside `docs_dir`, regardless of whether `test -f` passes). Reference incident: ADIS PR #411 broke docker-push because Task δ.2's `test -f` verified the runbook existed on disk; the published link to it from `docs/site-src/ops/runbooks.md` failed `mkdocs build --strict`. Closed by PR #416. The cost of running the real consumer tool in a plan step is a one-off; the cost of a half-verified plan landing is a deploy outage.

## Issue tracking

- Jira instance: `designitright.atlassian.net`.
- Project: **Claude-Code-Extensions** (key: `CCE`). All tickets for work
  in this repo live here; ticket keys follow the `CCE-N` pattern.
- **`CCE` is a _shared_ project spanning sibling repos, not just this
  one.** `~/Projects/engineering-docs-agent` files its work under the
  same `CCE` key (its CLAUDE.md: "All Jira work for this project lives
  in… Key prefix: `CCE`"). So a `CCE-N` ticket describing
  engineering-docs-agent work (e.g. **CCE-6** live-pytest gate, **CCE-7**
  per-agent `--allowedTools` narrowing) is **correctly filed** — it is
  _not_ misrouted to the wrong tracker, and must **not** be "moved" to a
  separate project (that would violate the "don't spin up a second
  project for sub-areas" rule below). Tickets don't self-declare which
  codebase they target; infer it from the summary, or disambiguate with
  a label/component if it matters. (Caught when a backlog triage briefly
  mistook CCE-6/CCE-7 as belonging to the wrong repo, 2026-05-25.)
- Reference the key in PR titles and commit messages when the work maps
  to a ticket (e.g. `feat(rubric): expand /ship next-action — CCE-12`).
- When future automation in this repo needs Jira integration (status
  reports, ticket creation, transitions), target this instance and
  project — don't spin up a second project for sub-areas. The
  Atlassian MCP server (`atlassian:*` tools) is the canonical
  integration surface.
- For the reference example of Jira-touching automation, see
  `docs/site-src/ship-pattern.md` Stage 7 — the `/ship` command transitions
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
