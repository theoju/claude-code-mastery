---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Customization get real Execution scorers (CCE-76 / PR #116)

Before this change, two of the twelve rubric dimensions — **Memory & Context
Management** and **Terminal & Customization** — always rendered their
Execution vertex as italic and unmeasured on the radar, no matter how much
`/clear`, `/compact`, `/color`, `/voice`, or `/focus` usage showed up in your
transcripts. `scripts/score.mjs`'s `EXECUTION_SCORERS` mapped both dims to
`noTelemetry()`. PR #116 replaces both with real ratio scorers, closing the
gap: **all twelve rubric dimensions now have an Execution scorer** (Model &
Effort Tuning remains the only *partially* measured one — the Opus-usage half
is scored from transcripts, effort level stays settings-only).

## Why `noTelemetry()` was wrong, not just incomplete

CLAUDE.md's routing rule was correct about one thing and wrong about another.
It's true that cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`
— the files `/insights` reads) never contains a command-invocation breakdown,
so there's no way to score memory/customization posture from that source
alone. But the rule conflated "no cooked telemetry" with "no Execution
signal." Other dimensions already mixed transcript signals into Execution
scoring — `learning` via the `★ Insight` banner scan, `parallel` via
worktree-usage detection — through `withGates({ transcripts: true, … })`.
PR #116 extends that established pattern to memory and customization instead
of inventing a new one.

