---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: decision
---

# Decision: All 12 Execution dimensions are now measured (CCE-76)

**Date:** 2026-06-16  
**PR:** [#116](https://github.com/theoju/claude-code-self-assessment/pull/116)  
**Ticket:** CCE-76  
**Status:** Shipped

## Context

Before this change, `scripts/score.mjs` defined `EXECUTION_SCORERS` for 10 of 12 dimensions. Memory & Context Management and Terminal & Customization both returned `noTelemetry()`, which causes the scorer to emit `{ score: null, gapReason: … }` — rendered as italic labels and 0.65 opacity on the radar, with a footnote marking them unmeasured.

The `noTelemetry()` path existed because cooked telemetry (`~/.claude/usage-data/`) never contains per-command breakdowns. That reasoning was correct about the telemetry *source*, but it missed that the same transcript-derived posture-command signals used by `learning` (★ Insight banner) and `parallel` (worktree usage) could power these two dimensions as well. The gap was hidden in plain sight.

With both dimensions unmeasured, the Execution composite was computed over only 10 inputs. Low real-world usage of `/clear`, `/compact`, `/color`, `/voice`, and `/focus` was invisible to the dashboard — not surfaced as gaps, not contributing to the score.

## Decision

Replace `noTelemetry()` for both `memory` and `customization` Execution scorers with `withGates({ transcripts: true, universe: "interactive_or_unknown" })` ratio scorers, following the same pattern used by `learning`, `parallel`, `planning`, and `permissions`.

The decision comes with three coupled sub-decisions:

### 1. Use `interactive_cli ∪ unknown` as the denominator universe

Posture commands (`/clear`, `/compact`, `/color`, `/voice`, `/focus`) are already gated by `allowPosture` in `scanTranscriptInvocations`:

```js
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

The CLAUDE.md hard rule from PR #97 / v0.9.17 states that a ratio's numerator must be a subset of its denominator's universe. Using `interactiveSessionsAnalyzed` (strict `interactive_cli`) as the denominator while the numerator includes `unknown`-session hits would violate this rule and allow the ratio to exceed 100%.

Fix: introduce `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown` in `insights-signals.mjs` and a new `"interactive_or_unknown"` universe option in `withGates`. The option is validated at construction time; passing any other string throws. The universe is recorded as `wrapped.__universe` so tests and the methodology page can audit the contract.

### 2. Unify counter-class semantics for `focusCommandUses` and `rewindCommandUses`

Before this PR, `focusCommandUses` and `rewindCommandUses` were incremented per-message (one increment per message containing the command). The other five posture counters (`clearCommandUses`, `compactCommandUses`, `btwCommandUses`, `voiceCommandUses`, `colorCommandUses`) were incremented per-session (once per session that contained the command at least once).

All seven now follow the session-coverage pattern:

```js
// before — per-message increment inside the per-line loop
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after — per-session flag, emitted once after the session drain
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
// ... after the session file closes:
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

The `sessionHasFocus` and `sessionHasRewind` flags are hoisted to the per-session reset block alongside the existing `sessionHasBtw`, `sessionHasVoice`, etc. declarations.

This unification is safe across all references. The predicates `focusCommandUses>=1` and `rewindCommandUses>=1` in `rubric.json` are invariant under either counting class (they only care about ≥1). No persistent storage is affected. One test assertion changes: `scan-transcript-invocations.test.mjs` had a case that wrote one session with two `/rewind` messages and asserted count `2`; under session-coverage this becomes `1`.

### 3. Constrain memory scorer numerator to session-coverage signals only (CCE-79)

The memory scorer numerator is `clearCommandUses + compactCommandUses` — the two session-coverage signals. `/btw` (cumulative all-time counter from `~/.claude.json`) is shown as evidence text but excluded from the ratio. `/rewind` (keyboard shortcut, near-zero signal) is kept only as a binary next-action probe in the rubric, not in the ratio numerator.

This follows the CLAUDE.md per-field semantic rule: before adding any field to a ratio numerator, classify it on (a) time window (windowed vs. cumulative) and (b) counter class (session-coverage vs. raw invocation count). `/btw` is cumulative-all-time and raw-invocation-count — two mismatches with the other numerator fields. Adding it would produce the same class of bug fixed in v0.9.18 / CCE-78 (`cliBtwUseCount` Math.max blend).

## Scorer formulas

**Memory Execution** (`memory` dimension):

```
numerator  = clearCommandUses + compactCommandUses
             (session-coverage hits, interactive_cli ∪ unknown sessions only)
denominator = interactiveOrUnknownSessionsAnalyzed
rawScore   = clamp(min(numerator / denominator, 1) × 100)
displayed  = normalize(rawScore, rubric.dimensions.memory.target)
```

**Customization Execution** (`customization` dimension):

```
numerator  = colorCommandUses + voiceCommandUses + focusCommandUses
             (session-coverage hits, interactive_cli ∪ unknown sessions only)
denominator = interactiveOrUnknownSessionsAnalyzed
rawScore   = clamp(min(numerator / denominator, 1) × 100)
displayed  = normalize(rawScore, rubric.dimensions.customization.target)
```

Both scorers cap the ratio at 1 before multiplication, with a cap-suffix added to the evidence string when the raw ratio exceeds 1 (possible if a session uses multiple memory or customization commands).

The `/btw` all-time count (`signalsSummary.cliBtwUseCountAllTime`) is appended to the memory scorer's evidence text when non-zero, for human transparency.

## Score impact

The Execution composite dropped from 77 to 66. This is intentional and correct.

Two dimensions previously excluded as `noTelemetry()` now contribute real scores. The author's usage data showed low posture-command adoption: `/clear` and `/compact` covered ~19% of sessions; `/color`, `/voice`, and `/focus` covered ~3%. Both scorers returned low raw scores (memory ~52, customization ~3 on the author's machine). Including two low-scoring dimensions in a 10-dimension average lowers the composite.

