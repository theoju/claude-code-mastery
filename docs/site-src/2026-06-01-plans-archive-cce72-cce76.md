---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/118
synthesized_into: []
---

# Plans archive: CCE-72 and CCE-76 (PR #118)

Two implementation plan documents were moved from `docs/superpowers/plans/` to
`docs/superpowers/plans/archived/` as standard post-ship housekeeping following
the v0.9.18 release. No content was edited; this was a pure `git mv`.

## What moved

| Plan | Feature | Shipped |
| ---- | ------- | ------- |
| CCE-72 — `/ship` journal stage-credit | Stage-credit counters in the ship journal (`stageRanInEntry()`) across all three journal format generations | PR #113 |
| CCE-76 — Memory & Customization Execution scorers | Transcript-derived posture-command coverage signals for the Memory & Context Management and Terminal & Customization Execution scorers; completed all-twelve-dimensions Execution coverage | PR #116 |

## Convention

Active plans live in `docs/superpowers/plans/`. Once the associated PR merges,
the plan moves to `plans/archived/` so the active directory only reflects
in-flight work. Both CCE-72 (PR #113) and CCE-76 (PR #116) landed in v0.9.18
before this archival step.

## No behavior change

PR #118 has no user-visible impact. Scoring rules, signals, dashboard
rendering, and the probe set are all unchanged. If you are looking for the
implementation detail of either feature, the archived plan documents are still
in the repo under `docs/superpowers/plans/archived/`.
