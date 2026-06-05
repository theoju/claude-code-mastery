---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# `/ship` journal stage credit — CCE-72 (PR #113)

**Problem:** If you had `/ship` deeply integrated, `simplifyCommandUses` read
`0` and the `automation/simplify-skill` next-action kept appearing in your
top-N even after the habit was fully adopted. The `shipVerifyStageRecent`
signal suffered the same silent undercounting. Both came from the same root
cause: `gatherShipJournal` only matched `entry.stage === 2`, which covered
the original single-field journal schema but missed approximately 41% of
entries written in the later `stages_run` array format.

## What changed

A new pure helper, `stageRanInEntry(entry, legacyNumber, newName)`, was added
to `scripts/signals.mjs`. It collapses three journal format generations into a
single strict-equality check:

| Generation | Shape in `~/.claude/ship/journal.jsonl` | Covered by |
| ---------- | --------------------------------------- | ---------- |
| Original   | `{ stage: 2 }`                          | `entry.stage === legacyNumber` |
| Legacy array | `{ stages_run: [2, 3, 5] }` (numeric) | `entry.stages_run.includes(legacyNumber)` |
| Current array | `{ stages_run: ["simplify", "verify"] }` (string names) | `entry.stages_run.includes(newName)` |

`gatherShipJournal` now calls `stageRanInEntry` for both Stage 2
(verify-agent) and Stage 3 (simplify), and surfaces a new
`simplifyStageCount` counter alongside the broadened `stage2Count`.

In `run-assessment.mjs`, the `simplifyCommandUses` projection MAX-merges the
journal's `simplifyStageCount` — the same pattern the v0.9.16 `/color`
history fix used for transcript-vs-settings blending. The journal lookback
window was also extended from 14 days to 30 days so it aligns with the
transcript-derived signals it feeds.

## User-visible effect

If `/ship` is already part of your workflow the score change is likely zero —
Automation and Verification scorers that were already saturating stay
saturated. The visible fix is in **next-action suppression**: after this
change, `automation/simplify-skill` and `ship-verify-stage-recent` correctly
exit the top-N for users whose journal contains Stage 2 / Stage 3 entries
written in the array format.

Run `npm run assess:print` and check whether either action drops off the list.
If it does, the undercounting was real in your environment.

## Stage number reference

The canonical stage 0–7 mapping (stable; new stages always append):

| # | Name | What it does |
| - | ---- | ------------ |
| 0 | pre-flight | Detect repo, branch, Jira key; create state file |
| 1 | test | Run test suite; halt on failure |
| 2 | verify-agent | Dispatch verify-agent subagent; halt on rejection |
| 3 | simplify | Invoke simplify skill (skip with `--no-simplify`) |
| 4 | code-review | Dispatch code-review agent; halt on hard findings |
| 5 | commit | Compose conventional-commit and create the commit |
| 6 | push-pr | Push branch and open PR |
| 7 | jira-update | Transition ticket to In Review; post PR link |

New journal-reading code should call `stageRanInEntry(entry, number, name)`
with both the numeric and string forms — that's the forward-compatibility
contract. See `scripts/signals.mjs` for the reference implementation and
`CLAUDE.md` Conventions for the pattern note.

## Related

- Design spec: `docs/superpowers/specs/` (committed in PR #113)
- Implementation plan: `docs/superpowers/plans/` (committed in PR #113)
- `/ship` pattern overview: [`docs/site-src/ship-pattern.md`](ship-pattern.md)
