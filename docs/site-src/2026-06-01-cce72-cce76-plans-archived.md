---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/118
synthesized_into: []
---

# Plans archived: CCE-72 and CCE-76 (PR #118)

Routine post-ship housekeeping. The plan documents for two features delivered
in v0.9.18 were moved from `docs/superpowers/plans/` into
`docs/superpowers/plans/archived/` — no content was changed, only the
location.

## What was archived

**CCE-72** — `/ship` Stage 2/3 journal-credit. Added journal-entry counters
for the verify-agent (Stage 2) and simplify (Stage 3) phases of the `/ship`
workflow, using `stageRanInEntry()` to detect execution across all three
journal format generations (singular `entry.stage`, legacy-numeric
`stages_run`, new-string `stages_run`).

**CCE-76** — Memory & Context Management and Terminal & Customization
Execution scorers. Brought all twelve dimensions up to full Execution
coverage. The two new scorers consume transcript-derived posture-command
coverage signals gated on `interactive_cli ∪ unknown` sessions — the same
pattern established by the learning (★ Insight banner) and parallel
(worktree usage) scorers.

## Why plans get archived

The active plans directory (`docs/superpowers/plans/`) is a working-state
surface: it should reflect only work still in flight. Once the corresponding
PR merges and the feature ships, the plan moves to `archived/` so the
directory stays readable without manual filtering. The `plans-audit` test
(which checks that no archived plans are cross-linked from active surfaces)
stays green through this move.
