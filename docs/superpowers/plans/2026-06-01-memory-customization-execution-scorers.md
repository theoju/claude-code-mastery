# Memory + Customization Execution scorers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `noTelemetry()` for the `memory` and `customization` Execution scorers with `withGates`-wrapped ratio scorers; unify the `focusCommandUses` / `rewindCommandUses` counters to session-coverage; introduce the `interactive_or_unknown` denominator universe required to satisfy the CLAUDE.md numerator-subset-of-denominator hard rule.

**Architecture:** Three independent changes shipped in one PR. Task 0 unifies the counter classes (foundation). Tasks 1-2 add the new denominator signal + extend `withGates`. Tasks 3-5 add the two scorers + cross-cutting universe-contract tests. Tasks 6-9 update probe-tracker, CLAUDE.md, methodology page, and capture live deltas. Task 10 ships via /ship.

**Tech Stack:** Node.js ESM (`.mjs`), Vitest, Next.js 16 (dashboard), JSON-only fixtures (no DB).

**Spec:** [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-01-memory-customization-execution-scorers-design.md) — read once before starting; defer to the plan for exact code in each step.

**Verification commands referenced throughout:**

```bash
npx vitest run                                              # full suite
npx vitest run scripts/__tests__/<file>.test.mjs            # single file
npx vitest run scripts/__tests__/tracker-counts.test.mjs    # probe-tracker counts gate
npm run assess --include-transcripts --insights-lookback 30 --no-slack --print
```

---

## Task 0: Counter-class unification (foundation)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:302-314` (hoist new flags), `:334-335` (flip to flag-sets), `:407-411` (append emit lines for the new flags)
- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/scan-transcript-invocations.test.mjs:233-249` (test value flip + name reword)
- Modify: `/Users/theo/Projects/claude-extensions/scripts/score.mjs:399` (evidence wording polish)

### Steps

- [ ] **Step 1: Read the current state of `_usage-data.mjs:302-314` and `:407-411`** to confirm the surrounding lines haven't drifted from the spec's quoted snippets. The hoisted flag declarations live alongside `sessionHasBtw`, `sessionHasVoice`, etc.

- [ ] **Step 2: Update the failing test FIRST** at `/Users/theo/Projects/claude-extensions/scripts/__tests__/scan-transcript-invocations.test.mjs:233-249`. Change:

```js
// before (line 233)
it("counts /rewind invocations (markup + start-of-line)", async () => {
  // /rewind is a top-level slash invocation (Boris tip 62) — only the
  // markup form and start-of-line form count, not mid-prose mentions
  // (e.g. "I should /rewind here" in a planning prompt).
  writeSession("s1", [
    userMarkup("/rewind"),
    userText("/rewind"),
    userText("we should /rewind that misstep"), // mid-sentence — does NOT count
  ]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.rewindCommandUses).toBe(2);
});

// after
it("counts sessions with at least one /rewind invocation (session-coverage)", async () => {
  // /rewind is a top-level slash invocation (Boris tip 62) — only the
  // markup form and start-of-line form count, not mid-prose mentions.
  // Counter is session-coverage (CCE-76): one session with two /rewind
  // messages contributes 1, not 2.
  writeSession("s1", [
    userMarkup("/rewind"),
    userText("/rewind"),
    userText("we should /rewind that misstep"), // mid-sentence — does NOT count
  ]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.rewindCommandUses).toBe(1);
});
```

- [ ] **Step 3: Run the updated test to verify it FAILS (red)** against the current implementation:

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs -t "session-coverage"
```

Expected: FAIL with `expected 2 to be 1` (current implementation increments per-message).

- [ ] **Step 4: Implement the counter-class unification in `_usage-data.mjs`.** Three edits:

1. **Hoist new flag declarations** alongside the existing per-session flags (around line 302-314). After `let sessionHasEffortMax = false;`, add:

```js
let sessionHasFocus = false;
let sessionHasRewind = false;
```

2. **Flip lines 334-335 to flag-sets:**

```js
// before
if (found.has("focus") && allowPosture) counts.focusCommandUses++;
if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;

// after
if (found.has("focus") && allowPosture) sessionHasFocus = true;
if (found.has("rewind") && allowPosture) sessionHasRewind = true;
```

3. **Append matching emit lines after line 411** (after `if (sessionHasColor) counts.colorCommandUses++;` and before `if (sessionHasFewerPerms) counts.fewerPermsCommandUses++;`):

```js
if (sessionHasFocus) counts.focusCommandUses++;
if (sessionHasRewind) counts.rewindCommandUses++;
```

(Order doesn't matter functionally — they're independent counters — but matching the alphabetical-ish ordering of the surrounding block is conventional.)

