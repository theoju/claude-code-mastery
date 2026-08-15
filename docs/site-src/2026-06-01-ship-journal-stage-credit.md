---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship journal stage credit: reading all three `journal.jsonl` formats

PR #113 fixes a false negative in the `/ship`-derived signals: users who run
`/ship` with Stage 2 (verify-agent) and Stage 3 (simplify) dispatching real
subagent work could still score `simplifyCommandUses=0` and get no credit
toward `shipVerifyStageRecent`, because the reader only understood the oldest
of three `~/.claude/ship/journal.jsonl` formats `/ship` has written over its
lifetime.

## The gap

`/ship` dispatches Stage 2 and Stage 3 as subagent Task calls, not as literal
`/simplify` slash-command markup — so `scanTranscriptInvocations` never sees
them; it's scanning transcripts for `<command-name>/simplify</command-name>`
text, which a subagent dispatch doesn't emit. The only durable record that a
stage ran lives in the ship journal itself.

The problem was that `gatherShipJournal` in `scripts/signals.mjs` checked only
`entry.stage === 2`, which matches the oldest journal format. `/ship`'s
journal schema evolved twice since then, and the reader was never updated to
follow it. An empirical survey of a 194-entry journal (cited in the design
spec) found three format generations coexisting in the same file:

| Generation             | Shape                                   | Share of survey |
| ----------------------- | ---------------------------------------- | ---------------- |
| Oldest (singular)       | `entry.stage` (integer)                  | 113 / 194        |
| Intermediate            | `entry.stages_run` (array of integers)   | 80 / 194 total   |
| Latest (new-string)     | `entry.stages_run` (array of stage names)| subset of the 80 |
| Malformed               | unparseable line                         | 1 / 194          |

Only the first row matched the old `entry.stage === 2` check. That's roughly
41% of entries — the entire `stages_run` cohort — going uncounted, which is
exactly why a user who ships through `/ship` on nearly every PR could still
see `simplifyCommandUses=0` and have `automation/simplify-skill` surface as a
top-priority next-action despite the habit already being adopted.

## The fix: a format-aware detector

`scripts/signals.mjs` now exports a pure helper, `stageRanInEntry`, that
checks all three shapes:

```js
export function stageRanInEntry(entry, legacyNumber, newName) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.stage === legacyNumber) return true;
  const sr = entry.stages_run;
  if (Array.isArray(sr)) {
    return sr.includes(legacyNumber) || sr.includes(newName);
  }
  return false;
}
```

`Array.prototype.includes` is strict-equality, so a string `"3"` in a
`stages_run` array never matches the integer legacy number `3` — no defensive
type coercion needed. `gatherShipJournal` (also in `scripts/signals.mjs`) now
calls `stageRanInEntry(entry, 2, "verify-agent")` for the verify-agent counter
and `stageRanInEntry(entry, 3, "simplify")` for a new `simplifyStageCount`
counter, replacing the old single-format check.

The canonical stage-number-to-name mapping the detector relies on is
documented next to the helper:

```text
0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
5 commit     | 6 push-pr | 7 jira-update
```

New `/ship` stages are expected to append to the end of this list rather than
insert in the middle, so the numeric legacy arm stays stable going forward.

## Projection: MAX-merged, not replaced

`gatherShipJournal`'s new `simplifyStageCount` doesn't replace the existing
transcript- and history-derived counters for `/simplify` — it's MAX-merged in
alongside them at the projection layer in `scripts/run-assessment.mjs`:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

This mirrors the same pattern used for the `/color` history merge (v0.9.16):
a third evidence source only ever raises the counter, never lowers it.
`shipVerifyStageRecent` needed no projection change at all — it already reads
`signals.shipJournal?.stage2Count`, so it inherits the widened detection
automatically.

## Lookback alignment

Before this fix, `gatherShipJournal`'s call site hardcoded a 14-day lookback
window while the transcript- and history-derived counters it's MAX-merged
against used the configurable `insightsLookbackDays` (default 30). Comparing
a 14-day journal count against a 30-day transcript count meant the MAX-merge
was silently comparing unlike windows. The call site in `gatherSignals` now
passes `insightsLookbackDays` through:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

`gatherShipJournal`'s own parameter default stays at 14 days — that only
affects callers (tests) that don't pass `lookbackDays` explicitly; the one
production call site now widens to match.

## What this means for your score

If you use `/ship` regularly, two Execution signals can move after this
change lands in a run:

- `simplifyCommandUses` — now credits journal-derived Stage 3 dispatches, so
  `automation/simplify-skill` can drop out of your top-N next-actions if
  you're already shipping with simplify enabled.
- `shipVerifyStageRecent` — now counts verify-agent dispatches across all
  three journal formats, not just the oldest one, so the verification
  Execution score can tick up for anyone who's been shipping since the
  journal schema evolved.

Both directions are corrections, not new behavior — the prior counts were
undercounting. No new probes, `probe-catalog.json` entries, or
`signalsSummary` keys were added; the machine-enforced tracker header counts
in `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` are
unchanged.

## Reference

- Design spec:
  [`docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md)
- Implementation plan:
  [`docs/superpowers/plans/archived/2026-06-01-ship-journal-stage-credit.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/archived/2026-06-01-ship-journal-stage-credit.md)
- Tests: `scripts/__tests__/gather-ship-journal.test.mjs` covers all three
  format generations plus the `stageRanInEntry` helper directly.
- Ticket: [CCE-72](https://designitright.atlassian.net/browse/CCE-72)

The `stageRanInEntry()` pattern is now the reference implementation for any
future ship-journal counter — see the `## Conventions` section of this repo's
`CLAUDE.md`.
