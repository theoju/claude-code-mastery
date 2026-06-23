---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 — Scoring Honesty Fix (CCE-78)

**Released:** 2026-06-02  
**Version bump:** `0.9.18` → `0.9.19`  
**Ticket:** CCE-78  
**PRs bundled:** #119 (CCE-78 counter-semantics fix), #118 (plan archive)

## What changed

v0.9.19 is a point-release that corrects a silent data-integrity bug in
`signalsSummary.btwCommandUses` introduced in an earlier ergonomics pass.
No scoring *outcomes* change for typical users; what changes is that
`btwCommandUses` now means what its name says.

### The bug (CCE-78, PR #119)

`scripts/run-assessment.mjs` line 134 contained:

```js
btwCommandUses: Math.max(btwCommandUses_30day, cliJson.btwUseCount)
```

That `Math.max` blend silently mixed two fields from different counter
classes onto a single surface:

| Field | Time window | Counter class |
|---|---|---|
| `btwCommandUses` (facet-derived) | 30-day windowed | session-coverage (deduped per session) |
| `cliJson.btwUseCount` (from `~/.claude.json`) | Cumulative all-time | raw invocation count |

A user with a few years of `/btw` usage would see `btwCommandUses` equal
to their lifetime invocation count even if they hadn't used `/btw` in the
past 30 days. The Memory Execution scorer's numerator consumed this field,
making the ratio meaninglessly high for long-tenured users and silently
masking any real recent-usage decline.

### The fix

The cumulative all-time count is now exposed as a *separate* field:
`signalsSummary.cliBtwUseCountAllTime`. The rubric predicates for tips 33
and 54 (the `/btw` side-channel checks) are rerouted to target
`cliBtwUseCountAllTime` — these are binary adoption checks (`>= 1`), so
the cumulative lifetime field is semantically correct for them.

`signalsSummary.btwCommandUses` now contains only the 30-day windowed
session-coverage count, consistent with every other session-coverage
field in `signalsSummary`.

**Memory Execution score is unchanged by design.** The numerator was
overstated for some users; fixing it could have lowered their score. The
v0.9.19 decision was to restore the field's semantics first and file
CCE-79 for a deeper redesign of the Memory Execution scorer (restricting
the numerator to the two cleanly-defined session-coverage signals,
`/clear` + `/compact`, with `/btw` surfaced as evidence text and the
rubric target recalibrated to the narrower ceiling).

### CLAUDE.md hard rule added

PR #119 adds a **Per-field semantic categorization** hard rule to
`CLAUDE.md` that encodes the lesson:

> Before adding any field to a ratio numerator, classify it on two
> independent axes — **(a) time window** (windowed vs cumulative) and
> **(b) counter class** (session-coverage vs raw invocation count). If the
> new field's class on either axis differs from existing numerator inputs,
> it doesn't belong in the same `sum`.

The rule names CCE-79 as the reference redesign case and points to
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
for the per-field classification table.

### Plan archive (PR #118)

PR #118 archives the landed plans for CCE-72 (ship-journal stage counters)
and CCE-76 (all-twelve Execution scorers). Both were complete; moving them
to the archive cleans up the active-plans directory without touching any
scoring logic.

## Impact on your scores

| Surface | Before v0.9.19 | After v0.9.19 |
|---|---|---|
| `signalsSummary.btwCommandUses` | `max(30-day sessions, all-time count)` — inflated for older accounts | 30-day windowed session-coverage only |
| `signalsSummary.cliBtwUseCountAllTime` | Not present | Cumulative all-time `/btw` count from `~/.claude.json` |
| Memory Execution score | Potentially overstated | Unchanged (CCE-79 addresses this) |
| Tips 33, 54 predicates | Evaluated against inflated `btwCommandUses` | Rerouted to `cliBtwUseCountAllTime` |

If your `btwCommandUses` was already at or below your 30-day session
ceiling, you will see no numeric change. If it was inflated by the
`Math.max` blend, `btwCommandUses` will drop, but the Memory Execution
scorer's overall output is held constant until CCE-79 lands.

## Follow-up

**CCE-79** — Memory Execution scorer redesign. Restricts the numerator to
`/clear` + `/compact` (both 30-day session-coverage), surfaces `/btw` as
cumulative evidence text, drops `/rewind` to a next-action-only probe, and
recalibrates the rubric target from 92 → 60 to match the narrowed
realistic ceiling. Design spec:
`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`.