The raw signal already existed. `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` has counted `/btw`, `/clear`, `/compact`, `/rewind`,
`/color`, `/voice`, and `/focus` invocations per session since CCE-71, gated
by `allowPosture` to the `interactive_cli ∪ "unknown"` partition (so
observer/SDK echo sessions can't inflate the count). The scorer layer just
wasn't reading it.

## What shipped

### A new `interactive_or_unknown` universe

`withGates` in `scripts/score.mjs` already supported two session universes:
`interactive_only` (strict `interactive_cli`) and `all_sessions`. Neither fit
here. The posture-command counters are gated to `interactive_cli ∪ "unknown"`
— the `"unknown"` bucket is CCE-71's conservative fallback for transcripts
`classifySessionKind` can't confidently classify — so a numerator built from
those counters against an `interactive_only` denominator would violate the
project's numerator-subset-of-denominator rule (the same rule that caught the
planning-scorer bug in PR #97): sessions classified `"unknown"` would
contribute to the numerator without being represented in the denominator,
letting the ratio exceed 100%.

The fix was to widen the denominator to match the partition rather than
narrow the partition to match the old denominator (narrowing would have
undone CCE-71's deliberate fallback and risked under-counting non-standard
transcript shapes). `scripts/insights-signals.mjs` now computes and returns:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` grew a third branch:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

Both `EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization` are
gated with `withGates({ transcripts: true, universe: "interactive_or_unknown" }, …)`,
and both expose `__universe === "interactive_or_unknown"` so tests (and the
methodology page) can audit the contract.

### Counter-class unification for `/focus` and `/rewind`

`focusCommandUses` and `rewindCommandUses` had been incrementing per
*message* since the Bucket B detection framework (PR #40) — a raw
invocation count — while the other five posture counters (`btw`, `clear`,
`compact`, `color`, `voice`) already incremented per *session* (session
coverage: one hit per session that used the command at least once, capped at
the number of sessions scanned). Feeding a raw-invocation-count field into a
ratio numerator built from session-coverage fields is exactly the
counter-class mismatch CLAUDE.md's per-field semantic-categorization rule
warns about, so PR #116 retrofit `/focus` and `/rewind` to session-coverage
before wiring either into a scorer. The only test assertion this changed was
`scripts/__tests__/scan-transcript-invocations.test.mjs`, where a fixture
session with two `/rewind` messages flipped from asserting `toBe(2)` to
`toBe(1)`.

### The scorers themselves

Both scorers MAX-merge the transcript-derived count with the history-derived
count for each field (the same `maxProbe` pattern used elsewhere for `/btw`),
divide by `interactiveOrUnknownSessionsAnalyzed`, cap at 1.0, and surface the
cap explicitly in the evidence string rather than silently hiding an
over-100%-mapped ratio:

```
Memory hygiene commands: 23 session-coverage hits across 120 interactive_cli∪unknown sessions (19%)
Customization commands: 4 session-coverage hits across 120 interactive_cli∪unknown sessions (3%)
```

If a session used more than one covered command, its coverage gets counted
once per command — a session using both `/clear` and `/compact` contributes
2 to the numerator against a denominator that only allows 1 per session for
that session. `Math.min(ratio, 1)` bounds the displayed score to [0, 100],
and when the raw ratio exceeds 1 the evidence string now says so explicitly
(`… — capped from 160% (multiple memory commands per session)`) instead of
presenting a clean, misleadingly-complete 100.

Sequencing matters here: `scoreAll(rubric, signals)` runs in
`scripts/run-assessment.mjs` *before* `buildSignalsSummary(signals)`, so
Execution scorers see the raw `signals.transcriptInvocations` and
`signals.historyInvocations`, not the merged `signalsSummary`. That's why the
MAX-merge happens inline in the scorer body rather than being read off a
pre-merged summary field.

## It didn't stop there — CCE-79 narrowed the memory numerator

The version that shipped in PR #116 summed all four memory-adjacent counters
— `/btw`, `/clear`, `/compact`, `/rewind` — into one numerator. That didn't
survive contact with the project's own per-field semantic rule for long.
`/btw`'s adoption signal is genuinely different in kind from the other three:
`cliBtwUseCountAllTime` is a cumulative, all-time invocation count, not a
30-day windowed session-coverage figure, and mixing a cumulative counter into
a windowed ratio's numerator is exactly the class of bug CLAUDE.md's hard
rules call out (the same failure mode as the `/btw` blend fixed earlier in
CCE-78). `/rewind`, meanwhile, turned out to be a near-zero signal in
practice — it's a keyboard shortcut, rarely typed as a slash command — so it
contributed noise more than posture information.

The current `scripts/score.mjs` (as of CCE-79) restricts the memory
numerator to the two genuinely comparable session-coverage signals:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
```

`/btw`'s cumulative count now surfaces as evidence text instead of ratio
input (`Plus 42 all-time /btw invocations (cumulative, not in ratio).`), and
`/rewind` is kept only as a binary next-action probe
(`rewindCommandUses>=1`, rubric id `rewind-reflex`) rather than a ratio term.
The rubric's `memory.target` was recalibrated from 92 to 60 to match the
narrower, more honest ceiling — see `app/data/rubric.json`'s `memory`
dimension and `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
(tests 12a–12f) for the full before/after behavior. The customization scorer
was unaffected by CCE-79 — `/color`, `/voice`, and `/focus` were already
comparable session-coverage fields, so its numerator (`color + voice +
focus`) is unchanged from what PR #116 shipped.

## What this means on the dashboard

Both dimensions now render solid vertices on the Execution radar instead of
italic-unmeasured ones — `app/components/RadarChart.tsx` already branches on
`gapReason === null`, so no rendering code needed to change once the scorers
stopped returning `unavailable(...)`. `app/methodology/page.tsx`'s Memory and
Customization sections were updated to describe the new measurement basis
rather than the old "no telemetry available" note.

If you're auditing your own numbers: run
`npm run assess --include-transcripts --insights-lookback 30 --print` and
look for the `Memory hygiene commands: … interactive_cli∪unknown sessions`
and `Customization commands: …` evidence lines in the printed dimension
block. A `gapReason` other than `null` on either dim means either transcripts
weren't scanned (pass `--include-transcripts`) or the `interactive_or_unknown`
denominator was zero for the lookback window you chose.
