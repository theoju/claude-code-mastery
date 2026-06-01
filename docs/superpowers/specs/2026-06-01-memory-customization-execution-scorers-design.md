# Memory + Customization Execution scorers (transcript-derived)

**Status:** Design approved 2026-06-01 (user, pending review of written spec)
**Ticket:** [CCE-76](https://designitright.atlassian.net/browse/CCE-76)
**Related:** CCE-71 (per-command partition gating that makes these signals trustworthy); CCE-72 (just-shipped ship-journal stage credit — same fidelity-improvement pattern); v0.9.16 / `/color` history MAX-merge (the projection pattern this scorer pair re-uses inline).

## Goal

Replace `noTelemetry()` for the `memory` and `customization` Execution scorers in [/Users/theo/Projects/claude-extensions/scripts/score.mjs:979-980](/Users/theo/Projects/claude-extensions/scripts/score.mjs:979) with real ratio scorers over the `interactive_cli` session universe. Two italic-unmeasured dimensions become real Execution vertices using signals already collected and partition-gated by CCE-71. No new probes / no new catalog entries / no new `signalsSummary` keys — the five machine-enforced header counts stay at 75/12/48/47/71.

## Context

CLAUDE.md's current hard rule says these two dimensions "route Execution to `noTelemetry()` via `gapReason` because the relevant signals never reach the cooked telemetry. Unmeasured ≠ scored zero — the radar marks unmeasured dims with italic labels and a footnote." That rule is **correct as written about cooked telemetry** (`~/.claude/usage-data/{facets,session-meta}/*.json` never contains command-invocation breakdowns), but it implicitly conflates "cooked telemetry" with "Execution." Other dimensions (`learning` via `★ Insight` banner scan, `parallel` via worktree-usage transcript scan) already mix transcript signals into Execution scoring through `withGates({ transcripts: true, … })`. So this design extends an existing pattern, not invents a new one.

The transcript signals exist. **Two counting classes** exist in `scanTranscriptInvocations` — both partition-gated to `interactive_cli ∪ "unknown"`, but with different semantics:

- **Session-coverage counters** (line 407-411: `if (sessionHasX) counts.XCommandUses++` — incremented once per session that used the command at least once; max value = number of interactive sessions scanned):
  - `btwCommandUses` — `/btw` mid-session context recovery (Boris tip 33, memory)
  - `clearCommandUses` — `/clear` to reset context (tip 17, memory)
  - `compactCommandUses` — manual `/compact` (memory)
  - `colorCommandUses` — `/color` theme (tip 40, customization)
  - `voiceCommandUses` — `/voice` dictation (tip 60, customization)

- **Total-invocation counters** (line 334-335: `counts.XCommandUses++` — incremented once per message; one heavy session can contribute many):
  - `rewindCommandUses` — `/rewind` to remove failed attempts (tip 62, memory)
  - `focusCommandUses` — `/focus` mode (tip 27, customization)

All seven counters are partition-gated to `interactive_cli ∪ "unknown"` session kinds via `allowPosture` (CCE-71); observer/SDK echo inflation is already eliminated.

**The counting-class mismatch is the design's calibration risk.** When the scorer sums `btw + clear + compact + rewind` over a denominator of `interactive_cli` session count:

- The session-coverage terms (`btw + clear + compact`) each contribute at most one per session that used them; their sum can exceed `denom` only via multi-command sessions (double-counting).
- The total-invocation term (`rewind`) can saturate the numerator entirely from a single heavy session repeatedly using `/rewind`. A user who hits `/rewind` 50 times across 5 sessions contributes 50 to the numerator over a 5-session "rewind footprint."

The `Math.min(ratio, 1)` cap bounds the displayed score to [0, 100] but doesn't fix the heterogeneity. A follow-up PR (see Out of Scope) would: either re-classify `rewindCommandUses` / `focusCommandUses` as session-coverage in `_usage-data.mjs`, OR introduce a single `sessionsWithAnyMemoryCommand` / `sessionsWithAnyCustomizationCommand` aggregate.

### Empirical baseline (author's environment, post-CCE-72)

From the most recent `npm run assess --include-transcripts --insights-lookback 30`:

| Counter              | Value         | Counter            | Value |
| -------------------- | ------------- | ------------------ | ----- |
| `btwCommandUses`     | 39            | `colorCommandUses` | 3     |
| `clearCommandUses`   | 15            | `voiceCommandUses` | 0     |
| `compactCommandUses` | 8             | `focusCommandUses` | 1     |
| `rewindCommandUses`  | 0 (in-window) |                    |       |

`sessionsByKind.interactive_cli` ≈ 120 (last 30 days). The `memory` / `customization` rubric targets are currently `100` (Platform Setup defaults, unchanged in this PR per the "no schema drift" invariant). Direction predictions under the actual `normalize(rawScore, target=100)`:

- **Memory Execution**: `min((39 + 15 + 8 + 0) / 120, 1) = 0.517` → `rawScore = round(0.517 × 100) = 52` → `normalize(52, 100) = 52`. Displayed: **52/100**. The dim flips from italic-unmeasured to a real mid-range score, validating that this user has substantial but not universal memory hygiene.
- **Customization Execution**: `min((3 + 0 + 1) / 120, 1) = 0.033` → `rawScore = 3` → `normalize(3, 100) = 3`. Displayed: **3/100**. Reveals a real gap (rarely `/color`, never `/voice`, near-zero `/focus`).

Both directions are honest. The prior unmeasured state was hiding both pieces of signal. **Target tuning** (e.g. dropping the dim's normalize target to 50 so 50% session coverage saturates) is deferred to a v2 calibration PR — out of scope here.

## Architecture

### Sequencing constraint (read this first)

`scoreAll(rubric, signals)` runs at [/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:312](/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:312) **before** `buildSignalsSummary(signals)` at line 329. Execution scorers therefore see raw `signals.transcriptInvocations` and `signals.historyInvocations`, **not** the merged `signalsSummary`. The scorer must MAX-merge inline (same shape `maxProbe` uses, but un-shared) because:

1. `maxProbe` is module-private in `run-assessment.mjs` and exporting it would create a layering inversion (`score.mjs` imports from `run-assessment.mjs`).
2. The MAX-merge per counter is one line; the cost of inlining < the cost of a cross-module dependency.

So each scorer reads `Math.max(s.transcriptInvocations?.X ?? 0, s.historyInvocations?.X ?? 0)` per counter. This mirrors the existing `simplifyCommandUses` projection pattern in CCE-72.

### Memory Execution scorer

Replace the body at [scripts/score.mjs:979](/Users/theo/Projects/claude-extensions/scripts/score.mjs:979) (`memory: noTelemetry(),`) with:

```js
memory: withGates({ universe: "interactive_only" }, (s) => {
  const denom = s.insights.interactiveSessionsAnalyzed;
  const merge = (field) =>
    Math.max(
      s.transcriptInvocations?.[field] ?? 0,
      s.historyInvocations?.[field] ?? 0,
    );
  const btw = merge("btwCommandUses");
  const clear = merge("clearCommandUses");
  const compact = merge("compactCommandUses");
  const rewind = merge("rewindCommandUses");
  const ratio = Math.min((btw + clear + compact + rewind) / denom, 1);
  const score = Math.round(ratio * 100);
  const evidence = [
    `Memory hygiene commands: ${btw + clear + compact + rewind} session-coverage hits across ${denom} interactive_cli sessions (${pct(ratio * 100)}%)`,
  ];
  const gaps = [];
  if (btw === 0 && clear === 0 && compact === 0 && rewind === 0) {
    gaps.push(
      "No /btw, /clear, /compact, or /rewind in any interactive session — Boris tips 17/33/62",
    );
  }
  return { score, evidence, gaps, gapReason: null };
}),
```

### Customization Execution scorer

Replace the body at [scripts/score.mjs:980](/Users/theo/Projects/claude-extensions/scripts/score.mjs:980) (`customization: noTelemetry(),`) with:

```js
customization: withGates({ universe: "interactive_only" }, (s) => {
  const denom = s.insights.interactiveSessionsAnalyzed;
  const merge = (field) =>
    Math.max(
      s.transcriptInvocations?.[field] ?? 0,
      s.historyInvocations?.[field] ?? 0,
    );
  const color = merge("colorCommandUses");
  const voice = merge("voiceCommandUses");
  const focus = merge("focusCommandUses");
  const ratio = Math.min((color + voice + focus) / denom, 1);
  const score = Math.round(ratio * 100);
  const evidence = [
    `Customization commands: ${color + voice + focus} session-coverage hits across ${denom} interactive_cli sessions (${pct(ratio * 100)}%)`,
  ];
  const gaps = [];
  if (color === 0 && voice === 0 && focus === 0) {
    gaps.push(
      "No /color, /voice, or /focus in any interactive session — Boris tips 27/40/60",
    );
  }
  return { score, evidence, gaps, gapReason: null };
}),
```

### `withGates` does the unavailable-fallback for free

`withGates({ universe: "interactive_only" })` already returns `unavailable(GAP_REASONS.NO_SESSIONS)` when `s.insights.interactiveSessionsAnalyzed` is 0 (see [scripts/score.mjs:615](/Users/theo/Projects/claude-extensions/scripts/score.mjs:615)). So users with zero interactive sessions in window get the same italic-unmeasured display they had before — graceful degradation is built in. No explicit `noTelemetry` call needed inside the wrapped body.

### Normalization contract

The scorer returns a raw score in `[0, 100]` shaped as `Math.round(ratio × 100)` with `ratio = min(numerator / denom, 1)`. The downstream `normalize(rawScore, d.target)` at [scripts/score.mjs:1030](/Users/theo/Projects/claude-extensions/scripts/score.mjs:1030) computes `clamp(round(rawScore / target × 100))`.

The rubric `target` field for both `memory` and `customization` stays at its current value (`100`, the Platform Setup default), per the "no schema drift" invariant. With target=100, `normalize(rawScore, 100) === rawScore` — the displayed Execution number equals the raw `ratio × 100`. **Target tuning** (e.g. dropping to `50` so half-session coverage saturates to 100/100) is a v2 calibration follow-up — see Out of Scope.

### Probe-tracker update

[/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md) — Part 1 Transcripts layer already has rows for all seven inputs (`btwCommandUses`, `clearCommandUses`, `compactCommandUses`, `colorCommandUses`, `voiceCommandUses`, `focusCommandUses`, and `rewindCommandUses` if present). No new rows needed. Add a single footnote anchor `[^memory-customization-exec]` on those rows (or on the Transcripts layer header if per-row gets noisy) with the definition:

> `[^memory-customization-exec]`: As of PR #N (CCE-76, spec 2026-06-01), the listed posture-command counters also feed Memory and Customization Execution scorers via inline MAX-merge of `transcriptInvocations` and `historyInvocations` against the `interactive_cli` session universe. The five machine-enforced header counts are unchanged (no new probes / catalog entries / signalsSummary keys).

`tracker-counts.test.mjs` (5/5 machine-enforced) must pass unchanged.

### CLAUDE.md rule update

The current scoring-model section reads:

> Ten of twelve dims have Execution scorers. The remaining two (Memory & Context, Terminal & Customization) route to _unmeasured_ via `gapReason` because the relevant signals never reach the cooked telemetry.

Rewrite to:

> **All twelve dimensions** have Execution scorers as of CCE-76 (PR #N). Memory & Context Management and Terminal & Customization Execution scorers consume **transcript-derived posture-command coverage signals** (the `interactive_cli`-gated counters from CCE-71) against the `interactive_cli` session universe. This mixes transcript signals into Execution scoring — matching the precedent set by `learning` (`★ Insight` banner) and `parallel` (worktree usage). Model & Effort Tuning remains the only partially-measured dim (the Opus-usage half is scored from transcripts; effort level stays settings-only).

## Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations  (per-command-partition gates posture commands to
   │                        interactive_cli / "unknown")
   ▼
signals.transcriptInvocations.{btw,clear,compact,rewind,color,voice,focus}CommandUses
   │
   │  (history.jsonl side-channel for some of the same commands, MAX-merged)
   │
   ▼
EXECUTION_SCORERS.memory  /  EXECUTION_SCORERS.customization
   denom = s.insights.interactiveSessionsAnalyzed
   ratio = min((sum of merged session-coverage counters) / denom, 1)
   rawScore = round(ratio * 100)
   │
   ▼
normalize(rawScore, d.target)  →  displayed Execution vertex on the radar
```

## Cost & blast radius

- **I/O.** Zero new reads. The seven counters and the `interactiveSessionsAnalyzed` denominator are already collected at signal-gather time.
- **CPU.** Eight `Math.max` ops + two `Math.min` ops + two rounds. Negligible.
- **Score deltas.** Two dims flip from italic-unmeasured to measured. For the author:
  - Memory Execution: italic-unmeasured → **52/100** (heavy /btw user; sub-saturation because not every session needs memory hygiene)
  - Customization Execution: italic-unmeasured → **3/100** (real gap; flag for behavioral coaching)
  - Two-axis Execution overall: small mixed effect. Predict +1 or +2 net.
- **No new probe-catalog entries / signalsSummary keys / satisfiedWhen predicates.** Five machine-enforced header counts stay at 75/12/48/47/71.

## Tests

Net-new tests in a new file [/Users/theo/Projects/claude-extensions/scripts/**tests**/memory-customization-execution-scorers.test.mjs](/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs) (paired-dim tests sit better together than splitting across the existing `score.test.mjs`'s long sections).

Each test feeds a synthetic `signals` object to `EXECUTION_SCORERS.memory` (or `.customization`) and asserts the returned `{score, evidence, gaps, gapReason}`.

### Memory scorer

1. **Test 1: returns `unavailable` when `interactiveSessionsAnalyzed === 0`.** withGates fallback. Fixture: `s.insights.interactiveSessionsAnalyzed = 0`. Assert `score === null`, `gapReason === GAP_REASONS.NO_SESSIONS`.
2. **Test 2: returns `unavailable` when `s.insights` is missing.** Same fallback. Assert `gapReason === GAP_REASONS.NO_INSIGHTS`.
3. **Test 3: perfect ratio at session coverage = 1.0.** Fixture: `interactiveSessionsAnalyzed = 100`, `btwCommandUses = 100` in transcripts. Assert `score === 100`.
4. **Test 4: cap fires when sum exceeds denominator.** Fixture: `interactiveSessionsAnalyzed = 100`, `btw=80, clear=80`. Sum is 160 > 100. Assert `score === 100` (capped).
5. **Test 5: history-source contributes via MAX-merge.** Fixture: `transcriptInvocations.btwCommandUses = 5`, `historyInvocations.btwCommandUses = 30`, denom = 100. Sum = 30 (max of 5 and 30), ratio = 0.30, score = 30. Assert.
6. **Test 6: zero-signal produces gap message.** Fixture: all four counters = 0, denom = 100. Assert `score === 0` AND `gaps` contains the "No /btw, /clear, /compact, or /rewind" string.
7. **Test 7: realistic mixed input.** Fixture: btw=39, clear=15, compact=8, rewind=0, denom=120 (the author's empirical baseline). Assert `score === 52` (ratio = 62/120 = 0.5167 → 52). Cross-coupling: assert `evidence` reports the 62/120 numbers in the human string.

### Customization scorer

8. **Test 8: perfect ratio.** denom=100, color=100. Score=100.
9. **Test 9: cap fires.** denom=10, color=10, voice=10, focus=10. Sum=30 > 10. Score=100.
10. **Test 10: zero-signal produces gap message.** All three = 0. Score=0, gaps contains "No /color, /voice, or /focus".
11. **Test 11: realistic mixed input.** color=3, voice=0, focus=1, denom=120 → ratio = 4/120 = 0.0333 → score = 3. Assert.

### Cross-cutting

12. **Test 12: `__universe` contract.** Both `EXECUTION_SCORERS.memory.__universe` and `.customization.__universe` should equal `"interactive_only"` (set by `withGates`). Asserts the partition-discipline contract from CCE-71 is honored at the scorer registration layer.

12 tests total. Each test uses a hand-built `signals` literal (no fixture-file dependency) so failures locate fast and the fixture shape is self-documenting.

## Error handling

- **Missing `signals.insights`** → `withGates` returns `unavailable(GAP_REASONS.NO_INSIGHTS)`. Tested.
- **Zero `interactiveSessionsAnalyzed`** → `withGates` returns `unavailable(GAP_REASONS.NO_SESSIONS)`. Tested.
- **Missing `transcriptInvocations` or `historyInvocations`** → optional-chaining + `?? 0` → counters read as 0 → score 0 → gaps surface the "no commands" message. Tested.
- **Non-numeric command values** (defensive — shouldn't happen by construction) → `Math.max` would propagate `NaN` and `Math.round(NaN)` returns `NaN`. Mitigation: `?? 0` only catches null/undefined, not NaN. Acceptable risk — the partition assertions in `_usage-data.mjs` guarantee numeric output, and a NaN slipping through would be a data-layer bug surface elsewhere.

## Probe-tracker update (mandatory per CLAUDE.md)

Per the hard rule, the probe-tracker spec MUST be updated in the same PR. No new probes / catalog entries / `signalsSummary` keys — five header counts stay at **75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys**.

- **Part 1 Transcripts layer:** add `[^memory-customization-exec]` footnote anchor to the rows for the seven affected counters (or on the layer header if per-row clutters the table — match the precedent at line 158 for `[^partition]`).
- **Part 2 tip-coverage table:** the Boris tip rows for tips 17, 27, 33, 40, 60, 62 now have stronger Execution coverage. Update Status from 🗣 (coaching-only) or 📊 (shared signal) to ✅ (direct probe) where appropriate. Re-derive the Part 2 ✅/📊/🗣/❌ tally and the "Validated against" header counts. **Use the live `buildSignalsSummary(makeSignals())` invocation, not a regex over the source** (per the v0.9.16 rule about signalsSummary count derivation).

`tracker-counts.test.mjs` (5/5 machine-enforced) must pass unchanged.

## Acceptance criteria

- [ ] `EXECUTION_SCORERS.memory` replaces `noTelemetry()` with a `withGates({ universe: "interactive_only" })` scorer that consumes inline MAX-merged counts of `btw`, `clear`, `compact`, `rewind` over `interactiveSessionsAnalyzed`.
- [ ] `EXECUTION_SCORERS.customization` same shape, consuming `color`, `voice`, `focus`.
- [ ] Both scorers return `unavailable(...)` when interactive session count is 0 (via `withGates`).
- [ ] Both scorers' `__universe === "interactive_only"` (contract from CCE-71 partition discipline).
- [ ] 12 new tests pass.
- [ ] Full suite passes.
- [ ] Probe-tracker spec annotated with the `[^memory-customization-exec]` footnote; Part 2 tip coverage tally re-derived; `tracker-counts.test.mjs` 5/5 pass.
- [ ] CLAUDE.md scoring-model paragraph rewritten to reflect twelve measured dims (with Model & Effort Tuning as the only remaining partial).
- [ ] Live `npm run assess --include-transcripts --insights-lookback 30` captures pre/post deltas:
  - Pre: Memory Execution + Customization Execution display italic-unmeasured.
  - Post: Memory Execution and Customization Execution display real numeric scores; the radar's two italic vertices become solid.

## Out of scope (deferred)

- **Counter-class unification.** Two follow-up paths address Risk §1's heterogeneity:
  - **Path A (preferred, smaller surface)**: Re-classify `rewindCommandUses` and `focusCommandUses` from total-invocation to session-coverage in `_usage-data.mjs` (mirror the `sessionHasFoo → counts.fooCommandUses++` pattern at lines 407-411). One small refactor + test updates; the probe-tracker rows already exist.
  - **Path B (richer signal)**: Introduce per-session boolean aggregates (`sessionsWithAnyMemoryCommand`, `sessionsWithAnyCustomizationCommand`) at the scanner layer for true union counting (no double-counting at all).
    Either is deferred to a v2 PR.
- **Target tuning.** The current normalize step uses `d.target = 100` for both dims (the Platform Setup target value). After live observation, a reasonable Execution target might be 50 ("perfect at half-session coverage"). Calibration follows data — open as a v2 follow-up if the displayed scores miscalibrate against the user's intuition.
- **B2 action-card "why" expansion** (predicate LHS + current value + threshold display). Separate, queued behind this PR per the brainstorm stack-rank.
- **A2 verify-strength predicate.** Cross-repo work touching `~/.claude/skills/ship/`. Higher-ceiling fidelity play; defer until A5 + B2 land.

## Risks and mitigations

1. **Heterogeneous counter classes in the numerator.** Five of the seven inputs (`btw`, `clear`, `compact`, `color`, `voice`) are session-coverage counters; two (`rewind`, `focus`) are total-invocation counters. Two side effects:
   - **(1a) Multi-counting.** A session using `/btw` + `/clear` contributes to both counters; summing them double-counts that session.
   - **(1b) Single-user saturation.** One heavy user firing `/rewind` 50 times can contribute 50 to the memory numerator (where the other terms cap at one per session each), letting a single user pull the denominator's worth of "credit." Same for `/focus` in customization.
     _Mitigation:_ the `Math.min(ratio, 1)` cap bounds the displayed score to [0, 100]. The cap absorbs both effects without rewarding session-internal redundancy or single-session saturation, but it hides the heterogeneity. _Follow-up:_ a v2 PR either re-classifies `rewindCommandUses` / `focusCommandUses` as session-coverage in `_usage-data.mjs` (the cleaner fix; small refactor) OR introduces aggregate `sessionsWithAnyMemoryCommand` / `sessionsWithAnyCustomizationCommand` signals. Both deferred. The user-approved A5 explicitly accepts this imperfection for v1.
2. **NaN propagation** if a counter is non-numeric (data-layer bug elsewhere). _Mitigation:_ `?? 0` for null/undefined; tests cover the missing-counter case. Beyond that we trust the upstream partition assertions.
3. **CLAUDE.md hard-rule rewrite.** The "Memory + Customization → unmeasured" rule is a documented contract. Changing it requires explicit acknowledgement in the commit message. _Mitigation:_ the commit explicitly cites CCE-76 and the new contract; the methodology page (`app/methodology/page.tsx`) describes the new measurement basis.
4. **Calibration tuning required after observation.** The author's predicted post-PR scores (52, 3) are based on a 30-day snapshot — if the typical user pattern differs, the displayed numbers might miscalibrate. _Mitigation:_ target tuning is out of scope; deferred to a v2 calibration PR once we have live data from this run.
5. **Tracker Part 2 tip-coverage re-derivation.** The Status transitions (🗣 → ✅ for affected tips) and the ✅/📊/🗣/❌ tally update are easy to get wrong by visual inspection. _Mitigation:_ implement Step 4 of Task 4 with `npx vitest run scripts/__tests__/tracker-counts.test.mjs` as the gating check — header counts are machine-enforced, per-tip-row Status is contributor convention but visible in diff.

## Implementation order (preview for writing-plans handoff)

1. Add `EXECUTION_SCORERS.memory` body with `withGates` + inline MAX-merge of 4 counters; 7 tests for the memory scorer.
2. Add `EXECUTION_SCORERS.customization` body with `withGates` + inline MAX-merge of 3 counters; 4 tests for the customization scorer.
3. Add the cross-cutting `__universe` contract test (Test 12).
4. Run the full test suite; expect baseline (646) + 12 = 658 pass.
5. Update probe-tracker spec footnote + Part 2 tip-coverage rows + tally re-derivation.
6. Update CLAUDE.md scoring-model paragraph.
7. Live `npm run assess --include-transcripts --insights-lookback 30` for delta verification; capture pre/post deltas via worktree-baseline approach.
8. `/ship` the PR; transition CCE-76 `Backlog → In Progress` (during ship) and after squash-merge transition `In Progress → Done`.
