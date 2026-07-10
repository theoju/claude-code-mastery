---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

PR #116 (CCE-76) replaced `noTelemetry()` for the **Memory & Context
Management** and **Terminal & Customization** Execution scorers with real
ratio scorers. Before this PR, those were the last two of the twelve scored
dimensions still routed to unmeasured on the Execution axis — every other
dimension had a working Execution scorer, these two rendered as italic
vertices on the radar with a footnote instead of a number. After it, **all
twelve dimensions have an Execution scorer** (Model & Effort Tuning remains
the only *partially*-measured one — the Opus-usage half is scored from
transcripts, effort level stays settings-only, per `CLAUDE.md`).

## Why these two were stuck on `noTelemetry()`

Cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never
carries a command-invocation breakdown, so there was no obvious ratio input
for "did you use `/clear`, `/compact`, `/color`, `/voice`, `/focus`?" But
`CLAUDE.md`'s rule was really about cooked telemetry, not about Execution in
general — `learning` (the `★ Insight` banner scan) and `parallel` (worktree
usage) already mixed transcript signals into Execution scoring via
`withGates({ transcripts: true, ... })`. CCE-76 extends that established
pattern to the posture-command counters that CCE-71 had already made
trustworthy (partition-gated so observer/SDK sessions can't echo-inflate a
count).

## The counters: session-coverage, not raw invocations

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walks each session's
transcript and, for **posture commands** (`/btw`, `/clear`, `/compact`,
`/color`, `/voice`, `/focus`, `/rewind`, `/simplify`,
`/fewer-permission-prompts`), only counts a hit when `allowPosture` is true —
i.e. `classifySessionKind(path)` returned `interactive_cli` or the
conservative `"unknown"` fallback. Before this PR, `focusCommandUses` and
`rewindCommandUses` were the two odd ones out: they incremented once per
*message* containing the command, while the other five posture counters
already incremented once per *session* (a `sessionHasX` flag flipped to
`true` on first sighting, then one `counts.xCommandUses++` after the session
drains). PR #116 retrofitted `/focus` and `/rewind` onto the same
per-session-flag shape (`scripts/_usage-data.mjs:315-417`), so all seven
posture counters are now uniform "at most one hit per session" units — a
prerequisite for summing them into a single ratio numerator without mixing
counter classes.

## The new `interactive_or_unknown` universe

Every ratio scorer in this codebase has to obey the numerator-subset rule
from `CLAUDE.md`: a ratio's numerator must be a strict subset of its
denominator's universe, or the ratio can silently exceed 100%. The seven
posture counters are gated to `interactive_cli ∪ "unknown"` — but the
existing `interactive_only` universe option in `withGates` (`scripts/score.mjs`)
only exposes `s.insights.interactiveSessionsAnalyzed`, i.e. strict
`interactive_cli`. Using that as the denominator for a numerator that
includes `"unknown"`-classified sessions would violate the rule.

PR #116 closes the gap with a new universe:

- `scripts/insights-signals.mjs` computes
  `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown`
  right after the existing `interactiveSessionsAnalyzed` line, and forwards it
  through the returned insights object.
- `withGates` (`scripts/score.mjs`) grew a third `universe` option,
  `"interactive_or_unknown"`, alongside `"interactive_only"` and
  `"all_sessions"`. The wrapped function records its choice on
  `wrapped.__universe` so tests and the methodology page can audit which
  universe each scorer uses.

`"unknown"` stays in the mix deliberately: CCE-71 introduced it as a
conservative fallback for transcripts `classifySessionKind` can't confidently
classify (truncated or legacy-format files), and tightening the posture
partition to drop it would under-count real usage for anyone with
non-standard transcript shapes. Widening the denominator to match the
numerator's universe is the smaller, principled fix.

## The scorers today

Both scorers are `withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`
bodies in `scripts/score.mjs`, each summing session-coverage counts and
dividing by `s.insights.interactiveOrUnknownSessionsAnalyzed`:

