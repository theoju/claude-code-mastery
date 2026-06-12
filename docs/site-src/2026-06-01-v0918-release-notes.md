---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/117
synthesized_into: []
doc_kind: decision
---

# v0.9.18 release notes

Released 2026-06-01. Bundles 13 PRs landed since v0.9.17 (2026-05-26).

The headline of this release is **full 12-dimension Execution coverage** — every
dimension that was previously labelled _unmeasured_ on the radar now has a live
Execution scorer. Alongside that, three cross-cutting scoring-fidelity fixes
correct long-standing counter-class and universe errors that caused reported
ratios to drift with account age or exceed 100%.

---

## What's new

### Memory & Context Management — Execution scorer (CCE-79)

The Memory Execution scorer was redesigned from scratch. The original
implementation summed four command signals (`/btw + /clear + /compact + /rewind`)
into a single numerator, but those signals belong to three different counter
classes: `/btw` was a cumulative all-time invocation count, `/rewind` was a
near-zero binary flag, and `/clear + /compact` were genuine 30-day
session-coverage counts. Summing across classes produces a ratio that drifts
upward with account age rather than measuring recent posture.

The redesigned scorer:

- **Numerator**: `/clear` + `/compact` only — both 30-day session-coverage
  counts, restricted to `interactive_cli ∪ unknown` sessions where the user
  can actually influence context posture.
- **Rubric target**: recalibrated 92 → 60 to reflect the narrowed realistic
  ceiling (two commands instead of four).
- **`/btw`**: moved to cumulative evidence text via `cliBtwUseCountAllTime` —
  shown on the drilldown but excluded from the ratio numerator.
- **`/rewind`**: retained as a next-action probe only; its near-zero signal
  strength does not belong in a ratio.

The denominator universe is `interactive_or_unknown` sessions (the
`interactive_cli + unknown` sum), consistent with the posture-command scoring
principle: posture you can control, measured against sessions where you're
actually at the wheel.

### Terminal & Customization — Execution scorer (CCE-71)

Terminal & Customization was the last dimension without an Execution scorer.
The new scorer consumes posture-command coverage signals derived from transcript
scans, gated to `interactive_cli ∪ unknown` sessions — the same session
universe as the Memory scorer. Commands counted: `/color`, `/voice`, `/focus`,
`/simplify`, and related customization commands drawn from `POSTURE_COMMANDS`
in `scripts/_usage-data.mjs`.

With this scorer live, the radar's italic-label footnote ("unmeasured") now
applies only to dimensions where `gapReason !== null` at runtime — typically
zero interactive sessions in the scoring window — rather than being a permanent
annotation for two dimensions.

### btw-blend correction (CCE-78)

`scripts/run-assessment.mjs` previously used a `Math.max(maxProbe(s, field), cumulativeCounter)` blend to merge `cliBtwUseCount` (cumulative all-time invocation count from `~/.claude.json`) into `btwCommandUses` (a 30-day session-coverage counter). This silently corrupted the Memory Execution ratio's numerator: a user with a large all-time `/btw` count would see an inflated session-coverage figure unrelated to their last 30 days.

Fixed by:
1. Exposing `cliBtwUseCountAllTime` as a separate field in `buildSignalsSummary` for adoption-check predicates.
2. Routing the tip 33 predicate (`btwHabitAdopted`) to `cliBtwUseCountAllTime` so binary "have you adopted it?" checks read the cumulative counter explicitly.
3. Removing the `Math.max` blend entirely from the windowed `btwCommandUses` path.

No user-visible score format changed; the numbers become accurate rather than inflated.

### Posture vs. volume command partition (PR #110)

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` are now the canonical partition in
`scripts/_usage-data.mjs`, enforced by a `assertCommandPartition` guard that
runs at module load and fails loudly on drift (non-disjoint sets, missing
classification, dead classification).

- **Posture commands** (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
  `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`): counted
  from transcripts only when `classifySessionKind` returns `interactive_cli`
  or `unknown`. Autonomous/SDK sessions are excluded — posture you set in
  interactive mode shouldn't be conflated with sessions running under SDK
  defaults.
- **Volume commands** (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`):
  counted across every scanned session kind — autonomous-workflow signal is
  real regardless of which session emitted it.

If `npm run assess` exits non-zero with no `assessment.json` written, check
stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition errors before
assuming an environmental issue.

---

## Scoring model after v0.9.18

All 12 dimensions carry Execution scorers. The two remaining dimensions where
the Execution score can appear as _unmeasured_ at runtime are:

- **Memory & Context Management** and **Terminal & Customization** — only when
  there are zero `interactive_cli ∪ unknown` sessions in the scoring window.
- **Model & Effort Tuning** — Execution is _partially_ measured: Opus-usage
  half scored from transcripts; effort level stays settings-only.

The `gapReason` field on a dimension's Execution result tells you which case
applies at runtime.

---

## Upgrade notes

No migration steps are required. The scorer changes are self-contained in
`scripts/score.mjs`, `scripts/_usage-data.mjs`, and `scripts/run-assessment.mjs`.
Re-run `npm run assess` to get updated scores; the Memory Execution number will
change if you had a large all-time `/btw` count inflating the old ratio.

Fixture-based tests in `scripts/__tests__/` were updated in their respective
feature PRs. If you maintain downstream forks with custom fixtures, check that
`makeInsights()` in `scripts/__tests__/_fixtures.mjs` includes the new
`cliBtwUseCountAllTime` field — its absence cascades into NaN scores for any
scorer that reads `signalsSummary.cliBtwUseCountAllTime`.
