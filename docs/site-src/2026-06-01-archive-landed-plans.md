---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
doc_kind: decision
---

# Archive: Landed Plans (2026-06-01)

**Decision**: Move four completed implementation plans to `docs/superpowers/plans/archived/` as part of routine plans-audit housekeeping.

## What moved

| Plan file | Shipped in |
| --------- | ---------- |
| `runtime-adoption-probes.md` | PR #94 |
| `CCE-33-progression-detectors.md` | PR #108 |
| `per-command-partition.md` | PR #110 |
| `predicate-ranker.md` | PR #104 |

All four are pure renames at 100% similarity — no content was altered during the move.

## Why

The plans-audit tooling flags active-directory plans whose corresponding PRs have merged. Leaving landed plans in the active directory creates false signal about what is actually in flight. Moving them to `archived/` keeps `docs/superpowers/plans/` limited to work that hasn't shipped yet.

## What stayed

`docs/superpowers/plans/2026-06-01-ship-journal-stage-credit.md` (PR #113, CCE-72) intentionally remained in the active directory for one more audit cycle per convention. It had merged immediately before this housekeeping pass; the convention is to let a freshly-landed plan sit one cycle before archiving.

## Convention

When a plan's PR merges, move the plan file to `docs/superpowers/plans/archived/` in the next housekeeping pass. The plans-audit tooling surfaces outstanding moves; batching them into a single cleanup PR is the standard pattern.