- [ ] **Step 5: Re-run the previously-failing test to verify it PASSES (green):**

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs -t "session-coverage"
```

Expected: PASS.

- [ ] **Step 6: Update the evidence wording polish at `score.mjs:399`:**

```js
// before
ev.push(`/focus adopted (${focusCommandUses} use(s))`);
// after
ev.push(`/focus adopted (${focusCommandUses} session(s))`);
```

- [ ] **Step 7: Run the FULL suite to verify no regressions:**

```bash
npx vitest run
```

Expected: **647 pass** (same as baseline — one test changed its assertion, no net new tests).

- [ ] **Step 8: Commit Task 0:**

```bash
git add scripts/_usage-data.mjs scripts/score.mjs scripts/__tests__/scan-transcript-invocations.test.mjs
git commit -m "$(cat <<'COMMITMSG'
feat(signals): unify focus/rewind counters to session-coverage — CCE-76 Task 0

Mirror the canonical pattern at _usage-data.mjs:407-411 used by
btw/voice/clear/compact/color. Previous per-message increments at
lines 334-335 created a counting-class mismatch that the new Memory
and Customization Execution scorers (Tasks 3-4) would have surfaced
as a calibration risk; this lands the data-layer fix first.

* _usage-data.mjs: hoist sessionHasFocus/sessionHasRewind flags;
  flip lines 334-335 to flag-sets; append emit lines after 411.
* scan-transcript-invocations.test.mjs:247 assertion flips from
  toBe(2) to toBe(1) with test name reword (session-coverage
  semantic).
* score.mjs:399 evidence wording "use(s)" -> "session(s)".

Predicates (rewindCommandUses>=1, focusCommandUses>=1) remain
satisfied; downstream MAX-merge tests in build-signals-summary.test.mjs
are agnostic to the change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 1: Add `interactiveOrUnknownSessionsAnalyzed` to insights-signals

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/insights-signals.mjs:107` (add the new computation), `:166` (include in returned object)
- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/_fixtures.mjs:114` (add to `makeSignals` insights fixture)
- Create test in: `/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-insights-signals.test.mjs` (file may not exist — check first; if not, add the test to whichever file currently exercises `gatherInsightsSignals`)

### Steps

- [ ] **Step 1: Locate where `gatherInsightsSignals` is currently tested.** Run:

```bash
rg -l "gatherInsightsSignals\b" /Users/theo/Projects/claude-extensions/scripts/__tests__/
```

