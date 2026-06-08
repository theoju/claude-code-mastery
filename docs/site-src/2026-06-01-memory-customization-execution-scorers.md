---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution Scorers (CCE-76, PR #116)

PR #116 closes the last gap in the Execution scoring model. Before this change,
two of the twelve radar dimensions — **Memory & Context Management** and
**Terminal & Customization** — routed to `noTelemetry()` and appeared as
italic-unmeasured vertices. The `weight × deficit` ranker couldn't surface
their next-actions, and the radar quietly understated how much room existed
there. CCE-76 replaces both stubs with real transcript-derived ratio scorers.

All twelve dimensions now have Execution scorers. Model & Effort Tuning remains
the only _partially_-measured dim: Opus usage is scored from transcripts, but
effort level stays settings-only.

## What changed in the scoring engine

### A new session universe: `interactive_or_unknown`

Both new scorers use a denominator of `interactive_cli + unknown` sessions
(exposed as `interactiveOrUnknownSessionsAnalyzed` in
`scripts/insights-signals.mjs`). This is the same universe that gates the
posture-command counters in CCE-71 — so the numerator is a strict subset of
the denominator by construction. That keeps the ratio ≤ 100% and satisfies the
numerator-subset-of-denominator hard rule established in PR #97.

`sdk_orchestrated`, `observer`, and `subagent` sessions run with SDK defaults,
not user-settable posture; including them in the denominator would silently
dilute the numerator without adding signal.

### Memory & Context Management scorer

The numerator counts the number of `interactive_or_unknown` sessions in which
the user invoked `/clear` or `/compact` at least once — per-session-coverage,
not raw invocation count. The target is calibrated to the realistic ceiling for
routine context-management use.

On the author's setup this dimension scores **16 ex** (previously
italic-unmeasured).

### Terminal & Customization scorer

The numerator counts sessions with at least one `/focus`, `/voice`, or `/color`
posture command. The same `interactive_or_unknown` gate applies.

On the author's setup this dimension scores **3 ex** (previously
italic-unmeasured).

### Counter refactor: per-message → per-session-coverage

`focusCommandUses` and `rewindCommandUses` were previously counted as raw
per-message occurrences. This PR refactors them to per-session-coverage
counters (deduplicated by session), matching the canonical pattern established
by `/btw`, `/clear`, and `/compact`. The change is required for correctness:
a ratio numerator must match the session-level granularity of its denominator.

## Score impact

The Execution composite drops from **77 → 66** after this change. That is not
a regression — it is the honest inclusion of two previously-unmeasured
dimensions that both score low. Memory at 16 and Customization at 3 pull the
weighted average down to reflect actual usage gaps rather than hiding them
behind `noTelemetry()`. The radar now gives you an accurate read of where to
invest.

If your own scores look lower after upgrading to this version, the same
explanation applies: the model is now measuring two more things, and the
`weight × deficit` ranker will surface the highest-leverage next-actions
in those dims automatically.

## Test coverage

The full suite grows to **666 passing tests** (+19). The new tests cover the
`interactiveOrUnknownSessionsAnalyzed` signal at the
`gatherInsightsSignals` level (not just fixture-fed scorer tests) — matching
the pattern mandated by the PR #97 hard rule for ratio scorers.

## Where to read more

- Design spec: `docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md`
- Execution plan: `docs/superpowers/plans/2026-06-01-memory-customization-execution-scorers.md`
- Scorer implementation: `scripts/score.mjs`
- Session universe + posture-command partition: `scripts/_usage-data.mjs`
  (`POSTURE_COMMANDS`, `classifySessionKind`, `interactive_or_unknown`)
- Methodology page: [`/methodology`](http://localhost:3737/methodology) —
  the formula breakdown for every scorer, including the two new ones
