---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 release notes

Cut 2026-06-02. `package.json` bumps to `0.9.19` in PR #120 — a pure
version-bump commit that closes out a cycle whose actual behavior change
landed in the PR immediately before it.

## What's in this release

**Scoring-honesty fix for `/btw` command counting.** The Memory Execution
signal `signalsSummary.btwCommandUses` was previously `Math.max`-blended
against the cumulative all-time `~/.claude.json#btwUseCount` counter. That
blend mixed a lifetime invocation count into a 30-day windowed
session-coverage ratio — the numerator could only ever grow, so the ratio
drifted upward with account age rather than reflecting recent posture. The
fix stops the blend outright: `btwCommandUses` now reports only the
windowed, session-coverage signal, and the cumulative counter is exposed
separately as `cliBtwUseCountAllTime`. The `btw-side-channel` rubric
predicate — the adoption check that only needs a "have you ever used
`/btw`" answer — was rerouted to read `cliBtwUseCountAllTime` instead,
so that check keeps working correctly off the cumulative field it actually
wants, while the windowed ratio it used to distort is clean.

This is the same class of bug the CLAUDE.md hard rules document under
*"Don't blend cumulative all-time counters into windowed ratio surfaces"* —
this release is the fix referenced there (v0.9.18 / CCE-78), landing one
version later as v0.9.19 once it was cut.

**Housekeeping.** The landed CCE-72 and CCE-76 plans were archived as part
of this cycle. No code changes accompany the archival — it's repo
bookkeeping to keep `docs/superpowers/plans/` reflecting only in-flight work.

## Why a minor bump, not a patch

The `/btw` fix changes the observable value of `signalsSummary.btwCommandUses`
for every downstream consumer — rubric predicates, ranked next-actions, and
anything else reading the assessment output. Even though the change is a
correction rather than a new feature, it alters behavior a consumer could be
depending on, which is why it warranted `0.9.18 → 0.9.19` rather than a
patch-level bump.

## What to check if you're upgrading

If you have local tooling or scripts that read `signalsSummary.btwCommandUses`
expecting the old blended (inflated) value, switch it to
`cliBtwUseCountAllTime` if what you actually want is the lifetime count.
`btwCommandUses` itself now means only "windowed session coverage" — treat
any code that assumed otherwise as carrying the same bug this release fixed.
