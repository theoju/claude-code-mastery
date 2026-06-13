---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/120
synthesized_into: []
doc_kind: decision
---

# v0.9.19 — Scoring Honesty (CCE-78)

**Released:** 2026-06-02  
**Version bump:** `0.9.18` → `0.9.19` (PR #120, `package.json` only)  
**Substantive changes landed in:** PR #119 (CCE-78 fix) · PR #118 (plan archival)

---

## What changed

### CCE-78: Remove the `Math.max` blend in `btwCommandUses`

The `btwCommandUses` entry in `signalsSummary` was being computed as:

```js
// before (broken)
btwCommandUses: Math.max(cliBtwUseCount, windowedBtwSessions)
```

`cliBtwUseCount` is a **cumulative all-time invocation counter** read from
`~/.claude.json`. `windowedBtwSessions` is a **30-day session-coverage counter**
derived from the cooked telemetry in `~/.claude/usage-data/`. Blending them
via `Math.max` silently violated two semantic axes at once:

| Axis | `cliBtwUseCount` | `windowedBtwSessions` |
|------|------------------|-----------------------|
| Time window | cumulative (lifetime) | windowed (30-day) |
| Counter class | raw invocation count | session-coverage (deduped) |

The result: for any user with historical `/btw` adoption, `btwCommandUses`
drifted upward with account age rather than reflecting recent posture. The
Memory Execution ratio numerator — which consumed `btwCommandUses` — was
overstated accordingly.

**Fix:** `cliBtwUseCount` is now exposed as a separate `cliBtwUseCountAllTime`
field in `signalsSummary`. The tip 33 / tip 54 btw-side-channel predicate in
the rubric is rerouted to `cliBtwUseCountAllTime` (a binary adoption check,
appropriate for a cumulative counter). The windowed `btwCommandUses` field
carries only the 30-day session-coverage count. The `Math.max` blend is
gone.

### Plan archival

The shipping plans for CCE-72 and CCE-76 were moved from `docs/superpowers/plans/`
to `docs/superpowers/plans/archived/` after both shipped in v0.9.18.

---

## Hard rule formalized

CCE-78 produced a concrete addition to the scorer contract, now in `CLAUDE.md`:

> **Per-field semantic categorization before adding to any numerator.** When
> adding a new field to a ratio numerator (or summing multiple fields into one),
> classify each field on two independent axes **before** writing the sum:
>
> | Axis | Possible classes |
> |------|-----------------|
> | (a) Time window | windowed (e.g., 30-day) / cumulative (lifetime) |
> | (b) Counter class | session-coverage (deduped per session) / raw invocation count |
>
> If the new field's class on either axis differs from existing numerator inputs,
> it doesn't belong in the same sum.

The `Math.max` blend at `run-assessment.mjs:134-137` is the reference
anti-pattern — it looked ergonomic (one field to test in predicates) but
conflated both axes. The fix (separate field, rerouted predicate) is the
reference shape for future scorer authors.

---

## Downstream: CCE-79

The CCE-78 fix narrows `btwCommandUses` to the correct windowed count, but
the broader Memory Execution numerator still sums `/btw + /clear + /compact + /rewind`
across signals with different semantics. **CCE-79** is filed to redesign the
Memory Execution scorer:

- Restrict the ratio numerator to `/clear` and `/compact` (both windowed session-coverage).
- Surface `/btw` adoption as cumulative evidence text only (not in the ratio).
- Keep `/rewind` as a next-action probe rather than a numerator contributor.
- Recalibrate the rubric target from 92 → 60 to reflect the narrowed realistic ceiling.

Until CCE-79 lands, the Memory Execution score is more honest than it was in
v0.9.18, but the full scorer redesign is pending.

---

## Upgrade notes

No migration required. Run `npm run assess` to pick up the corrected
`signalsSummary` fields. If you have `assessment-history.json` entries from
before v0.9.19, the historical Memory Execution scores reflect the old
(overstated) blend — they are not back-patched.
