---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization get real Execution scorers

Until PR #116 (CCE-76), the **Memory & Context Management** and **Terminal &
Customization** dimensions were the last two of the twelve scored dimensions
with no Execution-axis measurement. `scripts/score.mjs` routed both straight
to `noTelemetry()`, so their radar vertices were permanently italicized —
regardless of how much you actually used `/clear`, `/compact`, `/color`,
`/voice`, or `/focus`. This page covers what replaced that placeholder, and
how the numbers on the radar are actually computed today.

## Why they were stuck on `noTelemetry()`

The dashboard's Execution axis is built from cooked telemetry —
`~/.claude/usage-data/{facets,session-meta}/*.json`, the same data
`/insights` reads. That format never breaks down which slash commands a
session used, so there was no cooked-telemetry field to score these two
dimensions against. But "no cooked-telemetry field" isn't the same as "no
signal" — `learning` (the `★ Insight` banner scan) and `parallel` (worktree
usage) already mix **transcript** signals into Execution scoring via
`withGates({ transcripts: true, ... })`. CCE-76 extends that same pattern to
Memory and Customization, drawing on the per-command posture counters that
`scanTranscriptInvocations` (`scripts/_usage-data.mjs`) already collects.

## The counters: session-coverage, not raw invocation count

`scanTranscriptInvocations` walks each session's transcript once and sets a
per-session boolean flag the first time it sees `/clear`, `/compact`,
`/color`, `/voice`, `/focus`, `/btw`, or `/rewind` — then increments the
matching counter once per session, at the end of the scan
(`scripts/_usage-data.mjs:406-417`). That's a deliberate design choice: these
are adoption signals ("did you reach for this at all this session"), not
frequency counters, so a session that ran `/clear` five times still
contributes 1.

