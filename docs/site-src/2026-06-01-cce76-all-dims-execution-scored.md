---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# CCE-76: All 12 Dimensions Now Carry Live Execution Scores

**PR #116 · 2026-06-01**

Before this change two dimensions — **Memory & Context Management** and
**Terminal & Customization** — returned a null Execution score because no
transcript-gated counter existed for their posture signals. Both rendered on
the radar with italic labels and a `¹` footnote indicating they were
honestly-unmeasured, rather than silently zeroed. CCE-76 closes that gap:
every dimension in the scoring model now carries a live Execution score when
interactive sessions exist in the lookback window.

## What changed

The stub `noTelemetry()` placeholders for the two dimensions were replaced with
real ratio scorers using `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.

Each scorer counts how many sessions in the `interactive_cli ∪ unknown`
universe contain at least one invocation of the relevant posture commands:

| Dimension | Commands counted |
| --- | --- |
| Memory & Context Management | `/clear`, `/compact` |
| Terminal & Customization | `/color`, `/voice`, `/focus` |

The `interactive_or_unknown` universe is the right denominator for posture
signals: `sdk_orchestrated`, `observer`, and `subagent` sessions run with
SDK defaults and cannot express user-configured posture — counting them in
the denominator would silently dilute the numerator. The `unknown` sessions
are included as a conservative fallback because session-kind classification
is imperfect and excluding them would under-count genuine interactive work.

Supporting changes:

- `scripts/_usage-data.mjs` — new per-session command counters for the
  posture commands listed above; these join the `POSTURE_COMMANDS` partition
  (filtered to `interactive_cli | unknown`), not `VOLUME_COMMANDS`.
- `scripts/insights-signals.mjs` — new fields surfaced to the scorer:
  `clearOrCompactSessionCount`, `customizationCommandSessionCount`.
- `scripts/score.mjs` — `scoreMemoryExecution` and `scoreCustomizationExecution`
  replaced their `noTelemetry()` fallbacks with the ratio logic.
- `app/methodology/page.tsx` — formula breakdown updated to document the new
  scorers.
- Three test files updated; `scripts/__tests__/_fixtures.mjs` extended to
  include the new fields so the fixture contract stays complete.

## Effect on the radar

When at least one `interactive_cli` or `unknown` session exists in the
lookback window, both dimensions now produce a numeric Execution score rather
than routing through `gapReason`. The italic label and `¹` footnote disappear
for those dimensions. They remain italicized only if the scoring window
contains zero qualifying sessions — the same condition that applies to every
other Execution scorer.

The `noTelemetry()` fallback is no longer used by any dimension.

## Follow-up: CCE-79

During review of the Memory Execution scorer a separate issue was identified:
the original numerator mixed `/clear` and `/compact` (30-day windowed,
session-coverage) with `/btw` (cumulative all-time invocation count). Summing
counters from different time windows and counter classes into one ratio
numerator produces a score that drifts up with account age rather than
reflecting recent posture.

PR #116 ships a narrowed numerator (`/clear + /compact` only) and keeps
`/btw` as cumulative evidence text rather than a ratio input. The full
per-field semantic redesign — recalibrated rubric target, per-field
classification table, and updated next-action probes — is tracked as
**CCE-79** and will land as a follow-up PR with its own doc update.
