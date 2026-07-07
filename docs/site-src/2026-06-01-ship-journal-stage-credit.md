---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# Ship-journal stage credit: read all three journal format generations

PR #113 (CCE-72) fixed a false negative in `simplifyCommandUses`: users with
`/ship` deeply integrated into their workflow — invoking Stage 3 (simplify)
and Stage 2 (verify-agent) as dispatched subagents on every PR — were scoring
`simplifyCommandUses=0` and getting nagged by the `automation/simplify-skill`
next-action despite the habit being fully adopted.

## The gap

`scanTranscriptInvocations` scans transcripts for the literal
`<command-name>/simplify</command-name>` markup. But `/ship` Stage 3 doesn't
type `/simplify` — it dispatches the `code-simplifier:code-simplifier`
subagent via the Task tool, which emits a `tool_use` block with
`subagent_type`, not a slash-command marker. So the transcript scanner never
sees it.

The correction signal — `~/.claude/ship/journal.jsonl` — was already being
read for `stage2Count`, but only via a single check: `entry.stage === 2`.
That check only matches the **oldest** of three journal format generations
that have accumulated as `/ship`'s own schema evolved:

1. **Oldest (singular):** `entry.stage` is a bare integer — `{ts, stage: 1}`
2. **Intermediate (legacy-numeric):** `entry.stages_run` is an array of
   integers — `{ts, outcome: "shipped", stages_run: [0,1,2,3,4,5,6]}`
3. **Latest (new-string):** `entry.stages_run` is an array of stage names —
   `{ts, outcome: "shipped", stages_run: ["pre-flight", "test",
   "verify-agent", "simplify", ...]}`

Format 1 only tracks `entry.stage === 2` correctly; formats 2 and 3 were
invisible to the old check entirely. On the author's own 194-entry journal,
that meant ~41% of entries (the whole `stages_run` cohort) went uncounted —
not just for simplify, but for `stage2Count`/`shipVerifyStageRecent` too,
which reads the same journal.

## The fix

`scripts/signals.mjs` now exports a pure helper,
`stageRanInEntry(entry, legacyNumber, newName)`, that checks all three
formats behind one strict-equality contract:

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
malformed `stages_run` array never matches the integer legacy number — no
extra defensive code needed (`stageRanInEntry`'s own test suite in
`scripts/__tests__/gather-ship-journal.test.mjs` asserts this explicitly).

`gatherShipJournal` now calls it twice per entry — once for verify-agent
(stage 2 / `"verify-agent"`), once for simplify (stage 3 / `"simplify"`) —
and returns a new `simplifyStageCount` field alongside the existing
`stage2Count`, `totalRuns`, and `lastRunAt`. The stage-number → stage-name
mapping is canonical and documented inline at `stageRanInEntry`'s call site:

| # | name | # | name |
|---|------|---|------|
| 0 | pre-flight | 4 | code-review |
| 1 | test | 5 | commit |
| 2 | verify-agent | 6 | push-pr |
| 3 | simplify | 7 | jira-update |

Future `/ship` stages append to the end of this list — they never insert in
the middle — so the numeric detector arm stays stable even as the
string-named arm becomes the primary format going forward.

## Projection: MAX-merge into `simplifyCommandUses`

`run-assessment.mjs`'s `buildSignalsSummary` already MAX-merges
`simplifyCommandUses` across transcript and history-derived sources via
`maxProbe`. PR #113 adds the journal as a third source:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`maxProbe` itself is untouched — a third-source MAX-merge didn't justify
generalizing it, so the extra source is folded in inline at the projection
boundary, matching the pattern already established for the `/color`
history merge. `shipVerifyStageRecent` needed no projection change at all:
it already read `signals.shipJournal?.stage2Count`, so it inherits the wider
count automatically once `gatherShipJournal` itself counts more entries.

## Lookback alignment (a second, smaller fix bundled in)

`gatherShipJournal`'s default `lookbackDays` parameter is still 14 (untouched,
for test callers), but the production call site in `signals.mjs` previously
hardcoded `{ lookbackDays: 14 }` while every other transcript-derived signal
used `insightsLookbackDays` (default 30). A MAX-merge across mismatched
windows compares unlike numerators, so the call site now passes
`insightsLookbackDays` through:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

## What this doesn't change

- No new probe-catalog entries, `satisfiedWhen` predicates, or
  `signalsSummary` keys — the probe-implementation-status tracker's five
  machine-enforced header counts are unaffected; the tracker gained only a
  footnote on the `shipVerifyStageRecent` and `simplifyCommandUses` rows.
- No branch/repo filtering of the journal — a user's simplify habit across
  every repo they `/ship` in counts as one adoption signal, by design.
- No generic subagent-dispatch detection (e.g. scanning transcripts for
  `Task` tool_use blocks). The `/ship` journal is a clean, structured signal
  source for this specific case; generic subagent scanning would also pick
  up unrelated adversarial-review dispatches — noise this fix doesn't need.

## Net effect

Two predicates that were undercounting now reflect real usage:

- `automation/simplify-skill` (next-action) — drops out of the
  weight×deficit top-N for users whose simplify habit runs through `/ship`
  rather than a typed `/simplify`.
- `verification/ship-verify-stage-recent` (dimension-scorer input) — the
  Verification Execution score moves up modestly for anyone who has shipped
  through `/ship` since its journal schema evolved past the singular-`stage`
  format.

Both directions are corrections, not regressions: the prior behavior was a
false negative, not a stricter-but-correct read of the same evidence.

See also: [`docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md)
for the full design spec, and the CLAUDE.md Conventions entry on
`stageRanInEntry` for the reference pattern future stage counters should
follow.
