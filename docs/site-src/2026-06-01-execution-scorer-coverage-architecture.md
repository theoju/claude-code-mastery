---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Execution scorer coverage architecture

PR #116 (CCE-76 + CCE-79) completed Execution scorer coverage for all twelve
scoring dimensions. Before this change, Memory & Context Management and
Terminal & Customization returned `noTelemetry()`, rendering their radar
vertices italic and excluding them from the Execution overall average.

## The gap and its source

Every Execution scorer runs through `withGates` in `scripts/score.mjs`. That
wrapper checks three things in order: `s.insights` exists, transcripts were
scanned (if `opts.transcripts: true`), and the universe denominator is nonzero.
If any gate fails, the scorer returns `unavailable(gapReason)` and the radar
marks that vertex as unmeasured.

Before PR #116, `EXECUTION_SCORERS.memory` and `EXECUTION_SCORERS.customization`
were both set to `noTelemetry()` — a stub that unconditionally returns
`unavailable(GAP_REASONS.NO_TELEMETRY)`. The rationale in CLAUDE.md was that
cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never
contains command-invocation breakdowns. That's true — but it conflated "cooked
telemetry" with "Execution data." The `learning` scorer had already used
transcript signals (the `★ Insight` banner scan) since before PR #97, and
`parallel` added a worktree-usage signal the same way. Transcript signals
through `withGates({ transcripts: true, … })` were already the established
pattern for exactly this case.

The signals were available. CCE-71 had already gated posture-command counters
in `scanTranscriptInvocations` to `interactive_cli ∪ "unknown"` via the
`allowPosture` check. The only missing pieces were: a denominator universe that
matched that gate, and two scorers that consumed the counters.

## The `interactive_or_unknown` universe

Three universes exist in `withGates` (`scripts/score.mjs:597-626`):

| Universe | Denominator field | When to use |
|---|---|---|
| `"interactive_only"` | `interactiveSessionsAnalyzed` | User posture (permissions, planning, model) — strict `interactive_cli` only |
| `"interactive_or_unknown"` | `interactiveOrUnknownSessionsAnalyzed` | Posture-command counters gated by `allowPosture` |
| `"all_sessions"` | `sessionsAnalyzed` | Volume metrics (integrations, scheduled, remote) |

The CLAUDE.md hard rule from PR #97 says a ratio's numerator must be a strict
subset of its denominator's universe, or the ratio can exceed 100%. The seven
posture-command counters in `scanTranscriptInvocations` are gated by:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

`classifySessionKind` returns `"unknown"` for any session whose transcript
lacks a recognized `entrypoint` field — truncated transcripts, legacy formats,
or new CLI shapes before the recognizer is updated. CCE-71 deliberately kept
`"unknown"` in `allowPosture` as a conservative fallback rather than
silently dropping those sessions.

If these scorers had used `"interactive_only"`, sessions classified as
`"unknown"` would appear in the numerator (their commands were counted) but
not in the denominator — producing a ratio that can exceed 100%. The fix is
`"interactive_or_unknown"`, computed in `scripts/insights-signals.mjs`:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

This mirrors the `allowPosture` gate exactly. Both fields are forwarded in
the `gatherInsightsSignals` return value.

## Counter-class unification (CCE-76 prerequisite)

Before PR #116, two of the nine posture counters were counted per-message
rather than per-session: `focusCommandUses` and `rewindCommandUses` incremented
once per matching user message rather than once per session. The other seven
(`btwCommandUses`, `voiceCommandUses`, `clearCommandUses`, `compactCommandUses`,
`colorCommandUses`, `fewerPermsCommandUses`, `simplifyCommandUses`) all used
per-session flags (`sessionHasBtw`, `sessionHasClear`, etc.) that flipped on
first sighting and incremented the counter once after the session drain.

The mismatch was an artifact of when `focus` and `rewind` were added (an
earlier PR before the per-session pattern was established). PR #116 retrofits
them to the same shape:

```js
// before
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

with matching emit lines after the session drain (`if (sessionHasFocus)
counts.focusCommandUses++; if (sessionHasRewind) counts.rewindCommandUses++`).

After this change, every posture-command counter in
`scanTranscriptInvocations` is a session-coverage counter: its maximum value
equals the number of `interactive_cli ∪ unknown` sessions scanned, not the
total number of times a command was invoked. The scorer math then has uniform
units — one hit per session regardless of how many times that session used
the command.

## Memory Execution scorer

The memory scorer (`EXECUTION_SCORERS.memory`, `scripts/score.mjs:977-1009`)
measures how consistently you use context-hygiene commands across interactive
sessions.

**Numerator:** `maxProbe(s, "clearCommandUses") + maxProbe(s, "compactCommandUses")`.
`maxProbe` takes `Math.max(transcriptInvocations?.[field], historyInvocations?.[field])`
to pick up whichever source saw the command — the history scanner covers
`~/.claude/history.jsonl` side-channel entries that don't always appear in
session transcripts.

**CCE-79 refinement:** the original CCE-76 design included `/btw` and `/rewind`
in the numerator sum. CCE-79 narrowed it on two grounds:

- `/btw` is a cumulative all-time counter (`cliBtwUseCount` from `~/.claude.json`),
  not a 30-day windowed session-coverage counter. Mixing it into a windowed
  ratio numerator violates the time-window axis of the per-field semantic rule.
  It's surfaced as evidence text instead: `"Plus N all-time /btw invocations
  (cumulative, not in ratio)"` via `s.signalsSummary?.cliBtwUseCountAllTime`.