The alternative — leaving both dimensions unmeasured — is worse. The dashboard's diagnostic value depends on honest scoring. A high composite that silently excludes low-scoring dimensions misleads you about where the gaps are. The 11-point drop surfaces real deficits that were previously hidden.

Model & Effort Tuning remains the only partially-measured dimension after this change. The Opus-usage half is scored from transcripts; the effort-level half stays settings-only because `~/.claude/usage-data/` never contains effort-level writes.

## Constraints satisfied

**Numerator-subset-of-denominator (PR #97 hard rule):** Both scorers use `universe: "interactive_or_unknown"`, which maps to `interactiveOrUnknownSessionsAnalyzed`. The numerator counters (`clearCommandUses`, `compactCommandUses`, `colorCommandUses`, `voiceCommandUses`, `focusCommandUses`) are gated by `allowPosture = (sessionKind === "interactive_cli" || sessionKind === "unknown")` in the transcript scanner — a strict subset of the denominator universe.

**Posture-vs-volume partition (CCE-71):** All five numerator signals remain posture commands. Their session-coverage counters increment only when `allowPosture` is true. Volume commands (`/loop`, `/schedule`, `/babysit`, `/go`, `/batch`) are unaffected.

**Per-field semantic classification:** Memory numerator restricted to session-coverage windowed signals. `/btw` (cumulative, raw invocation count) kept off the ratio. `/rewind` (session-coverage but near-zero signal) kept off the ratio; used only as a binary probe.

**No new catalog entries, no new `signalsSummary` keys:** The `interactiveOrUnknownSessionsAnalyzed` field lives in the cooked-telemetry `insights` block, not in `signalsSummary`. Machine-enforced header counts in the probe tracker stay at 75/12/48/47/71.

## Files changed

- `scripts/score.mjs` — `memory` and `customization` entries in `EXECUTION_SCORERS`; `withGates` extended with `"interactive_or_unknown"` universe option
- `scripts/insights-signals.mjs` — `interactiveOrUnknownSessionsAnalyzed` added to result object
- `scripts/_usage-data.mjs` — `focusCommandUses` and `rewindCommandUses` converted from per-message to per-session counters
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — Part 2 Axis column updated P → P+E for 6 tip rows covering the two dimensions

## Related decisions

- [CCE-79](https://designitright.atlassian.net/browse/CCE-79): Memory Execution scorer redesign — restricted the numerator to `clear + compact`, surfaced `/btw` as cumulative evidence text, dropped `/rewind` from the ratio. The per-field semantic table in its design spec is the reference case for the "classify before adding to numerator" rule.
- [CCE-71](https://designitright.atlassian.net/browse/CCE-71): Posture-vs-volume command partition — established `allowPosture` gating that makes these transcript signals trustworthy.
- PR #97 / v0.9.17: Planning Execution denominator fix — established the numerator-subset-of-denominator hard rule this change must satisfy.
- PR #116 architecture doc: `docs/site-src/2026-06-16-memory-customization-execution-scorers.md` — details the scorer implementation and the `maxProbe` pattern used to merge transcript and history scanner signals.
