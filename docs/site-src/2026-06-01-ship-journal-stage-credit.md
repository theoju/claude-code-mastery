---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# Ship journal stage credit fix (CCE-72 / PR #113)

The `/ship` workflow stage counter was silently under-crediting Stage 2
(verify-agent) and Stage 3 (simplify) for users whose ship journals contained
entries in older format generations. PR #113 fixes `stageRanInEntry()` in
`scripts/signals.mjs` to detect stage execution correctly across all three
journal shapes.

## Background: three journal format generations

The ship journal has accumulated three distinct on-disk shapes as the `/ship`
slash command evolved:

| Generation | Shape | How stage is stored |
| --- | --- | --- |
| Current | `entry.stages_run` (string array) | `["test", "verify-agent", "simplify", …]` |
| Legacy numeric | `entry.stages_run` (number array) | `[1, 2, 3, …]` — stage indexes |
| Singular | `entry.stage` (string or number) | one stage per journal entry |

Before this fix, `stageRanInEntry()` only recognized the current string-array
form. An entry written by an older `/ship` in the singular or legacy-numeric
format returned `false` for every stage lookup, so the scorer counted zero
Stage 2 / Stage 3 executions even when those stages genuinely ran.

## What changed

`stageRanInEntry()` now checks all three variants in order:

1. `entry.stage` (singular) — matches by stage name or numeric index.
2. `entry.stages_run` as a number array — tests whether the stage's numeric id
   is in the set.
3. `entry.stages_run` as a string array — the current form, unchanged.

Stage numbers 0–7 map to: pre-flight, test, verify-agent, simplify, code-review,
commit, push-pr, jira-update. New stages append to the end of that list; the
numeric detector arm stays stable.

The fix is purely additive: no existing scoring logic changed, no counts
shrink. Users who only have current-format journal entries see no change.
Users with a mix of formats now receive correct stage credit for the full
history the scorer can read.

## What else landed in the same PR

- **Probe tracker spec updated** — `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
  reflects the corrected signal semantics. The tracker header counts are CI-enforced
  by `scripts/__tests__/tracker-counts.test.mjs`; the PR updated them in sync.
- **Design spec and plan added** — `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
  and `docs/superpowers/plans/2026-06-01-ship-journal-stage-credit.md` document
  the root cause, the three-generation grammar, and the fix shape.
- **Test coverage extended** — `build-signals-summary` and `gather-ship-journal`
  test suites each gained cases that exercise the singular and legacy-numeric
  paths so a future format regression fails CI.

## Scoring impact

Stage 2 and Stage 3 feed the **Automation** dimension's Execution scorer. If your
ship journal has entries from before the current string-array format, your
Automation Execution score may increase after this fix — that reflects previously
uncredited work, not new behavior. No targets or weights changed.
