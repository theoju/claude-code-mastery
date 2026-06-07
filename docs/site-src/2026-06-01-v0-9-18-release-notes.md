---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
---

# v0.9.18 release notes

Released 2026-06-01. Bundles 13 PRs merged since v0.9.17 (2026-05-26).

This release closes the primary open item from the two-axis model: **all 12
scoring dimensions are now fully measured on both Platform Setup and
Execution axes.** It also fixes the v0.9.17 posture-ratio dilution regression,
canonicalizes the predicate evaluator, and extends the `/progression` timeline
to cover three previously-undetected dimensions.

---

## Headline changes

### Full two-axis coverage across all 12 dimensions — CCE-76 / PR #116

Memory & Context Management and Terminal & Customization both had `gapReason`
placeholders on the Execution axis instead of real scorers. Both are now fully
wired.

The new Execution scorers consume **transcript-derived posture-command coverage
signals** — the `interactive_cli ∪ unknown`-gated counters introduced by
CCE-71 — against the `interactive_or_unknown` session universe
(`sessionsByKind.interactive_cli + sessionsByKind.unknown`). This follows the
same pattern established for `learning` (★ Insight banner) and `parallel`
(worktree usage): transcript signals feed the Execution axis when no
cooked-telemetry equivalent exists.

**Effect on the dashboard:** the italic-unmeasured footnote (¹) on the radar
now only marks dimensions whose Execution score returns `gapReason !== null`
— i.e. zero qualifying sessions in the scoring window. With healthy session
activity the radar shows all 12 vertices in solid type.

### POSTURE/VOLUME command partition — CCE-71 / PR #110

v0.9.17 attempted a blanket filter that excluded `observer`, `sdk_orchestrated`,
and `subagent` sessions from `scanTranscriptInvocations`. That fixed the
posture-ratio dilution but regressed Scheduled Work (75 → 63) by discarding
real autonomous-workflow signal from volume commands like `/loop` and `/batch`.

The correct fix is a **per-command partition**:

- **POSTURE_COMMANDS** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) — counted
  only from transcripts where `classifySessionKind` returns `interactive_cli`
  or `unknown`. Posture signals in SDK-orchestrated or observer sessions aren't
  user-driven; including them dilutes the numerator against an
  `interactive_or_unknown` denominator and produces ratios that drift with
  account age.
- **VOLUME_COMMANDS** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) —
  counted across every session kind. An autonomous workflow is real signal
  regardless of which session kind emitted it.

A fail-loud `assertCommandPartition` assertion runs at module load and catches
drift (non-disjoint sets, missing classification, dead classification).

### /ship journal credit across all format generations — CCE-72 / PR #113

`/ship`'s Stage 2 (verify-agent) and Stage 3 (simplify) journal-credit
counters were silently skipping entries written in older formats. The fix
introduces `stageRanInEntry()`, which detects stage execution across all three
journal format generations:

- singular `entry.stage` (current)
- legacy-numeric `stages_run` array
- new-string `stages_run` array

Stage counters in `scripts/signals.mjs` use this helper. New stages should
append to the end of the mapping table in `stageRanInEntry`; inserting in the
middle breaks the numeric detector arm.

### Canonical predicate evaluator + pre-computed `rankedNextActions` — PR #106

`scripts/predicate.mjs` is now the **single source of truth** for the
satisfiedWhen DSL. `app/lib/assessment.ts:evaluatePredicate` is a one-line
passthrough re-export; `app/lib/__tests__/predicate-passthrough.test.ts`
asserts the two are reference-equal so a copy of the implementation fails CI.

The top-N next actions are pre-computed by `scripts/rank-next-actions.mjs` and
written into `assessment.json` as `rankedNextActions`. The `/self-assessment`
skill reads this field directly rather than re-implementing the
weight×deficit ranking. Surfacing a satisfied action as a TODO again is a
regression — fix the data layer, not the report.

### `/progression` timeline — new dimension detectors — CCE-33 / PR #108

The progression catalog previously covered 8 of 12 scored dimensions
(`automation, integrations, learning, memory, model-effort, parallel,
permissions, planning`). `scheduled`, `remote`, and `verification` had no
detectors, so heavy real usage in those dimensions produced no timeline entry.

PR #108 adds telemetry-dated detectors for the three previously uncovered
dimensions. The detectors use `start_time` timestamps from session metadata,
so they back-date correctly against historical data rather than stamping
first-run dates (the config-milestone limitation). If your timeline looked
frozen past the first-run wall for those dims, re-running `npm run assess`
after upgrading will retroactively populate the entries.

---

## Supporting changes

| Change | PR |
| --- | --- |
| Engineering-docs-agent plugin onboarding (`framework: mkdocs`, GitHub Pages bootstrap via `gh api`) | CCE-81 / PR #121, CCE-82 / PR #125 |
| `state.json` `dismissed_gap_flags` shape fix — was serializing as an object, now correctly an array | PR #118 |
| Jira workflow migrated to client-id auth + `vars.JIRA_EMAIL` | PR #119 |
| Plan archiving for completed superpowers plans | PR #120 |
| Documentation refreshes: probe tracker, rubric, methodology page | PRs #114, #115 |

---

## Bundled PRs

| PR | Summary |
| --- | --- |
| #106 | Canonical predicate evaluator + pre-computed `rankedNextActions` |
| #108 | `/progression` detectors for `scheduled`, `remote`, `verification` (CCE-33) |
| #110 | POSTURE/VOLUME command partition; `assertCommandPartition` boundary assertion (CCE-71) |
| #113 | `/ship` Stage 2/3 journal credit via `stageRanInEntry()` across all format generations (CCE-72) |
| #114 | Probe tracker updates |
| #115 | Rubric + methodology page documentation refresh |
| #116 | Memory & Terminal Execution scorers; completes 12-dimension two-axis coverage (CCE-76) |
| #118 | `state.json` `dismissed_gap_flags` array shape fix |
| #119 | Jira workflow: client-id auth + `vars.JIRA_EMAIL` |
| #120 | Archive completed superpowers plans |
| #121 | Engineering-docs-agent plugin onboarding, mkdocs upgrade (CCE-81) |
| #125 | Remove `enablement: true` from Pages workflow; document bootstrap via `gh api` (CCE-82) |
| #117 | Release: bump `package.json` to v0.9.18 |

---

## Upgrading

No breaking changes. Pull the latest and run:

```bash
npm install
npm run assess:print
```

If you're upgrading from v0.9.17, the `assertCommandPartition` assertion fires
at startup — a non-zero exit with a partition error message indicates a local
modification to `POSTURE_COMMANDS` or `VOLUME_COMMANDS` in
`scripts/_usage-data.mjs` that violates disjointness. Check the stderr output
before assuming an environmental issue.

The full per-change specs live under
[`docs/superpowers/specs/`](https://github.com/theoju/claude-code-self-assessment/tree/main/docs/superpowers/specs/).
