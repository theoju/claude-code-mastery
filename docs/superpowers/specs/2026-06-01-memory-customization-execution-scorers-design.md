# Memory + Customization Execution scorers (transcript-derived)

**Status:** v2 — patched 2026-06-01 in response to three-validator review (BLOCKERS: rubric targets, universe gap, missing transcripts gate). User approval pending on patched version.
**Ticket:** [CCE-76](https://designitright.atlassian.net/browse/CCE-76)
**Related:** CCE-71 (per-command partition gating that makes these signals trustworthy); CCE-72 (just-shipped ship-journal stage credit — same fidelity-improvement pattern); PR #97 / CCE / v0.9.17 (the planning denominator-semantics fix that established the hard rule this spec must obey).

## Goal

Three changes shipped in one PR:

1. **Replace `noTelemetry()`** for the `memory` and `customization` Execution scorers in [/Users/theo/Projects/claude-extensions/scripts/score.mjs:979-980](/Users/theo/Projects/claude-extensions/scripts/score.mjs:979) with real ratio scorers gated on `transcripts: true` and a new `interactive_or_unknown` session universe (aligned with the posture-command partition's `allowPosture` rule).
2. **Unify the counting class** for `focusCommandUses` and `rewindCommandUses` from total-invocation ([\_usage-data.mjs:334-335](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:334)) to session-coverage, mirroring the canonical pattern at lines 407-411 used by the other five posture counters.
3. **Add `interactiveOrUnknownSessionsAnalyzed`** to `insights-signals.mjs` and a new `"interactive_or_unknown"` universe option to `withGates` — required to close the numerator/denominator universe gap (BLOCKER B below).

Two italic-unmeasured dimensions become real Execution vertices. **Five machine-enforced header counts stay at 75/12/48/47/71** (no new probes / no new catalog entries / no new signalsSummary keys; the new `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry `insights` block, not signalsSummary).

## Context

CLAUDE.md routes these two dimensions to `noTelemetry()` because cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`) never contains command-invocation breakdowns. The rule is correct about cooked telemetry — but it conflates "cooked telemetry" with "Execution." Other dimensions (`learning` via `★ Insight` banner scan, `parallel` via worktree-usage transcript scan) already mix transcript signals into Execution scoring through `withGates({ transcripts: true, … })`. This design extends an existing pattern.

The transcript signals exist as **partition-gated posture-command counters** in `scanTranscriptInvocations`. After the counter-class unification in this PR, all seven become session-coverage counters (incremented once per session that used the command at least once; max value = number of interactive-or-unknown sessions scanned).

- **Memory inputs** — `/btw`, `/clear`, `/compact`, `/rewind`. Boris tips referenced via the existing rubric (`memory` dim covers tips 4, 45, 62, 63, 64, 70 per `rubric.json#dimensions.memory.borisTips`).
- **Customization inputs** — `/color`, `/voice`, `/focus`. Boris tips referenced via the existing rubric (`customization` dim covers tips 11, 16, 22, 23, 25, 26, 27, 38, 40, 71).

All seven are partition-gated to `interactive_cli ∪ "unknown"` via `allowPosture` ([\_usage-data.mjs:300-301](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:300)) per CCE-71. Observer/SDK echo inflation is already eliminated.

### Counter-class unification — what changes and why it's safe

Today, `focusCommandUses` and `rewindCommandUses` increment per-message at lines 334-335 of `_usage-data.mjs`; the other five increment per-session at lines 407-411. The mismatch is an artifact of when each counter was added (Bucket B detection framework PR #40, May 2026, vs the later posture-counter pattern).

This PR retrofits. Lines 334-335 become flag sets:

```js
// before
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

with `let sessionHasFocus = false; let sessionHasRewind = false;` hoisted to the per-session reset block ([\_usage-data.mjs:302-314](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:302), next to existing `sessionHasBtw` et al.) and matching emit lines `if (sessionHasFocus) counts.focusCommandUses++; if (sessionHasRewind) counts.rewindCommandUses++;` appended to the existing emit block after line 411.

**Safety verified across every reference (validator-confirmed):**

- Predicates `rewindCommandUses>=1` / `focusCommandUses>=1` in [/Users/theo/Projects/claude-extensions/app/data/rubric.json:241,361](/Users/theo/Projects/claude-extensions/app/data/rubric.json) — invariant under either counting class.
- [`score.mjs:399`](/Users/theo/Projects/claude-extensions/scripts/score.mjs:399) evidence string `/focus adopted (N use(s))` — cosmetic wording polish to "session(s)".
- Persistent storage — none.
- Tests — only one assertion changes value: [`scan-transcript-invocations.test.mjs:247`](/Users/theo/Projects/claude-extensions/scripts/__tests__/scan-transcript-invocations.test.mjs:247) writes one session with two `/rewind` messages and asserts `toBe(2)`; under session-coverage this becomes `toBe(1)` with a test-name reword. The other tests (`_usage-data.test.mjs:748`, `scan-transcript-invocations.test.mjs:265/291/447/466`, `scan-history-jsonl.test.mjs:296`, `build-signals-summary.test.mjs:666/671/723/732`, `score.test.mjs:1144`, `rubric-predicates.test.ts:68/73`) all use values that are invariant under the change.

After the unification, the scorer math has uniform units (every numerator term is one session-coverage hit).

### Empirical baseline (author's environment, post-CCE-72)

From `npm run assess --include-transcripts --insights-lookback 30`:

| Counter              | Value         | Counter            | Value |
| -------------------- | ------------- | ------------------ | ----- |
| `btwCommandUses`     | 39            | `colorCommandUses` | 3     |
| `clearCommandUses`   | 15            | `voiceCommandUses` | 0     |
| `compactCommandUses` | 8             | `focusCommandUses` | 1     |
| `rewindCommandUses`  | 0 (in-window) |                    |       |

`sessionsByKind.interactive_cli` ≈ 120; with the new `interactiveOrUnknownSessionsAnalyzed` denominator the value is `interactive_cli + unknown` (typically ~120 + a small "unknown" tail). Rubric targets per [/Users/theo/Projects/claude-extensions/app/data/rubric.json](/Users/theo/Projects/claude-extensions/app/data/rubric.json): **`memory.target = 92`, `customization.target = 80`** (these are dim-specific, not 100). The displayed score under `normalize(rawScore, d.target) = clamp(round(rawScore / target × 100))`:

- **Memory Execution**: `min((39 + 15 + 8 + 0) / ~120, 1) = 0.517` → `rawScore = 52` → `normalize(52, 92) = round(52/92×100) = 57`. Displayed: **~57/100**.
- **Customization Execution**: `min((3 + 0 + 1) / ~120, 1) = 0.033` → `rawScore = 3` → `normalize(3, 80) = round(3/80×100) = 4`. Displayed: **~4/100**.

(Exact post-PR values capture in live-verification step; the "~" reflects that the denominator widens slightly when `unknown` sessions are included.)

Both directions are honest. The prior unmeasured state was hiding both pieces of signal. **Target tuning** is deferred to a v2 calibration PR — out of scope here. Rationale for keeping the existing `target=92` / `target=80`: these are documented Platform-Setup-derived weights chosen for the existing dim composition; changing them is a separate calibration concern that needs its own data + discussion.

## Architecture

### Sequencing constraint

`scoreAll(rubric, signals)` runs at [run-assessment.mjs:312](/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:312) **before** `buildSignalsSummary(signals)` at line 329. Execution scorers therefore see raw `signals.transcriptInvocations` and `signals.historyInvocations`, **not** the merged `signalsSummary`. The scorer MAX-merges inline per counter (one line each); promoting `maxProbe` out of `run-assessment.mjs` would create a layering inversion.

### New `interactive_or_unknown` universe option (BLOCKER B fix)

The CLAUDE.md hard rule from PR #97 / v0.9.17 says a ratio's **numerator must be a subset of its denominator's universe**, or the ratio can exceed 100% and the cap silently masks the violation. Today the seven posture-command counters are gated by `allowPosture` to `interactive_cli ∪ "unknown"`, but `interactiveSessionsAnalyzed = sessionsByKind.interactive_cli` is strict `interactive_cli`. A naive `withGates({ universe: "interactive_only" })` scorer would therefore violate the rule — any session classified as `"unknown"` contributes to the numerator but not the denominator.

Fix: add a new universe option that matches the partition.

**[/Users/theo/Projects/claude-extensions/scripts/insights-signals.mjs:107](/Users/theo/Projects/claude-extensions/scripts/insights-signals.mjs:107)** — after the existing `interactiveSessionsAnalyzed` line, add:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

Forward through the return value alongside `interactiveSessionsAnalyzed`.

**[/Users/theo/Projects/claude-extensions/scripts/score.mjs:601-621](/Users/theo/Projects/claude-extensions/scripts/score.mjs:601)** — extend `withGates`:

```js
function withGates(opts, fn) {
  const universe = opts.universe;
  if (
    universe !== "interactive_only" &&
    universe !== "interactive_or_unknown" && // NEW
    universe !== "all_sessions"
  ) {
    throw new Error(/* updated message */);
  }
  const wrapped = (s) => {
    if (!s.insights) return unavailable(GAP_REASONS.NO_INSIGHTS);
    if (opts.transcripts && !s.insights.transcriptsScanned) {
      return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
    }
    const denom =
      universe === "interactive_only"
        ? s.insights.interactiveSessionsAnalyzed
        : universe === "interactive_or_unknown"
          ? s.insights.interactiveOrUnknownSessionsAnalyzed // NEW
          : s.insights.sessionsAnalyzed;
    if (opts.requireSessions !== false && !denom) {
      return unavailable(GAP_REASONS.NO_SESSIONS);
    }
    return fn(s);
  };
  wrapped.__universe = universe;
  return wrapped;
}
```

Rationale for the new universe (vs. tightening `allowPosture` to interactive_cli only): CCE-71 deliberately included `"unknown"` as a conservative fallback for sessions where `classifySessionKind` can't determine the kind (truncated/legacy/new-format transcripts). Tightening the partition would undo that and risk under-counting for users with non-standard transcript shapes. Widening the denominator to match is the principled fix and the smaller diff. Both the existing Platform Setup `customization` scorer at [score.mjs:395-399](/Users/theo/Projects/claude-extensions/scripts/score.mjs:395) (which reads `focusCommandUses`) and any other consumer continue to use whichever universe they were already using.

### Memory Execution scorer

Replace the body at [score.mjs:979](/Users/theo/Projects/claude-extensions/scripts/score.mjs:979) (`memory: noTelemetry(),`):

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const merge = (field) =>
      Math.max(
        s.transcriptInvocations?.[field] ?? 0,
        s.historyInvocations?.[field] ?? 0,
      );
    const btw = merge("btwCommandUses");
    const clear = merge("clearCommandUses");
    const compact = merge("compactCommandUses");
    // /rewind is transcript-only — _history-data.mjs HISTORY_COMMAND_LIST
    // (line 144) excludes it ("keyboard shortcut, never typed"). The merge
    // is kept uniform; history-side always reads 0.
    const rewind = merge("rewindCommandUses");
    const sum = btw + clear + compact + rewind;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const evidence = [
      `Memory hygiene commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${rawRatio > 1 ? " — capped from " + pct(rawRatio * 100) + "% (multiple memory commands per session)" : ""}`,
    ];
    const gaps = [];
    if (sum === 0) {
      gaps.push(
        "No /btw, /clear, /compact, or /rewind in any interactive session",
      );
    }
    return { score, evidence, gaps, gapReason: null };
  },
),
```

### Customization Execution scorer

Replace the body at [score.mjs:980](/Users/theo/Projects/claude-extensions/scripts/score.mjs:980) (`customization: noTelemetry(),`):

```js
customization: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    const merge = (field) =>
      Math.max(
        s.transcriptInvocations?.[field] ?? 0,
        s.historyInvocations?.[field] ?? 0,
      );
    const color = merge("colorCommandUses");
    const voice = merge("voiceCommandUses");
    const focus = merge("focusCommandUses");
    const sum = color + voice + focus;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const evidence = [
      `Customization commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${rawRatio > 1 ? " — capped from " + pct(rawRatio * 100) + "% (multiple customization commands per session)" : ""}`,
    ];
    const gaps = [];
    if (sum === 0) {
      gaps.push(
        "No /color, /voice, or /focus in any interactive session",
      );
    }
    return { score, evidence, gaps, gapReason: null };
  },
),
```

Per validator §"Cap masks pathological calibration": evidence string now surfaces when the cap fires (`rawRatio > 1`), so a user reading the radar sees "100/100 (capped from 250%)" rather than a misleadingly clean 100. The cap still bounds the displayed score, but the over-use is no longer hidden.

### Data flow

```
~/.claude/projects/*/*.jsonl (transcripts)
   │
   ▼
scanTranscriptInvocations  (allowPosture: interactive_cli ∪ unknown)
   │
   ▼
signals.transcriptInvocations.{btw,clear,compact,rewind,color,voice,focus}CommandUses
   │
   │  history.jsonl MAX-merge for {btw,clear,compact,color,voice,focus};
   │  /rewind is transcript-only (HISTORY_COMMAND_LIST excludes it)
   │
   ▼
EXECUTION_SCORERS.memory / .customization
   denom = s.insights.interactiveOrUnknownSessionsAnalyzed  (new)
   ratio = min(sum / denom, 1)
   rawScore = round(ratio * 100)
   │
   ▼
normalize(rawScore, d.target) → displayed Execution vertex on the radar
   (target=92 for memory, target=80 for customization)
```

## Cost & blast radius

- **I/O.** Zero new reads. All counters and `sessionsByKind` already collected.
- **CPU.** Negligible — eight `Math.max` ops, two `Math.min`, two rounds, two additions.
- **Diff surface.**
  - `_usage-data.mjs`: ~6 lines (2 flag-set conversions + 2 hoisted decls + 2 emit lines).
  - `insights-signals.mjs`: 2 lines (compute + return `interactiveOrUnknownSessionsAnalyzed`).
  - `score.mjs withGates`: 4-6 lines (new universe option + denom branch + updated error message).
  - `score.mjs EXECUTION_SCORERS.memory / .customization`: ~25 lines each, replacing `noTelemetry()`.
  - `score.mjs:399` evidence string: 1 word polish ("use(s)" → "session(s)").
  - `scan-transcript-invocations.test.mjs:247`: 1 value flip + test-name reword.
- **Score deltas (author's env).** Memory Execution italic-unmeasured → **~57/100**. Customization Execution italic-unmeasured → **~4/100**. Two-axis Execution overall: small mixed effect.
- **No new probe-catalog entries / signalsSummary keys / satisfiedWhen predicates.** Five machine-enforced header counts stay at 75/12/48/47/71. The new `interactiveOrUnknownSessionsAnalyzed` lives in the cooked-telemetry insights block (which has its own probe-tracker rows but no machine count); add it as a new row in the probe-tracker spec's Insights/cooked-telemetry layer.

## Tests

Net-new tests in a new file [/Users/theo/Projects/claude-extensions/scripts/**tests**/memory-customization-execution-scorers.test.mjs](/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs).

### Memory scorer

1. **`unavailable` when `s.insights` is missing.** Fixture: no insights. Assert `score === null`, `gapReason === GAP_REASONS.NO_INSIGHTS`.
2. **`unavailable` when transcripts not scanned.** Fixture: insights present, `transcriptsScanned: false`. Assert `gapReason === GAP_REASONS.NO_TRANSCRIPTS`. _(validator-added; covers the new `transcripts: true` gate)_
3. **`unavailable` when `interactiveOrUnknownSessionsAnalyzed === 0`.** Assert `gapReason === GAP_REASONS.NO_SESSIONS`.
4. **Perfect ratio at session coverage = 1.0.** Fixture: denom=100, `btwCommandUses=100`. Score=100.
5. **Cap fires when sum exceeds denominator.** Fixture: denom=100, btw=80, clear=80 (sum=160). Score=100; evidence string includes the "capped from 160%" suffix.
6. **History-source contributes via MAX-merge (btw).** Fixture: `transcriptInvocations.btwCommandUses=5`, `historyInvocations.btwCommandUses=30`, denom=100. Score=30.
7. **Rewind is transcript-only.** Fixture: `transcriptInvocations.rewindCommandUses=10`, `historyInvocations.rewindCommandUses=0` (or undefined), denom=100. Score=10. Documents the HISTORY_COMMAND_LIST asymmetry.
8. **Zero-signal produces gap message.** All four counters = 0, denom=100. Score=0; gap string present.
9. **Realistic mixed input.** btw=39, clear=15, compact=8, rewind=0, denom=120 → score=52 (raw); evidence reports the 62/120 numbers without the "capped" suffix.
10. **One counter at exactly denom (boundary).** denom=100, btw=100. Score=100; no "capped" suffix (rawRatio === 1.0 exactly).
11. **Partial coverage.** denom=100, only btw=37, others=0. Score=37.

### Customization scorer

12. **Perfect ratio.** denom=100, color=100. Score=100.
13. **Cap fires.** denom=10, color=10, voice=10, focus=10 (sum=30). Score=100; "capped from 300%" suffix.
14. **Zero-signal produces gap message.** All three=0. Gap string present.
15. **Realistic mixed input.** color=3, voice=0, focus=1, denom=120 → score=3.

### Cross-cutting

16. **`__universe` contract.** Both `EXECUTION_SCORERS.memory.__universe` and `.customization.__universe` equal `"interactive_or_unknown"`. _(Test 12 in v1; updated for the new universe.)_
17. **Numerator-subset-of-denominator universe contract.** A source-level test in `gather-insights-signals.test.mjs`: assert that `interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed` for any fixture (the new denominator must be ≥ the strict one). This is the CLAUDE.md hard-rule machine guard per the PR #97 corollary.

17 tests total. Each uses a hand-built `signals` literal (no fixture-file dependency).

## Error handling

- **Missing `signals.insights`** → `withGates` returns `unavailable(NO_INSIGHTS)`. Tested.
- **`transcripts: true` but `s.insights.transcriptsScanned` is falsy** → `withGates` returns `unavailable(NO_TRANSCRIPTS)`. Tested.
- **Zero `interactiveOrUnknownSessionsAnalyzed`** → `withGates` returns `unavailable(NO_SESSIONS)`. Tested.
- **Missing `transcriptInvocations` or `historyInvocations`** → optional-chaining + `?? 0` → counters read as 0 → score 0 → gap surfaces. Tested.
- **Non-numeric command values** (defensive — shouldn't happen by construction) → `Math.max` propagates NaN; mitigated by upstream partition assertions.

## Probe-tracker update (mandatory per CLAUDE.md)

Per the hard rule, the probe-tracker spec [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md) MUST be updated in the same PR.

- **Part 1 Insights/cooked-telemetry layer:** add a new row for `interactiveOrUnknownSessionsAnalyzed` (source: `insights-signals.mjs`, purpose: denominator universe for posture-gated Execution scorers). Cite the new `[^memory-customization-exec]` footnote.
- **Part 1 Transcripts layer:** add `[^memory-customization-exec]` footnote anchor to the rows for the seven affected counters (`btwCommandUses`, `clearCommandUses`, `compactCommandUses`, `rewindCommandUses`, `colorCommandUses`, `voiceCommandUses`, `focusCommandUses`). Match the precedent at the `[^partition]` and `[^journal-stage-credit]` anchors.
- **Footnote definition:** append immediately after the `[^journal-stage-credit]` definition (currently at line 273), matching that block's style.
- **Part 2 tip-coverage table:** the Boris tip rows for the commands' tips already have ✅ Status (predicates exist from CCE-71). **No Status changes are needed.** What DOES change is the **Axis** column for tips that now feed both Platform Setup and Execution scorers: P → P+E for the memory/customization tips whose commands appear in the new scorer (tips 33 (/btw), 62 (/rewind) on memory; tips 27 (/focus), 40 (/color), 60 (/voice) on customization — verify the exact tip numbers against the live tracker before editing). Re-derive the ✅/📊/🗣/❌ tally (it stays the same — no Status moves) and the five header counts via the live invocations:
  - `npx vitest run scripts/__tests__/tracker-counts.test.mjs` (machine-enforced)
  - For `signalsSummary` count: `node -e "import('./scripts/_fixtures.mjs').then(m => import('./scripts/run-assessment.mjs').then(r => console.log(Object.keys(r.buildSignalsSummary(m.makeSignals())).length)))"` — should print `71`.

## Acceptance criteria

- [ ] **Counter-class unification:** `scripts/_usage-data.mjs` lines 334-335 produce session-coverage counts; `let sessionHasFocus = false; let sessionHasRewind = false;` flags hoisted to the per-session reset block (next to existing `sessionHasBtw`); matching emit lines `if (sessionHasFocus) counts.focusCommandUses++; if (sessionHasRewind) counts.rewindCommandUses++;` appended after line 411.
- [ ] **Test alignment:** `scripts/__tests__/scan-transcript-invocations.test.mjs:247` assertion flips from `toBe(2)` to `toBe(1)`; test name/comment reworded to reflect session-coverage semantic.
- [ ] **Evidence wording:** `scripts/score.mjs:399` evidence string updated from `/focus adopted (${n} use(s))` to `/focus adopted (${n} session(s))`.
- [ ] **New denominator signal:** `scripts/insights-signals.mjs` computes and returns `interactiveOrUnknownSessionsAnalyzed = sessionsByKind.interactive_cli + sessionsByKind.unknown`.
- [ ] **`withGates` extended:** accepts `universe: "interactive_or_unknown"`; routes to the new denominator; updated validation error message lists all three universes.
- [ ] **`EXECUTION_SCORERS.memory`** replaces `noTelemetry()` with `withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)` — consumes inline MAX-merged counts of `btw`, `clear`, `compact`, `rewind` over `interactiveOrUnknownSessionsAnalyzed`.
- [ ] **`EXECUTION_SCORERS.customization`** same shape, consuming `color`, `voice`, `focus`.
- [ ] Both scorers' `__universe === "interactive_or_unknown"`.
- [ ] Both scorers surface "capped from N%" in evidence when `rawRatio > 1` (visibility for the multi-counting risk).
- [ ] 17 new tests pass (15 scorer tests + 1 universe contract + 1 numerator-subset gather-insights test).
- [ ] Full suite: **647 baseline → 664 pass** (647 - 1 reworded + 17 new = 663; +1 if the gather-insights numerator-subset test is genuinely net-new).
- [ ] Probe-tracker spec annotated with `[^memory-customization-exec]` footnote + new Part 1 row for `interactiveOrUnknownSessionsAnalyzed`; Part 2 Axis re-derived (Status unchanged); `tracker-counts.test.mjs` 5/5 pass; `signalsSummary` keys count verified at 71 via live invocation.
- [ ] CLAUDE.md scoring-model paragraph rewritten to reflect twelve measured dims (Model & Effort Tuning remains the only partial).
- [ ] **`app/methodology/page.tsx`** Memory + Customization sections updated to describe the new measurement basis (no longer "unmeasured"). The italic vertices on the radar (`app/components/RadarChart.tsx`) automatically become solid via the `gapReason === null` branch — no UI code change needed.
- [ ] **Live verification (CCE-72 pattern):** capture pre/post via worktree baseline:
  ```bash
  git worktree add /tmp/cce76-baseline-wt main
  (cd /tmp/cce76-baseline-wt && npm run assess --include-transcripts --insights-lookback 30 --no-slack --print) > /tmp/cce76-pre.txt
  npm run assess --include-transcripts --insights-lookback 30 --no-slack --print > /tmp/cce76-post.txt
  diff /tmp/cce76-pre.txt /tmp/cce76-post.txt
  ```
  Paste the relevant deltas in the PR body. Expected: `focusCommandUses` / `rewindCommandUses` unchanged at the author's current usage (already at 1 / 0); Memory + Customization Execution scores flip from italic-unmeasured to ~57 and ~4 respectively; no `automation/memory-routine` or `customization/customize` next-actions exit unless the predicate is now satisfied. Then `git worktree remove /tmp/cce76-baseline-wt`.

## Out of scope (deferred)

- **Per-session aggregate signals** (`sessionsWithAnyMemoryCommand`, `sessionsWithAnyCustomizationCommand`). True union counting at the scanner layer would fully eliminate the multi-counting Risk §1, but adds two new signals. v2 PR.
- **Target tuning.** Empirical observation post-PR may justify lowering `target` (e.g. memory.target 92 → 50) so half-session coverage saturates to 100/100. Defer until live data justifies the calibration.
- **`app/methodology/page.tsx` formula deep-dive.** This PR updates the Memory/Customization sections to reflect "measured"; a richer formula breakdown (matching the depth of other dims' methodology sections) is queued behind this PR.
- **B2 action-card "why" expansion** (predicate LHS + current value + threshold display). Separate, queued behind this PR per the brainstorm stack-rank.
- **A2 verify-strength predicate.** Cross-repo work touching `~/.claude/skills/ship/`. Higher-ceiling fidelity play; defer until A5 + B2 land.

## Risks and mitigations

1. **Numerator multi-counts sessions that used multiple memory or customization commands.** All seven inputs are session-coverage after the unification, but a session using both `/btw` and `/clear` still contributes 1 to each — summing them double-counts that session. _Mitigation:_ `Math.min(ratio, 1)` caps the displayed score to [0, 100]. **Critical addition (validator-driven):** the evidence string now surfaces "capped from N%" when `rawRatio > 1`, so a user reading the radar sees the over-use rather than a misleadingly clean 100. The cleaner fix (a single `sessionsWithAnyMemoryCommand` aggregate) is deferred to a v2 PR.
2. **NaN propagation** if a counter is non-numeric (data-layer bug elsewhere). _Mitigation:_ `?? 0` for null/undefined; upstream partition assertions guarantee numeric output.
3. **CLAUDE.md hard-rule rewrite.** The "Memory + Customization → unmeasured" rule is a documented contract. _Mitigation:_ the commit explicitly cites CCE-76 and the new contract; methodology page describes the new measurement basis.
4. **Calibration tuning required after observation.** Predicted post-PR scores (~57, ~4) are author-environment-specific. _Mitigation:_ target tuning explicitly deferred; live values captured in PR body.
5. **Counter-class unification touches a hot data-layer path.** _Mitigation:_ mirrors the existing pattern at lines 407-411 byte-for-byte; full suite runs at Task 0's gate before subsequent tasks begin.
6. **New universe option in `withGates`.** A new branch in a contract-heavy function. _Mitigation:_ added validation error lists all three universes; Test 16 (`__universe` contract) and Test 17 (numerator-subset-of-denominator) both gate the contract; existing scorers' universes are not touched.
7. **Tracker Part 2 re-derivation.** The Axis transitions (P → P+E) are easy to get wrong by visual inspection. _Mitigation:_ `tracker-counts.test.mjs` 5/5 is machine-enforced; per-row Axis is a contributor convention but the diff is visible in PR review.

## Implementation order (preview for writing-plans handoff)

0. **Counter-class unification (foundation).**
   - `_usage-data.mjs`: hoist `let sessionHasFocus = false; let sessionHasRewind = false;` to the per-session reset block; flip lines 334-335 to flag-sets; append `if (sessionHasFocus) counts.focusCommandUses++; if (sessionHasRewind) counts.rewindCommandUses++;` after line 411.
   - `scan-transcript-invocations.test.mjs:247`: `toBe(2)` → `toBe(1)` + test-name reword.
   - `score.mjs:399`: "use(s)" → "session(s)".
   - Run full suite — expect 647 pass (one assertion changed, no net new tests).
1. **New denominator signal.** `insights-signals.mjs` computes and returns `interactiveOrUnknownSessionsAnalyzed`. Update fixture (`_fixtures.mjs`) to include the new field. Add the numerator-subset-of-denominator test in `gather-insights-signals.test.mjs`.
2. **`withGates` extension.** Add `"interactive_or_unknown"` universe option + denom branch + updated error message. Add unit test confirming `__universe` propagates.
3. **Memory Execution scorer.** Add body in `EXECUTION_SCORERS.memory` with `withGates({ transcripts: true, universe: "interactive_or_unknown" }, ...)`. 8 tests (Tests 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 above — 11 total for memory).
4. **Customization Execution scorer.** Same shape. Tests 12-15.
5. **Cross-cutting tests.** Test 16 (`__universe`).
6. **Probe-tracker spec update.** New Part 1 row + footnote anchors on 7 transcript-counter rows + footnote definition appended after `[^journal-stage-credit]` at line 273 + Part 2 Axis adjustments (P → P+E for memory/customization tip rows; verify exact tip numbers against the live tracker). Run `tracker-counts.test.mjs`.
7. **CLAUDE.md scoring-model paragraph rewrite.**
8. **`app/methodology/page.tsx`** Memory + Customization sections updated to describe the new measurement basis.
9. **Live verification (CCE-72 worktree pattern).** Capture pre/post deltas in `/tmp/cce76-{pre,post}.txt`; paste relevant deltas in PR body.
10. **`/ship` CCE-76.** Transition Jira Backlog → In Progress (during ship), then In Progress → Done after squash-merge.