- `/rewind` is a keyboard shortcut (`Ctrl+Z` during a session) that almost
  never appears in transcript `<command-name>` markup. A 30-day sample showed
  near-zero real occurrences; including it silently holds the target above
  what most users can reach. It's kept as a binary next-action probe in the
  rubric `satisfiedWhen` predicate but dropped from the ratio.

**Denominator:** `s.insights.interactiveOrUnknownSessionsAnalyzed`.

**Score formula:** `rawScore = Math.round(Math.min(sum / denom, 1) * 100)`.
Cap behavior: when a session uses both `/clear` and `/compact`, both counters
increment for that session, so `sum` can exceed `denom`. `Math.min(ratio, 1)`
bounds the displayed score at 100; when the cap fires, the evidence string
appends `"— capped from N% (multiple memory commands per session)"` so the
over-use is visible rather than hidden.

**Rubric target recalibration (CCE-79):** the memory dimension's `target` was
lowered from 92 to 60 when the numerator narrowed. With only `/clear` and
`/compact` in scope and a realistic ceiling around 30–40% session coverage
for active users, a target of 92 would make the scorer nearly unachievable.
60 maps a 60-session-coverage rate to a normalized score of 100.

## Customization Execution scorer

The customization scorer (`EXECUTION_SCORERS.customization`,
`scripts/score.mjs:1010-1034`) measures use of runtime UX-adjustment commands.

**Numerator:** `maxProbe(s, "colorCommandUses") + maxProbe(s, "voiceCommandUses") + maxProbe(s, "focusCommandUses")`.

**Denominator:** `s.insights.interactiveOrUnknownSessionsAnalyzed` (same universe).

**Score formula:** identical cap logic — `Math.min(sum / denom, 1) * 100`,
with the `"capped from N%"` suffix firing when `rawRatio > 1`.

The same `/color`, `/voice`, and `/focus` counters already feed the Platform
Setup customization scorer's `surfaces` breadth bonus (`scripts/score.mjs:419-421`).
The Execution scorer adds a usage-rate lens: Setup measures whether you've
configured the surfaces; Execution measures whether you're actively adjusting
them during sessions.

## Data flow

```
~/.claude/projects/*/*.jsonl (POSTURE_COMMANDS, allowPosture: interactive_cli ∪ unknown)
   │
   ▼  scanTranscriptInvocations (_usage-data.mjs)
   │  per-session flags → session-coverage counts
   │  clearCommandUses, compactCommandUses, colorCommandUses, voiceCommandUses, focusCommandUses
   │
   │  ~/.claude/history.jsonl (historyInvocations — MAX-merged for {clear,compact,color,voice,focus})
   │
   ▼  EXECUTION_SCORERS.memory / .customization (score.mjs)
   │  withGates({ transcripts: true, universe: "interactive_or_unknown" })
   │  denom = interactiveOrUnknownSessionsAnalyzed  (insights-signals.mjs)
   │  ratio = min(sum / denom, 1)
   │  rawScore = round(ratio * 100)
   │
   ▼  normalize(rawScore, d.target) → displayed Execution vertex on the radar
      memory target = 60 (post-CCE-79),  customization target = 80
```

## Guard rails

**`withGates` universe validation** — the function throws at module load if
the caller passes an unrecognized universe string. The wrapped function records
`fn.__universe` so tests and the methodology page can audit the contract
without re-running the scorer. Both `EXECUTION_SCORERS.memory.__universe`
and `.customization.__universe` are `"interactive_or_unknown"`.

**`assertCommandPartition`** — runs at module load in `_usage-data.mjs` and
throws if `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap, if a scanned
command is uncategorized, or if a partition member isn't in `TARGET_COMMANDS`.
This fail-loud guard catches drift when new commands are added to `TARGET_COMMANDS`
without being classified — the Execution scorers rely on partition-gating to
produce meaningful ratios.

**Numerator-subset-of-denominator** — the `gather-insights-signals.test.mjs`
suite asserts `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed`
for any fixture. A gate-drop at the counting layer that narrows the denominator
below the numerator's actual universe fails CI before it reaches a
misleading > 100% score.

## Effect on the Execution overall

Before PR #116, `executionOverall` was computed as a weight-normalized mean
over the ten dimensions that produced a numeric `executionScore`. Memory and
Customization contributed `null` (unmeasured) and were excluded from the
average.

After PR #116, all twelve dimensions produce a numeric `executionScore` when
transcripts are scanned. Both dimensions score low for a typical user (Memory
Execution ~16–57/100 depending on `/clear`+`/compact` frequency; Customization
Execution low if `/color`, `/voice`, and `/focus` are rarely used). Including
two previously-excluded low-scoring dimensions in the average lowers
`executionOverall` — the drop is real signal, not a regression. The
methodology page documents the new measurement basis; the radar vertices
automatically render as solid lines (not italic) when `gapReason === null`.

## What this doesn't change

- **Five machine-enforced probe-tracker header counts** (75/12/48/47/71) are
  unchanged. No new `probe-catalog.json` entries, no new `satisfiedWhen`
  predicates, no new `signalsSummary` keys. The new
  `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry
  `insights` block (tracker Part 1 Insights layer) but has no machine-count.
- **Platform Setup scorers** — `SCORERS.memory` and `SCORERS.customization`
  in `score.mjs` are unchanged. The changes touch `EXECUTION_SCORERS` only.
- **`RadarChart.tsx`** — no UI code changed. The italic/solid distinction
  already keyed on `gapReason !== null`; once the scorers return
  `gapReason: null`, the vertices render solid automatically.
