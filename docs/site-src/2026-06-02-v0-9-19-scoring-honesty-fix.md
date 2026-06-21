---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 — Scoring honesty fix (CCE-78)

v0.9.19 bundles a single scoring-correctness fix (PR #119 / CCE-78) and two
pieces of housekeeping (PR #118 + a new CLAUDE.md hard rule). No public API
changes; no breaking changes.

## The problem

`scripts/run-assessment.mjs` at line 134 used a `Math.max` blend to merge two
semantically incompatible counters into `signalsSummary.btwCommandUses`:

```js
// BEFORE (v0.9.18 and earlier)
btwCommandUses: Math.max(
  maxProbe(signals, "cliBtwUseCount"),   // cumulative all-time invocation count
  insights.btwCommandUses                // 30-day windowed session-coverage
)
```

The two sources differ on both axes that matter for scorer correctness:

| Field | Time window | Counter class |
|---|---|---|
| `cliBtwUseCount` | cumulative (lifetime) | raw invocation count |
| `insights.btwCommandUses` | 30-day windowed | session-coverage (deduped per session) |

The result: `signalsSummary.btwCommandUses` drifted upward with account age.
The older your account, the higher the `/btw` count in `signalsSummary` —
regardless of whether you had used `/btw` at all in the last 30 days. The
field was consumed by the tip 33 / tip 54 predicates and surfaced as evidence
text in the Memory Execution scorer's next-action rationale.

Crucially, the Memory Execution _score itself_ was not corrupted: the scorer
called `maxProbe()` directly against the insights signals, not against
`signalsSummary.btwCommandUses`. The corruption lived entirely in the
`signalsSummary` surface — the predicate-backed probe and the evidence text
that flows from it.

## What changed

**PR #119 / CCE-78** makes two edits:

1. **Separates the cumulative counter.** `signalsSummary` now exposes
   `cliBtwUseCountAllTime` (the lifetime invocation count from `~/.claude.json`)
   as a distinct top-level field, kept out of any windowed ratio numerator.
   `btwCommandUses` is now the 30-day windowed session-coverage count only —
   no blending.

2. **Reroutes the tip 33 / tip 54 predicate.** The `satisfiedWhen` predicate
   that gates the `/btw` habit probe previously tested `btwCommandUses ≥ 1`.
   It now tests `cliBtwUseCountAllTime ≥ 1`. This is correct: the habit
   predicate wants to know "have you ever adopted `/btw`?" — a lifetime
   adoption check — and the cumulative counter is the right source for it.
   A ratio scorer measuring _recent_ posture should use the windowed field;
   a binary adoption probe should use the cumulative field. They are now routed
   separately.

**PR #118** archives the `plans/` documents for two completed work items
(CCE-72 and CCE-76) to `plans/archived/`. No scoring logic affected.

**CLAUDE.md** gains a new hard rule ("Don't blend cumulative all-time counters
into windowed ratio surfaces") that codifies the two-axis classification
required before adding any field to a numerator:

- **(a) Time window** — windowed (e.g., 30-day) vs. cumulative (lifetime)
- **(b) Counter class** — session-coverage (deduped per session) vs. raw
  invocation count

If the new field's class on either axis differs from the existing numerator
inputs, it belongs on a separate surface: evidence text (cumulative),
a separate binary predicate, or its own ratio with a matched denominator.

## What did not change

- **Memory Execution score** — unchanged. The scorer consumed `maxProbe()`
  directly; only `signalsSummary.btwCommandUses` (predicate and evidence) was
  wrong.
- **Memory Execution scorer design** — the broader per-field semantic
  redesign of the Memory Execution ratio numerator (CCE-79) is a follow-up,
  not included here. CCE-79 addresses the remaining numerator fields
  (`/clear`, `/compact`, `/rewind`) and recalibrates the rubric target.
- **Other scorers** — no other signal blends of this form were found in this
  release.

## Upgrade notes

`cliBtwUseCountAllTime` is an additive field in `signalsSummary`. If you
have automation that reads `assessment.json` or `signalsSummary` directly,
the new field is available immediately after `npm run assess`. The existing
`btwCommandUses` field now means strictly "30-day windowed session-coverage
count for `/btw`" — if you were relying on the `Math.max` behavior to get
the lifetime value, switch to `cliBtwUseCountAllTime`.

No fixture or test changes are required for most users. If you maintain a
fork with custom scorer tests that fixture `btwCommandUses` at a high
lifetime value, those fixtures should be updated to use `cliBtwUseCountAllTime`
for the adoption predicate and keep `btwCommandUses` as a windowed signal only.