```js
// scripts/score.mjs
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    // ...capped-from evidence, /btw shown as cumulative evidence text...
  },
),
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const color = maxProbe(s, "colorCommandUses");
    const voice = maxProbe(s, "voiceCommandUses");
    const focus = maxProbe(s, "focusCommandUses");
    const sum = color + voice + focus;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
  },
),
```

`maxProbe(signals, field)` (`scripts/score.mjs`) is the standard MAX-merge
helper: it reads both `signals.transcriptInvocations[field]` and
`signals.historyInvocations[field]` and returns the larger of the two,
because history has higher fidelity for side-channel commands and
transcripts have higher fidelity for transcript-only ones. Every input to
both scorers goes through it.

**Note on the memory numerator's current shape:** PR #116 originally summed
`/btw + /clear + /compact + /rewind`. That didn't survive contact with
`CLAUDE.md`'s per-field semantic rule — `/btw`'s session-coverage counter
(`cliBtwUseCount`) is windowed, but the codebase also carries a *cumulative
all-time* `/btw` invocation count, and mixing time-window classes in one
ratio numerator is exactly the CCE-78/CCE-79 anti-pattern the hard rule
exists to catch. `/rewind` turned out to be near-zero in practice (it's a
keyboard-shortcut-driven action, rarely typed). The numerator was narrowed in
a follow-up (CCE-79) to the two genuinely session-coverage, windowed inputs —
`/clear` and `/compact` — with `/btw`'s all-time count now surfaced as
descriptive evidence text (not a ratio input) and `/rewind` kept only as a
binary `rewindCommandUses>=1` next-action probe. The customization scorer's
three inputs (`/color`, `/voice`, `/focus`) didn't have this problem — all
three are windowed session-coverage counters from the start — so it kept its
original shape.

## Rubric targets and the cap

The radar vertex is `clamp(round(rawScore / target × 100))`. Per
`app/data/rubric.json`, memory's target is **60** and customization's is
**80** — both dimension-specific, not the generic 100. Because a single
session can trip more than one command in the same dimension (e.g. `/clear`
and `/compact` in the same session), `rawRatio` can exceed 1; `Math.min(rawRatio, 1)`
caps the displayed score at 100 rather than letting it read >100%. Per the
design review for this PR, the cap doesn't hide the over-use: when
`rawRatio > 1`, the evidence string appends
`" — capped from N% (multiple memory/customization commands per session)"`,
so a 250%-coverage session shows as "100/100 (capped from 250%)" instead of
an indistinguishable clean 100.

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations   (allowPosture: interactive_cli ∪ unknown)
   │
   ▼
signals.transcriptInvocations.{clear,compact,color,voice,focus}CommandUses
   │  MAX-merged against signals.historyInvocations via maxProbe()
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed
   ratio = min(sum / denom, 1); score = round(ratio * 100)
   │
   ▼
normalize(score, target) → radar vertex (target=60 memory, target=80 customization)
```

## Tests

Net-new coverage lives in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`: the
`NO_INSIGHTS` / `NO_TRANSCRIPTS` / `NO_SESSIONS` gap-reason paths, a perfect
100 at full session coverage, the cap-and-"capped from" evidence path, the
MAX-merge-from-history path, and realistic mixed inputs for both scorers.
Both scorers' `__universe` is asserted to equal `"interactive_or_unknown"`.

## Related reading

- `app/methodology/page.tsx` — the "What each Execution scorer measures"
  section documents the formulas above for dashboard readers, including the
  CCE-79 numerator note.
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — the
  probe tracker, updated in the same PR with the new
  `interactiveOrUnknownSessionsAnalyzed` row and the Axis transitions (P →
  P+E) for the Boris tips whose commands now feed both Platform Setup and
  Execution.
- `CLAUDE.md` — "Verify denominator semantics for every ratio scorer" and
  "Per-field semantic categorization before adding to any numerator" are the
  two hard rules this design had to satisfy.
