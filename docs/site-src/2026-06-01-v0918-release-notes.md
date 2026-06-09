---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: decision
---

# v0.9.18 release notes

v0.9.18 bundles 13 PRs landed since v0.9.17 (PRs #99–#116). The version bump
itself is the only change in PR #117; all substantive work arrived in the
constituent PRs summarised below.

## Headline changes

### All 12 Execution dimensions now scored

v0.9.17 left the Memory & Context Management and Terminal & Customization
Execution scorers as `noTelemetry()` stubs — the "Are you using them?" axis
was honestly unmeasured for those two dims and the radar marked them italic.
v0.9.18 replaces both stubs with transcript-gated ratio scorers that consume
posture-command coverage signals from `interactive_cli ∪ unknown` sessions.
The Memory scorer counts `/clear` + `/compact` session coverage against the
`interactive_or_unknown` universe; the Terminal scorer does the same for the
remaining posture-command set. Both follow the precedent established by the
learning (`★ Insight` banner) and parallel (worktree usage) scorers —
transcript signals gated to the session kinds where posture is user-settable.

All 12 dimensions now return an Execution score. The italic/unmeasured label
on the radar applies only to dims whose scorer returns `gapReason !== null`
(e.g. zero qualifying sessions in the scoring window), not to these two.

### POSTURE / VOLUME command partition

Before v0.9.18, observer, SDK-orchestrated, and subagent sessions could inflate
posture-command counters. The fix introduces a canonical partition in
`scripts/_usage-data.mjs`:

- **`POSTURE_COMMANDS`** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) — counted
  only when `classifySessionKind` returns `interactive_cli` or `"unknown"`.
- **`VOLUME_COMMANDS`** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) —
  counted across every session kind; autonomous-workflow signal is valid
  regardless of how the session was launched.

A fail-loud `assertCommandPartition` assertion runs at module load. If the two
sets ever drift into non-disjoint state or a command loses its classification,
`npm run assess` exits non-zero before writing `assessment.json`. Check stderr
for the assertion message if the script exits with no output file.

### /ship Stage 2 and Stage 3 adoption counting fixed

The journal-format counter used a single-field check that only matched one of
the three journal generations. Stages 2 (`verify-agent`) and 3 (`simplify`)
were undercounted for users on the older numeric format or the new-string
format. The fix uses `stageRanInEntry()` across all three formats
(`entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`), matching
the pattern now used for all stage counters. This corrects an undercount in the
automation adoption signals that feed the Platform Setup score.

### Canonical predicate evaluator and pre-computed next actions

`scripts/predicate.mjs` is now the single source of truth for the `satisfiedWhen`
DSL. `app/lib/assessment.ts` exports a 1-line passthrough re-export — no
duplicate implementation. A CI test (`app/lib/__tests__/predicate-passthrough.test.ts`)
asserts reference equality; a copied implementation fails the build.

`assessment.json` now includes a `rankedNextActions` field pre-computed by
`scripts/rank-next-actions.mjs`. The `/self-assessment` command reads this
field directly rather than re-running the weight×deficit filter at report time.
Surfacing a satisfied action as a TODO is a data-layer regression, not a
report-layer one.

### /progression timeline extended to all 12 dimensions

The milestone timeline previously had no telemetry-dated detectors for the
`scheduled`, `remote`, and `verification` dimensions. Heavy real usage in those
areas produced no entries and the timeline appeared frozen past the first-run
config wall. v0.9.18 adds detectors for all three, so session data in those
dims now surfaces as dated milestones.

## Secondary changes

- **engineering-docs-agent plugin onboarding**: the docs site scaffolding and
  MkDocs upgrade (CCE-81 / CCE-82) landed in this window. Pages are now built
  and published via `docs-agent-pages.yml`; the `enablement: true` workaround
  was removed after the GitHub Pages source was bootstrapped via
  `gh api … build_type=workflow`.
- **`state.json` shape fix**: a field mismatch in the `/ship` state file caused
  a silent parse failure on certain journal formats. Fixed in this bundle.
- **Jira workflow migration**: the Jira transition step in `/ship` Stage 7 was
  updated to target the current project's workflow statuses.
- **Plan archival**: completed plan files moved from `docs/superpowers/plans/`
  to `docs/superpowers/plans/archived/` to keep the active plan list clean.

## Scoring impact

If you run `npm run assess` on v0.9.18 and your scores shift from v0.9.17, the
most likely causes are:

1. **Memory and Terminal dims now scored** — previously unmeasured dims default
   to 0 when `gapReason` is set; if you now have qualifying sessions, both dims
   will show a real number. Scores may go up (if you use the posture commands)
   or reveal a genuine gap.
2. **POSTURE counter correction** — posture ratios that were inflated by
   observer or SDK sessions will decrease, reflecting your actual interactive
   usage.
3. **Stage 2/3 adoption correction** — if you use `/ship` and your journal was
   in an older format, Platform Setup automation scores for those stages will
   increase.

No dimension weights or target values changed in this release.

## Upgrade

Pull the latest commit and run `npm install`. No migration steps required;
`assessment.json` and `assessment-history.json` are regenerated on the next
`npm run assess`.
