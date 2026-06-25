---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/113
synthesized_into: []
doc_kind: decision
---

# `/ship` Journal Stage Credit: Multi-Format Detection (CCE-72)

**Decision date:** 2026-06-01  
**PR:** [#113](https://github.com/theoju/claude-code-self-assessment/pull/113)  
**Ticket:** CCE-72

## Problem

The `/ship` journal scorer in `scripts/signals.mjs` detected Stage 2 (verify-agent) and Stage 3 (simplify) with a single check: `entry.stage === 2`. That pattern only matches one of three format generations that `~/.claude/ship/journal.jsonl` entries can have:

| Generation | Shape | Detected before fix |
| --- | --- | --- |
| Singular | `{ stage: 2 }` | ✅ |
| Legacy-numeric `stages_run` | `{ stages_run: [2, 3] }` | ❌ |
| String `stages_run` | `{ stages_run: ["verify-agent", "simplify"] }` | ❌ |

The two undetected cohorts accounted for roughly 41% of journal entries. Users with `/ship` deeply integrated scored `simplifyCommandUses = 0` and saw `automation/simplify-skill` surface as an unmet next-action despite actively running the stage.

A second independent bug: the journal lookback was hardcoded to 14 days while every other Execution scorer uses `insightsLookbackDays` (default 30). Any `/ship` usage from day 15–30 was silently excluded from the numerator.

## Decision

Introduce a pure helper `stageRanInEntry(entry, legacyNumber, newName)` in `scripts/signals.mjs` that collapses detection across all three format generations into a single call. The canonical stage-number/name mapping: Stage 2 → `"verify-agent"`, Stage 3 → `"simplify"`. New stages always append to the end of the workflow, so the numeric detector arm stays stable as the workflow evolves.

Widen `gatherShipJournal` to emit both `stage2Count` (verify-agent) and a new `simplifyStageCount`. In `run-assessment.mjs`, MAX-merge `simplifyStageCount` into the existing `simplifyCommandUses` projection — matching the precedent set by other multi-source counters.

Align the journal lookback to `insightsLookbackDays` (default 30) to match the rest of the Execution scorer infrastructure.

## Alternatives considered

**Patch the check in-place at each call site** — rejected because the same multi-generation test would need to be duplicated independently for Stage 2 and Stage 3. A named helper is the right extraction point; the format knowledge has one home.

**Normalize at read time** — transform every journal entry into a canonical shape on load, so callers never see format variance. Rejected: it adds a transformation layer with no clear owner and makes the raw-entry shape opaque to future readers. The helper keeps the raw shape visible and explicit.

## Consequences

- `simplifyCommandUses` now reflects actual `/ship` Stage 3 usage regardless of which journal format generation produced the entry.
- The `automation/simplify-skill` next-action is no longer falsely surfaced as unmet for active users.
- Journal lookback alignment means `gatherShipJournal` sees the same 30-day window as transcript-derived counters — no off-window signal loss for days 15–30.
- Seventeen new tests cover all three format generations and the helper in isolation.
- Score deltas are zero in environments where Automation and Verification are already at ceiling. The fix eliminates a real predicate false-negative for users not yet saturated.

## Implementation note

`stageRanInEntry` is pure (no side effects, no I/O). The CLAUDE.md convention entry added in this cycle records the canonical stage-number/name mapping and the append-only rule for new stages — future contributors triaging similar detection gaps have a single place to check.

The design spec and implementation plan live under `docs/superpowers/` rather than the core lens root. The core lens has no `architecture/`, `operations/`, or `archive/` subdirectory, so this decision record sits as a flat dated slug at the lens root.
