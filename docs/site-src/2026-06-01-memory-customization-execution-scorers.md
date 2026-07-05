---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Memory & Customization Execution scorers

Through PR #116 (CCE-76), the **Memory & Context Management** and
**Terminal & Customization** dimensions used `noTelemetry()` as their
Execution scorer — a stub that always returns `unmeasured`. The radar
rendered both vertices in italics with a footnote, forever, regardless of
how often you actually ran `/clear`, `/compact`, `/color`, `/voice`, or
`/focus`. That was a real gap: the transcript scanner already collected
those posture-command counters (`scanTranscriptInvocations` in
`scripts/_usage-data.mjs`), they just weren't wired into a scorer.

CCE-76 replaces both stubs with real ratio scorers in
`scripts/score.mjs`. As of this PR, **all twelve scoring dimensions have an
Execution scorer** — Model & Effort Tuning is the only one still partially
measured (the Opus-usage half comes from transcripts; effort level stays
settings-only, because effort never reaches telemetry).

## The universe gap this closes

The posture-command counters (`/btw`, `/clear`, `/compact`, `/rewind`,
`/color`, `/voice`, `/focus`) are gated by `allowPosture` to sessions
classified as `interactive_cli` **or** `"unknown"` — the conservative
fallback CCE-71 introduced for transcripts `classifySessionKind` can't
confidently place (truncated or legacy-format `.jsonl`). Every existing
ratio scorer's denominator, though, was either `interactiveSessionsAnalyzed`
(strict `interactive_cli`) or `sessionsAnalyzed` (everything). Building a
Memory or Customization scorer on either of those denominators would have
violated the CLAUDE.md hard rule from PR #97: **a ratio's numerator must be
a subset of its denominator's universe**, or the ratio can silently exceed
100% before the cap masks it.

The fix is a new universe option rather than a tightened numerator. Tightening
`allowPosture` to strict `interactive_cli` would throw away the `"unknown"`
fallback's coverage for non-standard transcripts. Instead,
`scripts/insights-signals.mjs` now computes and returns a matching
denominator:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

and `withGates()` in `scripts/score.mjs` accepts a third `universe` value,
`"interactive_or_unknown"`, alongside the existing `"interactive_only"` and
`"all_sessions"`:

```js
const denom =
  universe === "interactive_only"
    ? s.insights.interactiveSessionsAnalyzed
    : universe === "interactive_or_unknown"
      ? s.insights.interactiveOrUnknownSessionsAnalyzed
      : s.insights.sessionsAnalyzed;
```

The chosen universe is recorded on the wrapped scorer as `__universe`, so
tests (and the methodology page) can audit which denominator a given scorer
actually uses without re-reading the formula.

## What each scorer measures today

Both scorers live in `scripts/score.mjs`, gated with
`{ transcripts: true, universe: "interactive_or_unknown" }` — they route to
`unmeasured` (not zero) when transcripts weren't scanned, when
`s.insights` is missing, or when the denominator is zero.

**Memory & Context Management** sums MAX-merged (transcript ∪ history)
session-coverage counts for `/clear` and `/compact`, divides by
`interactiveOrUnknownSessionsAnalyzed`, and caps at 1.0:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const ratio = Math.min(sum / denom, 1);
const score = Math.round(ratio * 100);
```

Notably, the numerator is **not** `/btw + /clear + /compact + /rewind`, even
though that's the set CCE-76 originally shipped. A follow-up correction
(CCE-79) narrowed it after the per-field semantic-categorization rule caught
a mismatch: `/btw`'s usage counter is cumulative all-time (via
`cliBtwUseCountAllTime`), not a 30-day session-coverage count like `/clear`
and `/compact`, and `/rewind` is a near-zero keyboard-shortcut signal rather
than a typed command. Mixing all four into one sum would have summed three
different counter classes. The current scorer restricts the ratio to the
two genuine session-coverage inputs; `/btw`'s cumulative count still
surfaces as evidence text (`"Plus N all-time /btw invocations (cumulative,
not in ratio)"`), and `/rewind` remains a binary next-action probe
(`rewindCommandUses>=1`, Boris tip 62) without feeding the ratio. The rubric
target dropped from 92 to **60** to match the narrowed, more realistic
ceiling.

**Terminal & Customization** is the same shape over `/color`, `/voice`, and
`/focus` — no CCE-79-style correction needed here, since all three are
already session-coverage counters:

```js
const color = maxProbe(s, "colorCommandUses");
const voice = maxProbe(s, "voiceCommandUses");
const focus = maxProbe(s, "focusCommandUses");
const sum = color + voice + focus;
const ratio = Math.min(sum / denom, 1);
```

Rubric target: **80**.

Both evidence strings surface the cap explicitly when a session used more
than one covered command (`rawRatio > 1`): `"… — capped from 160%
(multiple memory commands per session)"`. `Math.min(ratio, 1)` still bounds
the displayed score to 100, but the over-coverage stays visible in the
evidence line instead of silently collapsing to a clean "100/100."

## Counter-class unification

Before this PR, `focusCommandUses` and `rewindCommandUses` incremented once
per **message** in `scanTranscriptInvocations` (`scripts/_usage-data.mjs`) —
a raw invocation count — while the other five posture counters
(`btwCommandUses`, `clearCommandUses`, `compactCommandUses`,
`colorCommandUses`, `voiceCommandUses`) already incremented once per
**session** via a `sessionHasX` flag. The mismatch dated back to when the
counters were added in two separate PRs. This PR retrofits `focus` and
`rewind` onto the same session-coverage flag pattern so every numerator term
the new scorers sum is a uniform unit — one hit per session, regardless of
how many times the command appeared inside it.

## Live effect

In the author's environment (per the design doc's live-verification run),
the Execution composite dropped from **77 to 66** after this PR. That's
expected and correct, not a regression: Memory and Customization went from
excluded-from-the-average (as `unmeasured` vertices) to actually scored, and
both came in low — **16** and **3** on their initial baseline. Hiding two
low scores behind an "unmeasured" label was flattering the average; scoring
them honestly pulls it down. That's the entire point of the two-axis
model — Execution is supposed to tell you what you don't do, not what you
haven't measured.

## Where to look

- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed`
  computation.
- `scripts/score.mjs` — `withGates()` universe option; `EXECUTION_SCORERS.memory`
  and `.customization`.
- `scripts/_usage-data.mjs` — `scanTranscriptInvocations`, `allowPosture`
  gating, the `focus`/`rewind` counter-class unification.
- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` — the
  scorer test suite (cap behavior, gate behavior, MAX-merge behavior).
- `app/methodology/page.tsx` — the user-facing formula writeup, including the
  post-CCE-79 numerator description.
- Design spec:
  `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`.
