---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Memory & Customization now have real Execution scorers (CCE-76)

Until PR #116, two of the twelve dimensions on the Execution axis — **Memory
& Context Management** and **Terminal & Customization** — were placeholders.
`scripts/score.mjs` routed both straight to `unavailable(GAP_REASONS.NO_TRANSCRIPTS)`
style `noTelemetry()` handling, which the radar rendered as an italic,
0.65-opacity vertex with a footnote rather than a real score. That's no
longer true: both dimensions are now scored from transcript-derived
session-coverage counters, and **all twelve Execution dimensions are
numerically measured** for the first time.

## Why they were unmeasured

Cooked telemetry — `~/.claude/usage-data/{facets,session-meta}/*.json`, the
same files `/insights` reads — never breaks usage down by which slash
command a session ran. `/clear`, `/compact`, `/color`, `/voice`, `/focus`
only show up if you go one layer deeper and scan the raw transcript
JSONL under `~/.claude/projects/*/*.jsonl`. That signal already existed —
`scanTranscriptInvocations` in `scripts/_usage-data.mjs` has counted these
commands since the per-command partition work (CCE-71) — it just wasn't
wired into a scorer. `learning` (the `★ Insight` banner scan) and `parallel`
(worktree usage) already mixed transcript signals into Execution scoring;
this PR extends the same pattern to the two dimensions that had none.

## Two bugs had to be fixed first

**Counter class.** `focusCommandUses` and `rewindCommandUses` were still
counted as raw per-message invocations, while the other five posture
commands (`/btw`, `/clear`, `/compact`, `/color`, `/voice`, `/simplify`,
`/fewer-permission-prompts`) had already moved to session-coverage counting
(one increment per session that used the command at least once, capped by
session count rather than message count). PR #116 retrofits `/focus` and
`/rewind` to match: `_usage-data.mjs` now flips `sessionHasFocus` /
`sessionHasRewind` flags per-message and increments the counter once per
session after the drain, mirroring the existing `sessionHasBtw` /
`sessionHasClear` pattern.

**Universe mismatch.** All seven posture-command counters are gated by
`allowPosture` — true when `classifySessionKind` returns `"interactive_cli"`
*or* `"unknown"` (the conservative fallback for transcripts the classifier
can't confidently place). But the existing `interactiveSessionsAnalyzed`
denominator was strict `interactive_cli` only. Wiring a ratio scorer
straight against that denominator would have put a session classified as
`"unknown"` in the numerator without it ever appearing in the denominator —
exactly the numerator-not-a-subset-of-denominator violation the project's
hard rule (established after the CCE-71 / PR #97 planning-ratio bug)
forbids. The fix is a new universe rather than tightening `allowPosture`:
`insights-signals.mjs` now computes and returns

```js
interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates` in `scripts/score.mjs` grew a third `universe` option,
`"interactive_or_unknown"`, alongside the existing `"interactive_only"` and
`"all_sessions"`. The choice is recorded on the wrapped function as
`__universe` so tests and the methodology page can audit which denominator
a scorer actually uses.

## The scorers, as shipped

Both dimensions follow the same shape: sum session-coverage hits, divide by
`interactiveOrUnknownSessionsAnalyzed`, cap the ratio at 1, and normalize
against the dimension's rubric target.

**Terminal & Customization** (`app/data/rubric.json` target `80`, weight
`1`) sums `/color` + `/voice` + `/focus`:

```js
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const sum = maxProbe(s, "colorCommandUses")
      + maxProbe(s, "voiceCommandUses")
      + maxProbe(s, "focusCommandUses");
    const ratio = Math.min(sum / denom, 1);
    return { score: Math.round(ratio * 100), ... };
  },
)
```

**Memory & Context Management** shipped in the same PR summing all four
posture commands (`/btw`, `/clear`, `/compact`, `/rewind`) against target
`92` — but by the time this landed on `main`, a same-week follow-up
(**CCE-79**) had already narrowed the numerator to just `/clear` +
`/compact`. `/btw` is a cumulative all-time counter (it doesn't reset per
window), so summing it with three windowed session-coverage counters mixed
counter classes in one ratio — the same class of bug the project's
"per-field semantic categorization" rule now exists to catch. `/rewind` is
a keyboard shortcut that's near-zero in practice and stayed only as a
binary next-action probe. The rubric target was recalibrated `92 → 60`
to match the narrower, more honest ceiling:

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const sum = maxProbe(s, "clearCommandUses") + maxProbe(s, "compactCommandUses");
    const ratio = Math.min(sum / denom, 1);
    // /btw's all-time count still surfaces as evidence text, just not in the ratio.
    return { score: Math.round(ratio * 100), ... };
  },
)
```

`maxProbe` reads both `signals.transcriptInvocations` and
`signals.historyInvocations` and takes the max — `/btw` in particular is
often visible in shell history even when the transcript scan misses it,
so the merge recovers whichever source saw the signal.

## What this means for your score

If either dimension previously showed as an italic, unmeasured vertex on
your radar, it will now show a real number — and for most setups, a low
one. `/clear`, `/compact`, `/color`, `/voice`, and `/focus` are commands
most people type rarely relative to total session count, so a
`sum / interactiveOrUnknownSessionsAnalyzed` ratio starts small. That's the
point: the two dimensions were never actually being scored before, so a
correct low score is strictly more useful than a hidden gap. Model & Effort
Tuning remains the only dimension that's still partially measured (Opus
usage is scored from transcripts; effort level itself is settings-only and
has no transcript signal to fall back on).

Both scorers surface an honest "capped from N%" suffix in their evidence
string whenever a session fires more than one of the summed commands
(the ratio's numerator can double-count a single session across two
counters, e.g. `/clear` and `/compact` in the same conversation) — the cap
still bounds the displayed score to 100, but the over-use isn't silently
hidden.

## Where to look

- `scripts/score.mjs` — `EXECUTION_SCORERS.memory`, `EXECUTION_SCORERS.customization`,
  and the `withGates` universe option.
- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`.
- `scripts/_usage-data.mjs` — the `/focus` / `/rewind` counter-class
  unification and the `allowPosture` partition it now matches.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer test suite, including the CCE-79 numerator-narrowing regression
  tests.