If a `gather-insights-signals.test.mjs` exists, add tests there. Otherwise add to `_usage-data.test.mjs` or create the dedicated test file. (For consistency with the CCE-72 cycle which has `gather-ship-journal.test.mjs`, prefer creating `gather-insights-signals.test.mjs` if it doesn't exist.)

- [ ] **Step 2: Write the failing test** for the new field's existence + numerator-subset invariant:

```js
// In whichever test file from Step 1.
// New describe block:
describe("interactiveOrUnknownSessionsAnalyzed (CCE-76)", () => {
  it("equals interactive_cli + unknown from sessionsByKind", () => {
    // Synthetic insights output — exact shape depends on how gatherInsightsSignals
    // is invoked in the test file. The assertion is what matters:
    const insights = {
      sessionsByKind: {
        interactive_cli: 80,
        unknown: 20,
        sdk_orchestrated: 5,
        observer: 3,
        subagent: 2,
      },
      interactiveSessionsAnalyzed: 80,
      interactiveOrUnknownSessionsAnalyzed: undefined, // to be populated by gatherInsightsSignals
    };
    // Once gatherInsightsSignals computes the field, assert:
    //   insights.interactiveOrUnknownSessionsAnalyzed === 80 + 20 === 100
    // Easiest path: replace this stub with the real gatherInsightsSignals
    // invocation against a synthetic facets/session-meta fixture. Mirror
    // how the existing test file constructs its fixtures.
  });

  it("is always >= interactiveSessionsAnalyzed (numerator-subset-of-denominator invariant, CLAUDE.md hard rule from PR #97)", () => {
    // For any insights output produced by gatherInsightsSignals, assert:
    //   insights.interactiveOrUnknownSessionsAnalyzed >= insights.interactiveSessionsAnalyzed
    // This is the source-level guard. With realistic fixtures the gap
    // is small but never negative.
  });
});
```

(The exact fixture construction depends on the test file's existing patterns — adapt to match.)

- [ ] **Step 3: Run the failing test:**

```bash
npx vitest run scripts/__tests__/gather-insights-signals.test.mjs
```

Expected: FAIL with `interactiveOrUnknownSessionsAnalyzed` undefined / not in returned object.

- [ ] **Step 4: Implement the signal in `insights-signals.mjs:107`.** After the existing `interactiveSessionsAnalyzed` line, add:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

- [ ] **Step 5: Add to the return statement at `insights-signals.mjs:165-166`.** Find the existing return object and add the new field alongside `interactiveSessionsAnalyzed`:

```js
return {
  // ... existing fields ...
  sessionsByKind,
  interactiveSessionsAnalyzed,
  interactiveOrUnknownSessionsAnalyzed, // NEW
  // ... rest ...
};
```

- [ ] **Step 6: Update the test fixture at `_fixtures.mjs:114`.** Find the `makeSignals` function's `insights` block. After `interactiveSessionsAnalyzed: 100,`, add:

```js
interactiveOrUnknownSessionsAnalyzed: 100,
```

(Using the same value 100 as a default; tests that need a different value pass it explicitly.)

- [ ] **Step 7: Run the previously-failing tests + full suite:**

```bash
npx vitest run scripts/__tests__/gather-insights-signals.test.mjs
npx vitest run
```

Expected: gather-insights-signals tests pass; full suite stays green at 647 + 2 new = 649.

- [ ] **Step 8: Commit Task 1:**

```bash
git add scripts/insights-signals.mjs scripts/__tests__/_fixtures.mjs scripts/__tests__/gather-insights-signals.test.mjs
git commit -m "$(cat <<'COMMITMSG'
feat(signals): add interactiveOrUnknownSessionsAnalyzed denominator — CCE-76 Task 1

Computes sessionsByKind.interactive_cli + sessionsByKind.unknown so
the posture-gated Execution scorers (Tasks 3-4) can divide by a
denominator that matches their allowPosture-gated numerator
universe — satisfying the CLAUDE.md hard rule from PR #97 that a
ratio's numerator must be a subset of its denominator's universe.

Adds 2 tests: existence + the numerator-subset-of-denominator
invariant (interactiveOrUnknownSessionsAnalyzed >= interactiveSessionsAnalyzed)
as the source-level machine guard.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 2: Extend `withGates` with `interactive_or_unknown` universe

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/score.mjs:601-621` (function `withGates`)
- Create or extend test in: `/Users/theo/Projects/claude-extensions/scripts/__tests__/score.test.mjs` (look for existing `withGates` tests; if none, group new ones together)

### Steps

- [ ] **Step 1: Locate existing `withGates` tests:**

```bash
rg -n "withGates" /Users/theo/Projects/claude-extensions/scripts/__tests__/score.test.mjs | head
```

- [ ] **Step 2: Write the failing tests** for the new universe option. Add to `score.test.mjs`:

```js
describe("withGates: interactive_or_unknown universe (CCE-76)", () => {
  it("routes to s.insights.interactiveOrUnknownSessionsAnalyzed as denominator", () => {
    const fn = withGates({ universe: "interactive_or_unknown" }, (s) => ({
      score: s.insights.interactiveOrUnknownSessionsAnalyzed * 10,
      evidence: [],
      gaps: [],
      gapReason: null,
    }));
    const result = fn({
      insights: {
        interactiveSessionsAnalyzed: 80,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
    });
    expect(result.score).toBe(1000); // 100 * 10
    expect(fn.__universe).toBe("interactive_or_unknown");
  });

  it("returns unavailable(NO_SESSIONS) when interactiveOrUnknownSessionsAnalyzed is 0", () => {
    const fn = withGates({ universe: "interactive_or_unknown" }, () => {
      throw new Error("scorer body should not execute when denom is 0");
    });
    const result = fn({
      insights: {
        interactiveSessionsAnalyzed: 0,
        interactiveOrUnknownSessionsAnalyzed: 0,
      },
    });
    expect(result.gapReason).toBe(GAP_REASONS.NO_SESSIONS);
  });

  it("validates universe option — throws on unknown universe string", () => {
    expect(() => withGates({ universe: "bogus_universe" }, () => null)).toThrow(
      /universe must be/,
    );
  });
});
```

- [ ] **Step 3: Run the failing tests:**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "interactive_or_unknown"
```

Expected: FAIL with `withGates` rejecting the new universe option.

- [ ] **Step 4: Extend `withGates` at `score.mjs:601-621`:**

```js
// before
function withGates(opts, fn) {
  const universe = opts.universe;
  if (universe !== "interactive_only" && universe !== "all_sessions") {
    throw new Error(
      `withGates: universe must be 'interactive_only' or 'all_sessions', got ${universe}`,
    );
  }
  const wrapped = (s) => {
    if (!s.insights) return unavailable(GAP_REASONS.NO_INSIGHTS);
    if (opts.transcripts && !s.insights.transcriptsScanned) {
      return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
    }
    const denom =
      universe === "interactive_only"
        ? s.insights.interactiveSessionsAnalyzed
        : s.insights.sessionsAnalyzed;
    if (opts.requireSessions !== false && !denom) {
      return unavailable(GAP_REASONS.NO_SESSIONS);
    }
    return fn(s);
  };
  wrapped.__universe = universe;
  return wrapped;
}

// after
function withGates(opts, fn) {
  const universe = opts.universe;
  if (
    universe !== "interactive_only" &&
    universe !== "interactive_or_unknown" &&
    universe !== "all_sessions"
  ) {
    throw new Error(
      `withGates: universe must be 'interactive_only', 'interactive_or_unknown', or 'all_sessions', got ${universe}`,
    );
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
          ? s.insights.interactiveOrUnknownSessionsAnalyzed
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

- [ ] **Step 5: Re-run the previously-failing tests:**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "interactive_or_unknown"
npx vitest run
```

Expected: new tests pass; full suite 647 + 2 (Task 1) + 3 (Task 2) = 652.

- [ ] **Step 6: Commit Task 2:**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "$(cat <<'COMMITMSG'
feat(score): withGates accepts interactive_or_unknown universe — CCE-76 Task 2

Adds the third universe option (alongside interactive_only and
all_sessions) routing the denominator to interactiveOrUnknownSessionsAnalyzed.
Required for the Memory and Customization Execution scorers
(Tasks 3-4) so their denominator matches the allowPosture-gated
numerator universe.

3 tests: routing, NO_SESSIONS gap when denom=0, validation error
on unknown universe strings.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 3: Memory Execution scorer

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/score.mjs:979` (replace `memory: noTelemetry(),`)
- Create: `/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs`

### Steps

- [ ] **Step 1: Create the new test file** with the imports + memory scorer's first failing test:

```js
import { describe, it, expect } from "vitest";
import { EXECUTION_SCORERS, GAP_REASONS } from "../score.mjs";

describe("EXECUTION_SCORERS.memory (CCE-76)", () => {
  it("Test 1: returns unavailable(NO_INSIGHTS) when s.insights is missing", () => {
    const result = EXECUTION_SCORERS.memory({});
    expect(result.score).toBeNull();
    expect(result.gapReason).toBe(GAP_REASONS.NO_INSIGHTS);
  });
});
```

- [ ] **Step 2: Run the failing test:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs
```

Expected: FAIL — currently `EXECUTION_SCORERS.memory` returns `noTelemetry()` shape which has different gapReason / score semantics.

- [ ] **Step 3: Implement the Memory Execution scorer.** Replace `memory: noTelemetry(),` at `score.mjs:979` with:

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
    const rewind = merge("rewindCommandUses");
    const sum = btw + clear + compact + rewind;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const capSuffix =
      rawRatio > 1
        ? ` — capped from ${pct(rawRatio * 100)}% (multiple memory commands per session)`
        : "";
    const evidence = [
      `Memory hygiene commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${capSuffix}`,
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

- [ ] **Step 4: Re-run Test 1 — expect it to PASS:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs -t "Test 1"
```

- [ ] **Step 5: Add the remaining memory scorer tests (Tests 2-11)** to the same describe block. Use the spec's Test definitions §"Memory scorer" verbatim. Each test follows the pattern:

```js
it("Test N: <description>", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: <DENOM>,
      interactiveOrUnknownSessionsAnalyzed: <DENOM>,
      transcriptsScanned: <true/false>,
    },
    transcriptInvocations: { btwCommandUses: <N>, ... },
    historyInvocations: { btwCommandUses: <N>, ... },
  });
  expect(result.score).toBe(<EXPECTED>);
  // additional assertions per spec
});
```

Concrete tests (copy each verbatim, adjusting fixture per the spec):

```js
it("Test 2: returns unavailable(NO_TRANSCRIPTS) when transcripts not scanned", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: false,
    },
  });
  expect(result.score).toBeNull();
  expect(result.gapReason).toBe(GAP_REASONS.NO_TRANSCRIPTS);
});

it("Test 3: returns unavailable(NO_SESSIONS) when interactiveOrUnknownSessionsAnalyzed is 0", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 0,
      interactiveOrUnknownSessionsAnalyzed: 0,
      transcriptsScanned: true,
    },
  });
  expect(result.score).toBeNull();
  expect(result.gapReason).toBe(GAP_REASONS.NO_SESSIONS);
});

it("Test 4: perfect ratio at session coverage = 1.0", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { btwCommandUses: 100 },
  });
  expect(result.score).toBe(100);
});

it("Test 5: cap fires when sum exceeds denominator; evidence reports capped-from", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { btwCommandUses: 80, clearCommandUses: 80 },
  });
  expect(result.score).toBe(100);
  expect(result.evidence[0]).toMatch(/capped from 160%/);
});

it("Test 6: history-source contributes via MAX-merge (btw)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { btwCommandUses: 5 },
    historyInvocations: { btwCommandUses: 30 },
  });
  expect(result.score).toBe(30);
});

it("Test 7: rewind is transcript-only (HISTORY_COMMAND_LIST excludes it)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { rewindCommandUses: 10 },
    // historyInvocations.rewindCommandUses intentionally undefined
  });
  expect(result.score).toBe(10);
});

it("Test 8: zero-signal produces gap message", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: {},
  });
  expect(result.score).toBe(0);
  expect(result.gaps[0]).toMatch(/No \/btw, \/clear, \/compact, or \/rewind/);
});

it("Test 9: realistic mixed input (author baseline)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 120,
      interactiveOrUnknownSessionsAnalyzed: 120,
      transcriptsScanned: true,
    },
    transcriptInvocations: {
      btwCommandUses: 39,
      clearCommandUses: 15,
      compactCommandUses: 8,
      rewindCommandUses: 0,
    },
  });
  expect(result.score).toBe(52);
  expect(result.evidence[0]).toMatch(/62 session-coverage hits across 120/);
  expect(result.evidence[0]).not.toMatch(/capped/);
});

it("Test 10: one counter at exactly denom (boundary — no cap suffix)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { btwCommandUses: 100 },
  });
  expect(result.score).toBe(100);
  expect(result.evidence[0]).not.toMatch(/capped/);
});

it("Test 11: partial coverage", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { btwCommandUses: 37 },
  });
  expect(result.score).toBe(37);
});
```

- [ ] **Step 6: Run all memory scorer tests:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs
```

Expected: 11 pass.

- [ ] **Step 7: Run the FULL suite:**

```bash
npx vitest run
```

Expected: 647 baseline + 2 (Task 1) + 3 (Task 2) + 11 (Task 3) = 663.

- [ ] **Step 8: Commit Task 3:**

```bash
git add scripts/score.mjs scripts/__tests__/memory-customization-execution-scorers.test.mjs
git commit -m "$(cat <<'COMMITMSG'
feat(score): Memory Execution scorer (transcript-derived) — CCE-76 Task 3

Replaces memory: noTelemetry() with withGates({ transcripts: true,
universe: "interactive_or_unknown" }) consuming inline MAX-merged
session-coverage counts of /btw, /clear, /compact, /rewind over
interactiveOrUnknownSessionsAnalyzed. Cap fires via Math.min(ratio, 1);
evidence string surfaces "capped from N%" when rawRatio > 1 so
pathological over-use is visible rather than silently saturating
to 100.

11 tests cover: NO_INSIGHTS / NO_TRANSCRIPTS / NO_SESSIONS gates,
perfect ratio, cap with evidence text, MAX-merge (btw),
transcript-only rewind, zero-signal gap, realistic baseline (62/120),
boundary (sum===denom), partial coverage.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 4: Customization Execution scorer

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/score.mjs:980` (replace `customization: noTelemetry(),`)
- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs` (append customization tests)

### Steps

- [ ] **Step 1: Write the first failing customization test.** Append to the test file:

```js
describe("EXECUTION_SCORERS.customization (CCE-76)", () => {
  it("Test 12: perfect ratio", () => {
    const result = EXECUTION_SCORERS.customization({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { colorCommandUses: 100 },
    });
    expect(result.score).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs -t "Test 12"
```

Expected: FAIL.

- [ ] **Step 3: Implement the Customization Execution scorer at `score.mjs:980`:**

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
    const capSuffix =
      rawRatio > 1
        ? ` — capped from ${pct(rawRatio * 100)}% (multiple customization commands per session)`
        : "";
    const evidence = [
      `Customization commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${capSuffix}`,
    ];
    const gaps = [];
    if (sum === 0) {
      gaps.push("No /color, /voice, or /focus in any interactive session");
    }
    return { score, evidence, gaps, gapReason: null };
  },
),
```

- [ ] **Step 4: Add Tests 13-15** to the customization describe block:

```js
it("Test 13: cap fires; evidence reports capped-from", () => {
  const result = EXECUTION_SCORERS.customization({
    insights: {
      interactiveSessionsAnalyzed: 10,
      interactiveOrUnknownSessionsAnalyzed: 10,
      transcriptsScanned: true,
    },
    transcriptInvocations: {
      colorCommandUses: 10,
      voiceCommandUses: 10,
      focusCommandUses: 10,
    },
  });
  expect(result.score).toBe(100);
  expect(result.evidence[0]).toMatch(/capped from 300%/);
});

it("Test 14: zero-signal produces gap message", () => {
  const result = EXECUTION_SCORERS.customization({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: {},
  });
  expect(result.score).toBe(0);
  expect(result.gaps[0]).toMatch(/No \/color, \/voice, or \/focus/);
});

it("Test 15: realistic mixed input (author baseline)", () => {
  const result = EXECUTION_SCORERS.customization({
    insights: {
      interactiveSessionsAnalyzed: 120,
      interactiveOrUnknownSessionsAnalyzed: 120,
      transcriptsScanned: true,
    },
    transcriptInvocations: {
      colorCommandUses: 3,
      voiceCommandUses: 0,
      focusCommandUses: 1,
    },
  });
  expect(result.score).toBe(3);
});
```

- [ ] **Step 5: Run all customization tests + full suite:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs
npx vitest run
```

Expected: 15 tests in the new file pass; full suite at 663 + 4 (Tests 12-15) = 667.

- [ ] **Step 6: Commit Task 4:**

```bash
git add scripts/score.mjs scripts/__tests__/memory-customization-execution-scorers.test.mjs
git commit -m "$(cat <<'COMMITMSG'
feat(score): Customization Execution scorer (transcript-derived) — CCE-76 Task 4

Same shape as the memory scorer: withGates({ transcripts: true,
universe: "interactive_or_unknown" }) consuming MAX-merged
session-coverage counts of /color, /voice, /focus.

4 tests: perfect ratio, cap with evidence text, zero-signal gap,
realistic baseline (4/120).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 5: Cross-cutting universe contract test

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs`

### Steps

- [ ] **Step 1: Write the cross-cutting test.** Append a new describe block:

```js
describe("EXECUTION_SCORERS universe contract (CCE-76)", () => {
  it("Test 16: memory + customization both expose __universe === 'interactive_or_unknown'", () => {
    expect(EXECUTION_SCORERS.memory.__universe).toBe("interactive_or_unknown");
    expect(EXECUTION_SCORERS.customization.__universe).toBe(
      "interactive_or_unknown",
    );
  });
});
```

- [ ] **Step 2: Run:**

```bash
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs -t "universe contract"
```

Expected: PASS (the `__universe` field is set by `withGates` at line 624 / `wrapped.__universe = universe`).

- [ ] **Step 3: Run full suite:**

```bash
npx vitest run
```

Expected: 667 + 1 = **668 pass**.

- [ ] **Step 4: Commit Task 5:**

```bash
git add scripts/__tests__/memory-customization-execution-scorers.test.mjs
git commit -m "$(cat <<'COMMITMSG'
test(score): universe contract for memory+customization — CCE-76 Task 5

Asserts both new Execution scorers expose __universe ===
"interactive_or_unknown" via withGates' contract attachment.
Machine guard that a future refactor can't silently drop the
correct universe binding.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 6: Probe-tracker spec update

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

### Steps

- [ ] **Step 1: Read the current state of the tracker spec** to locate the Part 1 Insights/cooked-telemetry layer rows, the Part 1 Transcripts layer rows for the 7 affected counters, and the footnote definitions block (around line 273).

- [ ] **Step 2: Add a new row to Part 1 Insights/cooked-telemetry layer** for `interactiveOrUnknownSessionsAnalyzed`. Follow the format of the existing `interactiveSessionsAnalyzed` row (same source `insights-signals.mjs`, role: denominator universe for posture-gated Execution scorers). Cite `[^memory-customization-exec]`.

- [ ] **Step 3: Add `[^memory-customization-exec]` footnote anchor** to the rows for the 7 transcript-counter rows in Part 1: `btwCommandUses`, `clearCommandUses`, `compactCommandUses`, `rewindCommandUses`, `colorCommandUses`, `voiceCommandUses`, `focusCommandUses`. Match the precedent of the existing `[^partition]` and `[^journal-stage-credit]` anchors on adjacent rows.

- [ ] **Step 4: Append the footnote definition** immediately after `[^journal-stage-credit]` at line 273 (or whatever the current line number is — the definitions live as a block at the bottom of the spec):

```markdown
[^memory-customization-exec]: As of PR #N (CCE-76, spec 2026-06-01), these posture-command counters and the new `interactiveOrUnknownSessionsAnalyzed` denominator feed the Memory and Customization Execution scorers. Both scorers gate on `transcripts: true` and the new `interactive_or_unknown` universe option in `withGates`. The five machine-enforced header counts are unchanged (no new probes / catalog entries / signalsSummary keys).
```

Use `PR #N` as a placeholder; swap to the actual PR number after creation (mirror the CCE-72 / CCE-71 cycles' approach).

- [ ] **Step 5: Update Part 2 tip-coverage table Axis column.** For each tip row whose command is now consumed by the new Memory or Customization Execution scorer, change `Axis` from `P` (Platform Setup only) to `P+E` (Platform Setup + Execution). The affected tips are those for `/btw`, `/clear`, `/compact`, `/rewind`, `/color`, `/voice`, `/focus`. **Do NOT change `Status` — all rows are already ✅ from CCE-71's predicates.** Verify exact tip numbers against the live tracker before editing.

- [ ] **Step 6: Run the tracker-counts gate:**

```bash
npx vitest run scripts/__tests__/tracker-counts.test.mjs
```

Expected: 5/5 PASS (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys — none change).

- [ ] **Step 7: Verify `signalsSummary` count is still 71** via live invocation (CLAUDE.md rule: "derive by invoking, not by parsing"):

```bash
node -e "
import('./scripts/__tests__/_fixtures.mjs').then(f =>
  import('./scripts/run-assessment.mjs').then(r => {
    const summary = r.buildSignalsSummary(f.makeSignals());
    console.log('signalsSummary keys:', Object.keys(summary).length);
  })
)" 2>/dev/null
```

Expected output: `signalsSummary keys: 71`.

(If `buildSignalsSummary` isn't exported from `run-assessment.mjs`, adapt: invoke via a small one-off script or extend the export.)

- [ ] **Step 8: Commit Task 6:**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "$(cat <<'COMMITMSG'
docs(probe-tracker): annotate Memory + Customization Execution coverage — CCE-76 Task 6

* New Part 1 Insights row: interactiveOrUnknownSessionsAnalyzed.
* New footnote [^memory-customization-exec] anchoring 7 transcript
  counter rows + the new Insights row.
* Footnote definition appended after [^journal-stage-credit].
* Part 2 Axis column: P -> P+E for the 7 affected tip rows
  (memory/customization commands now feed both axes). Status
  unchanged (rows were already ✅ from CCE-71 predicates).
* Five header counts unchanged at 75/12/48/47/71.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 7: CLAUDE.md scoring-model paragraph rewrite

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/CLAUDE.md`

### Steps

- [ ] **Step 1: Locate the scoring-model paragraph.** Currently reads (around lines 49-55):

> Ten of twelve dims have Execution scorers. The remaining two (Memory & Context, Terminal & Customization) route to _unmeasured_ via `gapReason` because the relevant signals never reach the cooked telemetry. Model & Effort is _partially_ measured: the Opus-usage half (Boris tip 2) is scored from transcripts, but effort level stays settings-only. Unmeasured ≠ scored zero — the radar marks unmeasured dims with italic labels and a footnote.

- [ ] **Step 2: Replace with:**

```markdown
**All twelve dimensions** have Execution scorers as of CCE-76 (PR #N). Memory & Context Management and Terminal & Customization Execution scorers consume **transcript-derived posture-command coverage signals** (the `interactive_cli ∪ unknown`-gated counters from CCE-71) against the new `interactive_or_unknown` session universe (`sessionsByKind.interactive_cli + sessionsByKind.unknown`). This mixes transcript signals into Execution scoring — matching the precedent set by `learning` (`★ Insight` banner) and `parallel` (worktree usage). Model & Effort Tuning remains the only partially-measured dim (the Opus-usage half is scored from transcripts; effort level stays settings-only). Italic-unmeasured labels on the radar now apply only to dims whose Execution score returns `gapReason !== null` (e.g. zero interactive sessions in window).
```

(`PR #N` is a placeholder; swap to the actual PR number after creation.)

- [ ] **Step 3: Commit Task 7:**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'COMMITMSG'
docs(claude.md): scoring-model paragraph reflects 12 measured dims — CCE-76 Task 7

Memory + Customization Execution scorers are no longer noTelemetry().
Rewrite the paragraph to describe the new measurement basis (the
posture-command coverage signals + the interactive_or_unknown
denominator universe). Model & Effort Tuning remains the only
partially-measured dim.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 8: `app/methodology/page.tsx` Memory + Customization sections

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/app/methodology/page.tsx`

### Steps

- [ ] **Step 1: Locate the Memory and Customization sections** in `app/methodology/page.tsx`. They currently describe these dims as unmeasured / `noTelemetry()`.

```bash
grep -n "memory\|customization\|noTelemetry\|unmeasured" /Users/theo/Projects/claude-extensions/app/methodology/page.tsx | head -30
```

- [ ] **Step 2: Update both sections** to describe the new measurement basis. For each: the rubric target (92 for memory, 80 for customization), the formula (`min(sum / interactiveOrUnknownSessionsAnalyzed, 1) × 100`), the input counters, and the "cap surfaces in evidence" behavior. Mirror the depth of other dims' methodology sections.

- [ ] **Step 3: Verify the build doesn't break:**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 4: Run the dashboard locally and manually verify** the Memory + Customization sections render correctly:

```bash
npm run dev  # background or in a separate terminal
# Open http://localhost:3737/methodology
# Confirm Memory + Customization rows describe the new measurement
```

- [ ] **Step 5: Commit Task 8:**

```bash
git add app/methodology/page.tsx
git commit -m "$(cat <<'COMMITMSG'
docs(methodology): Memory + Customization measurement basis — CCE-76 Task 8

Update the methodology page to describe the new Execution scorers:
the posture-command coverage formula, the interactive_or_unknown
denominator universe, the Math.min cap with evidence visibility,
and the rubric targets (memory=92, customization=80).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMITMSG
)"
```

---

## Task 9: Live verification + delta capture

**Files:**

- No code changes — verification only.

### Steps

- [ ] **Step 1: Create a worktree at main for the pre-baseline:**

```bash
git worktree add /tmp/cce76-baseline-wt main
```

- [ ] **Step 2: Run baseline assessment from the worktree:**

```bash
(cd /tmp/cce76-baseline-wt && npm run assess --include-transcripts --insights-lookback 30 --no-slack --print) > /tmp/cce76-pre.txt 2>&1
```

- [ ] **Step 3: Run post-fix assessment from the feature branch:**

```bash
npm run assess --include-transcripts --insights-lookback 30 --no-slack --print > /tmp/cce76-post.txt 2>&1
```

- [ ] **Step 4: Diff and capture the relevant deltas:**

```bash
diff /tmp/cce76-pre.txt /tmp/cce76-post.txt | head -100
```

Specifically capture:

- `focusCommandUses` pre vs post (expected unchanged at author's current usage)
- `rewindCommandUses` pre vs post (expected unchanged)
- `Memory` dim Execution score: italic-unmeasured → numeric (~57)
- `Customization` dim Execution score: italic-unmeasured → numeric (~4)
- Top-10 next-actions: confirm no `memory/*` or `customization/*` action that now satisfies its predicate stays in the list

- [ ] **Step 5: Write the captured deltas to a PR notes file** (used in `/ship` Stage 6):

```bash
# Author the PR body in /tmp/cce76-pr-notes.txt with the captured deltas.
# Use the Write tool, not heredoc + git commit (block-destructive.sh
# scans heredoc bodies and may flag the diff content).
```

- [ ] **Step 6: Clean up the worktree:**

```bash
rm /tmp/cce76-pre.txt /tmp/cce76-post.txt
git worktree remove /tmp/cce76-baseline-wt
git fetch --prune
```

(If `--force` is needed and gets blocked: `git worktree remove --force /tmp/cce76-baseline-wt` will be blocked by `block-destructive.sh`; use the unforced form, ensuring the worktree has no uncommitted changes first.)

---

## Task 10: `/ship` CCE-76

**Files:**

- Driven entirely by the `/ship` skill.

### Steps

- [ ] **Step 1: Verify all prior tasks committed:**

```bash
git log --oneline main..HEAD
```

Expected: 8 commits (Tasks 0-8, Task 9 has no commit).

- [ ] **Step 2: Invoke `/ship` with the PR body file from Task 9:**

```bash
/ship --body-file /tmp/cce76-pr-notes.txt
```

- [ ] **Step 3: After successful squash-merge:**
  1. `gh pr view <PR#> --json state,mergeCommit` — confirm `MERGED`.
  2. `git fetch --prune && git merge --ff-only origin/main`.
  3. Update the `PR #N` placeholders in the spec, plan, CLAUDE.md, and probe-tracker spec to the actual PR number (small follow-up commit OR include in /ship's commit message).

- [ ] **Step 4: Jira transitions** (per CLAUDE.md "Auto-mode authorization for Jira writes is scoped per action, not per session" — each transition needs explicit user direction):
  - Backlog → In Progress (already happened during /ship Stage 7)
  - In Progress → Done (manual user-approved step after merge)

- [ ] **Step 5: Post-merge live verification.** Re-run `npm run assess --include-transcripts --insights-lookback 30` from a clean `main` and confirm:
  - Memory Execution displays a real numeric score (~57)
  - Customization Execution displays a real numeric score (~4)
  - The radar's two previously-italic vertices become solid
  - `signalsSummary` keys count is still 71 via the live invocation
  - No new errors in console.

---

## Final-task checklist (post-/ship)

- [ ] CCE-76 transitioned to Done on Jira
- [ ] `PR #N` placeholders swapped to the actual PR number in spec, plan, CLAUDE.md, and probe-tracker spec
- [ ] Spec moved to `docs/superpowers/plans/archived/` (the next plan-archive PR will fold this in, per the recent hygiene cycle)
- [ ] Dashboard verified at http://localhost:3737 with the two new Execution vertices solid
