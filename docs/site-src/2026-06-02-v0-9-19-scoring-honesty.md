---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 — Scoring honesty: cumulative vs. windowed counter semantics (CCE-78)

**Released:** 2026-06-02  
**Tracker:** CCE-78 (fix) · CCE-79 (follow-up)  
**PR:** [#120](https://github.com/theoju/claude-code-self-assessment/pull/120) (release envelope bundling PRs #118 and #119)

## What was wrong

The Memory Execution scorer's ratio numerator was silently inflated for any user with high lifetime `/btw` adoption but low recent usage.

The root cause was a single `Math.max` blend in `scripts/run-assessment.mjs`:

```js
// before (broken)
btwCommandUses: Math.max(
  signals.cliBtwUseCount,      // ~/.claude.json — cumulative all-time invocation count
  insights.btwCommandUses      // usage-data/ — 30-day per-session coverage
)
```

`cliBtwUseCount` comes from `~/.claude.json#btwUseCount` — a lifetime counter that grows monotonically with account age. `btwCommandUses` from `usage-data/` is a 30-day windowed, per-session-deduped coverage signal. They measure different things on two independent axes:

| Axis              | `cliBtwUseCount`         | `btwCommandUses`                   |
| ----------------- | ------------------------ | ---------------------------------- |
| Time window       | cumulative (all-time)    | windowed (30-day)                  |
| Counter class     | raw invocation count     | session-coverage (deduped per session) |

The `Math.max` collapsed both axes into `signalsSummary.btwCommandUses`, which fed the Memory Execution ratio's numerator directly. The result: a user who ran `/btw` heavily six months ago but not recently would show high recent Memory Execution coverage — a ratio that drifted up with account age rather than reflecting current posture.

## What changed

**`scripts/run-assessment.mjs`** — the `Math.max` blend is removed. `signalsSummary.btwCommandUses` now carries only the 30-day windowed value from `usage-data/`.

**`signalsSummary.cliBtwUseCountAllTime`** — new field that exposes the cumulative `~/.claude.json#btwUseCount` counter separately, without touching any ratio numerator.

**Rubric predicates for tips 33 and 54** (`btw-side-channel`) — rerouted from `btwCommandUses >= 1` to `cliBtwUseCountAllTime >= 1`. These predicates test _"have you ever adopted `/btw`?"_ — a presence/habit check. The cumulative counter is the right source for a binary adoption gate; the windowed session-coverage counter is the right source for a ratio. After the fix, each signal routes to the surface it actually measures.

**CLAUDE.md** — a new hard rule codifies the prohibition. Any field added to a ratio numerator must be classified on two axes before inclusion: *(a) time window* (windowed vs. cumulative) and *(b) counter class* (session-coverage vs. raw invocation count). If the new field's class on either axis differs from existing numerator inputs, it doesn't belong in the same sum.

**Archived plans** — the completed CCE-72 and CCE-76 plans move to the `docs/superpowers/plans/archived/` directory as part of this release.

## Why the predicate reroute preserves behavior for typical consumers

Most users who have `/btw` installed have used it at least once (the predicate is `>= 1`). For them, `cliBtwUseCountAllTime >= 1` returns `true` whether the old or new field is read. The only user whose predicate result changes is one who used `/btw` in the last 30 days but has zero lifetime invocations in `~/.claude.json` — an edge case that can't occur in practice, since a 30-day windowed use implies a non-zero lifetime count.

The ratio numerator is the only place where the value matters quantitatively, and that's where the fix lands.

## What remains: CCE-79

This fix (CCE-78) addresses the `/btw` field specifically — the immediate asymmetry at the `Math.max` blend site. The deeper problem is that the Memory Execution ratio sums four slash-command counters that don't share a counter class:

| Field             | Counter class                              | Suitable for ratio? |
| ----------------- | ------------------------------------------ | ------------------- |
| `/clear`          | session-coverage (30-day, deduped)         | ✅                  |
| `/compact`        | session-coverage (30-day, deduped)         | ✅                  |
| `/btw`            | cumulative all-time (now surfaced separately) | ❌ (rerouted)    |
| `/rewind`         | session-coverage, but near-zero in practice | marginal           |

CCE-79 redesigns the scorer to restrict the numerator to the two reliable session-coverage signals (`clearCommandUses + compactCommandUses`), surface `/btw` as cumulative evidence text only, drop `/rewind` from the ratio, and recalibrate the rubric Memory target from 92 → 60 to reflect the narrowed realistic ceiling. The spec lives at `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.
