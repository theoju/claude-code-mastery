---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
---

# `/ship` journal — stage-credit fix (CCE-72)

Stage 2 (verify-agent) and Stage 3 (simplify) runs were silently
under-counted in the `/self-assessment` scorer. PR #113 fixed the
detection gap by introducing a normalised helper,
`stageRanInEntry(entry, legacyNumber, newName)`, in
`scripts/signals.mjs`. If your verification or simplification Execution
scores jumped after updating, this is why.

## Background: three journal formats

`~/.claude/ship/journal.jsonl` has accumulated three serialisation shapes
over the history of the `/ship` command:

| Generation | Shape | Example stage field |
|---|---|---|
| 1 (original) | Singular `entry.stage` integer | `"stage": 2` |
| 2 (legacy-numeric) | `entry.stages_run` array of numbers | `"stages_run": [0, 1, 2, 3]` |
| 3 (current) | `entry.stages_run` array of strings | `"stages_run": ["pre-flight", "test", "verify-agent", "simplify"]` |

The prior credit logic only matched one format. An entry written by an
older `/ship` that used the numeric `stages_run` form (generation 2)
would fail the string-name check, and generation-1 singular entries
would miss the array check entirely. Stage 2 and Stage 3 were the
practical victims — both are optional, both run often, and both feed
Execution probes.

## What changed

`stageRanInEntry(entry, legacyNumber, newName)` is a pure helper that
checks all three forms in one call:

1. `entry.stage === legacyNumber` — generation 1 singular match
2. `Array.isArray(entry.stages_run) && entry.stages_run.includes(legacyNumber)` — generation 2 numeric array
3. `Array.isArray(entry.stages_run) && entry.stages_run.includes(newName)` — generation 3 string array

Every stage counter in `scripts/signals.mjs` that previously did an
inline `stages_run.includes(...)` check now calls `stageRanInEntry`
instead. The fix is backward-compatible: no journal files are rewritten,
no flags are needed.

## Effect on scores

If your `~/.claude/ship/journal.jsonl` contains entries from an older
`/ship` build, re-running `npm run assess` will credit those runs
correctly for the first time. You may see a one-time upward step in the
**Verification** Execution score (Stage 2: verify-agent) and the
**Automation** Execution score (Stage 3: simplify dispatches).

## Convention going forward

The CLAUDE.md convention (§Conventions, "Ship-journal counters use
`stageRanInEntry()`…") now requires all future stage counters to use
this helper. Adding a new stage counter follows the same pattern:

```js
// scripts/signals.mjs — new stage counter example
const stage7Runs = shipEntries.filter(e =>
  stageRanInEntry(e, 7, "jira-update")
).length;
```

Stages are numbered 0–7 (pre-flight, test, verify-agent, simplify,
code-review, commit, push-pr, jira-update). New stages append to the
end — the numeric detector arm stays stable, so existing journal entries
never need migration.

## Tests

Two test files were updated:

- `scripts/__tests__/gather-ship-journal.test.mjs` — exercises all three
  format generations per stage, including the verify-agent and simplify
  paths that were previously under-tested.
- `scripts/__tests__/build-signals-summary.test.mjs` — confirms the
  aggregated counters flow correctly through `buildSignalsSummary`.

The probe-implementation-status tracker
(`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`) was
updated in the same PR to reflect the corrected probe coverage for the
affected dimensions.

## See also

- Design doc: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-ship-journal-stage-credit.md`
- [`docs/site-src/ship-pattern.md`](./ship-pattern.md) — the `/ship` 8-stage chain overview