All seven counters are also gated by `allowPosture` — they only increment
for sessions classified `interactive_cli` or `unknown` (the conservative
fallback for transcripts `classifySessionKind` can't confidently place).
Observer and SDK-orchestrated sessions frequently echo `<command-name>`
markup from the session they're shadowing, so counting them would inflate
posture signal for commands the operator never actually typed. This is the
same partition CCE-71 established for the other posture commands
(`/simplify`, `/fewer-permission-prompts`, `/effort max`), just extended to
`focusCommandUses` and `rewindCommandUses`, which had been counted as raw
per-message hits until this PR unified their counting class with the other
five.

Each counter also has a history-derived twin (`historyInvocations`), and
`maxProbe(signals, field)` (`scripts/score.mjs:544`) takes the max of the
two sources per field — history has better fidelity for side-channel
commands like `/btw` that don't always land in the session JSONL;
transcripts have better fidelity for everything else.

## A new session universe: `interactive_or_unknown`

The posture-command partition allows `interactive_cli ∪ unknown` sessions
into the numerator. Before this PR, `withGates`'s `interactive_only` universe
denominator (`s.insights.interactiveSessionsAnalyzed`) was strict
`interactive_cli` — narrower than the numerator's universe. Per the
CLAUDE.md hard rule from the planning-scorer incident (PR #97): a ratio's
numerator must be a subset of its denominator's universe, or the ratio can
silently exceed 100%.

The fix, rather than tightening the numerator (which would have thrown away
the deliberate `unknown` fallback), was to widen the denominator to match.
`scripts/insights-signals.mjs` now computes:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` (`scripts/score.mjs:597-626`) accepts a third `universe`
option, `"interactive_or_unknown"`, that reads this field as the denominator
— alongside the existing `interactive_only` and `all_sessions` options. Both
new scorers declare `withGates({ transcripts: true, universe:
"interactive_or_unknown" }, ...)`, so `s.insights.transcriptsScanned` must
also be true (i.e. `--include-transcripts` was passed) or the dimension
returns `gapReason: NO_TRANSCRIPTS` instead of a score.

## The scorers themselves

Both scorers (`scripts/score.mjs:977-1034`) follow the same shape: sum a
subset of the posture counters via `maxProbe`, divide by
`interactiveOrUnknownSessionsAnalyzed`, cap at 1.0, round to a 0–100 score.

**Memory** (rubric target `60`, tips 4/45/62/63/64/70):

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const ratio = Math.min(sum / denom, 1);
const score = Math.round(ratio * 100);
```

Only `/clear` and `/compact` feed the ratio. `/btw` and `/rewind` were
originally in scope too, but a follow-up redesign (CCE-79) pulled them back
out once the per-field semantics were checked against the CLAUDE.md
numerator rules: `/btw`'s adoption signal is more honestly represented as a
**cumulative all-time** counter (`cliBtwUseCountAllTime`), not a windowed
session-coverage rate, and mixing it into a windowed ratio's numerator would
have overstated recent posture as account age grew. It's still surfaced —
just as evidence text, not inside the ratio:

> Memory hygiene commands: 23 session-coverage hits across 120
> interactive_cli∪unknown sessions (19.17%). Plus 39 all-time /btw
> invocations (cumulative, not in ratio).

`/rewind` dropped out too — it's a near-zero-frequency signal in practice
(a keyboard shortcut more than a typed command) that doesn't carry enough
weight to justify blending its semantics into the ratio. It's kept alive
purely as a rubric next-action (`rewindCommandUses>=1`, Boris tip 62), gating
a "get into the /rewind reflex" prompt rather than moving the score.

**Customization** (rubric target `80`, tips 11/16/22/23/25/26/27/38/40/71):

```js
const color = maxProbe(s, "colorCommandUses");
const voice = maxProbe(s, "voiceCommandUses");
const focus = maxProbe(s, "focusCommandUses");
const sum = color + voice + focus;
const ratio = Math.min(sum / denom, 1);
```

All three posture commands stayed in scope here — there was no cumulative-
vs-windowed or session-coverage-vs-raw-count mismatch to resolve.

## The cap is visible, not silent

A session that fires both `/clear` and `/compact` contributes 1 to each
counter, so the numerator can legitimately exceed the session count (a user
who hygiene-cleans context in most sessions can rack up `sum > denom`).
`Math.min(ratio, 1)` bounds the displayed score at 100, but both scorers also
surface the raw ratio in evidence when it clears 1.0:

```
Customization commands: 30 session-coverage hits across 10
interactive_cli∪unknown sessions (300.00%) — capped from 300%
(multiple customization commands per session)
```

A misleadingly clean "100/100" would hide genuinely heavy multi-command
usage; the capped-from suffix keeps that visible on the dimension page. A
cleaner fix — a single `sessionsWithAnyMemoryCommand` /
`sessionsWithAnyCustomizationCommand` aggregate that eliminates the
multi-counting instead of just disclosing it — is still open as future work.

## Failure paths

Both scorers fall through `withGates`'s standard gate chain before their
body ever runs:

| Condition | Result |
| --- | --- |
| `s.insights` missing | `gapReason: NO_INSIGHTS` — run `/insights` |
| `s.insights.transcriptsScanned` is falsy | `gapReason: NO_TRANSCRIPTS` — set `scoring.includeTranscripts: true` or pass `--include-transcripts` |
| `interactiveOrUnknownSessionsAnalyzed === 0` | `gapReason: NO_SESSIONS` — nothing in the lookback window |
| Gates pass, but sum of counters is 0 | scores `0`, evidence lists which commands never fired, `gapReason: null` |

That last row matters: a dimension with a real zero score is not the same as
an unmeasured one, and the radar (`app/components/RadarChart.tsx`) only
italicizes a vertex when `gapReason !== null`. Once transcripts are scanned
and sessions exist in the window, Memory and Customization render solid —
even at a low score — same as every other measured dimension.

## Net effect

All twelve scoring dimensions now have Execution scorers. Model & Effort
Tuning remains the only *partially*-measured one (Opus-usage share comes
from transcripts; effort level itself is still settings-only, Platform
Setup territory). The italic-unmeasured label on the radar is no longer a
property of *which dimension* you're looking at — it only fires per-run,
per-user, when `gapReason` is genuinely non-null (e.g. zero interactive
sessions in the current lookback window).
