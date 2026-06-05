# CCE-79 Memory Execution Scorer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Memory Execution scorer so the ratio numerator only contains semantically-consistent session-coverage signals (`/clear + /compact`); surface `/btw` as cumulative evidence text; drop `/rewind` from the ratio while keeping its next-action probe; recalibrate the rubric target 92 → 60.

**Architecture:** Single-PR change in `claude-code-self-assessment` on branch `chore/CCE-79-memory-scorer-redesign`. Six components — A scorer (`scripts/score.mjs`), B rubric target (`app/data/rubric.json`), C methodology narrative (`app/methodology/page.tsx`), D dimension-explainer verify-only (`app/lib/dimension-explainer.ts`), E fixtures (`scripts/__tests__/_fixtures.mjs`), F tests (`scripts/__tests__/memory-customization-execution-scorers.test.mjs`), G CLAUDE.md rule (`/Users/theo/Projects/claude-extensions/CLAUDE.md`). TDD: write the six new/updated test cases first (RED), then make them pass (GREEN).

**Tech Stack:** Node.js ESM, Vitest, Next.js 16 (for the methodology page).

**Spec:** `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md` (committed `421addb`).

**Jira tracker:** CCE-79.

---

## File Structure

| Path                                                                                                       | Role                                                             | Action                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `/Users/theo/Projects/claude-extensions/scripts/score.mjs`                                                 | EXECUTION scorer definitions; `memory` block at lines 977–1003.  | Modify                         |
| `/Users/theo/Projects/claude-extensions/app/data/rubric.json`                                              | Rubric target table; `memory.target` at line 226.                | Modify                         |
| `/Users/theo/Projects/claude-extensions/app/methodology/page.tsx`                                          | Methodology page narrative; Memory `<li>` at lines 187–215.      | Modify                         |
| `/Users/theo/Projects/claude-extensions/app/lib/dimension-explainer.ts`                                    | Dimension explainer (PLATFORM); `memory` block at lines 82–92.   | Verify only (no edit expected) |
| `/Users/theo/Projects/claude-extensions/scripts/__tests__/_fixtures.mjs`                                   | `makeSignals` / `makeAssessment` test fixtures.                  | Modify                         |
| `/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs` | Memory + Customization EXECUTION scorer tests (16+ cases today). | Modify                         |
| `/Users/theo/Projects/claude-extensions/CLAUDE.md`                                                         | Project memory; CCE-78 cumulative-vs-windowed rule lives here.   | Modify                         |

---

## Phase 0 — Pre-execution 3-agent validation gate

**Goal:** Before any code edit, dispatch three independent reviewer agents against this plan + spec to surface gaps. This is the same gate used in P1 (CCE-77 hygiene) and is required by the user's "3 agents reviewing for each step" directive.

- [ ] **Step 0.1: Dispatch lens 1 — spec coverage.**

Reviewer subagent prompt (verbatim, no rewording):

> Read the spec at `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md` and the plan at `/Users/theo/Projects/claude-extensions/docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`. For each line item in the spec's §Acceptance criteria (1 through 9), point to the specific plan task that implements it. Report any acceptance criterion that has no corresponding task. Under 250 words.

- [ ] **Step 0.2: Dispatch lens 2 — completeness/placeholder scan.**

> Read `/Users/theo/Projects/claude-extensions/docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`. Scan for placeholders: "TBD", "TODO", "implement later", "add appropriate error handling", references to functions/files/fixtures that don't exist or aren't defined in any task. Confirm every code step has a code block; every command step has the exact command and expected output. Report any gap. Under 200 words.

- [ ] **Step 0.3: Dispatch lens 3 — scope/risk.**

> Read the spec and plan above. Assess: (a) is the scope correct for a single PR, or should it be decomposed? (b) what's the highest-risk task in the plan, and does the plan adequately mitigate it? (c) are there hidden coupling risks — e.g., does any other Execution scorer or downstream consumer read `btwCommandUses`/`rewindCommandUses` in a way that the plan misses? Run `grep -rn "btwCommandUses\|rewindCommandUses" /Users/theo/Projects/claude-extensions/scripts /Users/theo/Projects/claude-extensions/app` to ground the answer. Report findings. Under 300 words.

- [ ] **Step 0.4: Review the three reports.**

If any reviewer flags a blocking concern (missing acceptance-criterion coverage, placeholder, unmitigated coupling), pause and apply corrections to this plan file before proceeding to Phase 1. If concerns are observations only, note them inline and continue.

- [ ] **Step 0.5: Commit any plan corrections.**

```bash
cd /Users/theo/Projects/claude-extensions
git add docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md
git commit -m "$(cat <<'EOF'
docs(plans): CCE-79 — apply Phase 0 validation feedback

Pre-execution 3-agent gate corrections from spec-coverage / completeness /
scope-risk lenses applied to the implementation plan before any code edit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If no corrections were needed, skip this step.

---

## Phase 1 — RED: write failing tests (Component F)

**Why RED first:** All six new/updated test cases must fail against the current scorer code before any implementation change. This proves the tests actually distinguish old from new behavior. If a "new" test passes against the current scorer, the test is wrong.

### Task 1: Write 6 new/updated test cases in memory-customization-execution-scorers.test.mjs

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs`

- [ ] **Step 1.1: Read the existing test file fully.**

```bash
cat /Users/theo/Projects/claude-extensions/scripts/__tests__/memory-customization-execution-scorers.test.mjs
```

Expected: 11 existing memory tests (Tests 1–11) + Customization tests starting at Test 12. The pattern is `EXECUTION_SCORERS.memory({insights: {...}, transcriptInvocations: {...}, historyInvocations: {...}, signalsSummary: {...}})`.

- [ ] **Step 1.2: UPDATE Test 6 — history-source MAX-merge with /btw must be re-scoped.**

`/btw` is dropping from the numerator. Test 6 today asserts `historyInvocations.btwCommandUses=30` produces `score: 30`. Under the new design, this fixture should produce `score: 0` because `/btw` no longer contributes to `sum`. Re-target the test to use `clearCommandUses` instead, which preserves the MAX-merge regression intent without coupling to `/btw`.

Replace the current Test 6 block with:

```js
it("Test 6: history-source contributes via MAX-merge (clear)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { clearCommandUses: 5 },
    historyInvocations: { clearCommandUses: 30 },
  });
  expect(result.score).toBe(30);
});
```

- [ ] **Step 1.3: REPLACE Test 7 — /rewind drops from numerator.**

Test 7 today asserts that `rewindCommandUses=10` (transcript-only, no history analogue) produces `score: 10`. Under the new design, `/rewind` is not in the numerator at all, so the same fixture must produce `score: 0`. Replace with:

```js
it("Test 7: /rewind no longer contributes to numerator (CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { rewindCommandUses: 10 },
  });
  expect(result.score).toBe(0);
});
```

- [ ] **Step 1.4: UPDATE Test 8 — gap text narrowed.**

Test 8 today asserts the zero-signal gap matches `/No \/btw, \/clear, \/compact, or \/rewind/`. Under the new design the gap mentions only the two surviving commands. Update the assertion to:

```js
expect(result.gaps[0]).toMatch(
  /No \/clear or \/compact in any interactive session/,
);
```

(Test name and the rest of the body stay the same.)

- [ ] **Step 1.5: UPDATE Test 9 — realistic mixed input expected score recalculates.**

Test 9 today fixtures `btw=39, clear=15, compact=8, rewind=0, denom=120` → expects `score: 52` and evidence `"62 session-coverage hits across 120"`. Under the new design, numerator is only `clear+compact = 23`, ratio = `23/120 ≈ 19.17%`, rounded to `19`. Evidence text becomes `"23 session-coverage hits across 120 interactive_cli∪unknown sessions (19%)"`. Update the assertions:

```js
expect(result.score).toBe(19);
expect(result.evidence[0]).toMatch(/23 session-coverage hits across 120/);
expect(result.evidence[0]).not.toMatch(/capped/);
```

- [ ] **Step 1.6: UPDATE Test 10 + Test 11 + Tests 4 and 5 — switch from /btw to /clear in fixtures.**

Tests 4, 5, 10, and 11 today drive the numerator entirely via `btwCommandUses`. Switch each to drive it via `clearCommandUses` (the equivalent session-coverage signal that remains in the numerator). Keep the same denominators and expected scores — they are about ratio math, not about `/btw` specifically.

Examples:

- Test 4: `transcriptInvocations: { btwCommandUses: 100 }` → `transcriptInvocations: { clearCommandUses: 100 }` (still expects `score: 100`).
- Test 5: `transcriptInvocations: { btwCommandUses: 80, clearCommandUses: 80 }` → `transcriptInvocations: { clearCommandUses: 80, compactCommandUses: 80 }` (still expects `score: 100` with `capped from` in evidence).
- Test 10: `transcriptInvocations: { btwCommandUses: 100 }` → `transcriptInvocations: { clearCommandUses: 100 }` (still expects `score: 100`, no `capped` suffix).
- Test 11: `transcriptInvocations: { btwCommandUses: 37 }` → `transcriptInvocations: { clearCommandUses: 37 }` (still expects `score: 37`).

These are 1-line fixture swaps. Keep the test names; the math intent is unchanged.

- [ ] **Step 1.7: ADD Test 12a — numerator excludes /btw and /rewind (CCE-79).**

Insert after Test 11, before the `describe("EXECUTION_SCORERS.customization …")` block:

```js
it("Test 12a: numerator excludes /btw and /rewind (CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: {
      btwCommandUses: 100,
      rewindCommandUses: 100,
      clearCommandUses: 0,
      compactCommandUses: 0,
    },
  });
  expect(result.score).toBe(0);
});
```

- [ ] **Step 1.8: ADD Test 12b — /btw cumulative surfaces as evidence text (CCE-79).**

```js
it("Test 12b: /btw cumulative surfaces as evidence text (CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { clearCommandUses: 5 },
    signalsSummary: { cliBtwUseCountAllTime: 42 },
  });
  expect(result.evidence[0]).toMatch(
    /Plus 42 all-time \/btw invocations \(cumulative, not in ratio\)/,
  );
});
```

- [ ] **Step 1.9: ADD Test 12c — /btw evidence text omitted when zero (CCE-79).**

```js
it("Test 12c: /btw evidence text omitted when cliBtwUseCountAllTime is 0 (CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 100,
      interactiveOrUnknownSessionsAnalyzed: 100,
      transcriptsScanned: true,
    },
    transcriptInvocations: { clearCommandUses: 5 },
    signalsSummary: { cliBtwUseCountAllTime: 0 },
  });
  expect(result.evidence[0]).not.toMatch(/Plus .* all-time \/btw/);
});
```

- [ ] **Step 1.10: ADD Test 12d — /clear + /compact regression in numerator (CCE-79).**

```js
it("Test 12d: /clear + /compact in numerator (regression, CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 10,
      interactiveOrUnknownSessionsAnalyzed: 10,
      transcriptsScanned: true,
    },
    transcriptInvocations: { clearCommandUses: 5, compactCommandUses: 3 },
  });
  expect(result.score).toBe(80);
});
```

- [ ] **Step 1.11: ADD Test 12e — cap behavior preserved on narrowed numerator (CCE-79).**

```js
it("Test 12e: cap behavior preserved on narrowed numerator (CCE-79)", () => {
  const result = EXECUTION_SCORERS.memory({
    insights: {
      interactiveSessionsAnalyzed: 10,
      interactiveOrUnknownSessionsAnalyzed: 10,
      transcriptsScanned: true,
    },
    transcriptInvocations: { clearCommandUses: 15, compactCommandUses: 15 },
  });
  expect(result.score).toBe(100);
  expect(result.evidence[0]).toMatch(/capped from \d+%/);
});
```

- [ ] **Step 1.12: ADD Test 12f — rubric target is 60 (CCE-79).**

This is a rubric-side test; place it in the memory describe block.

```js
it("Test 12f: rubric memory target is 60 (CCE-79)", async () => {
  const { default: rubric } = await import("../../app/data/rubric.json", {
    with: { type: "json" },
  });
  const memDim = rubric.dimensions.find((d) => d.id === "memory");
  expect(memDim.target).toBe(60);
});
```

If the `import attributes` syntax fails in the current Vitest/Node version, fall back to:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// ...inside the test:
const __dirname = dirname(fileURLToPath(import.meta.url));
const rubric = JSON.parse(
  readFileSync(resolve(__dirname, "../../app/data/rubric.json"), "utf8"),
);
const memDim = rubric.dimensions.find((d) => d.id === "memory");
expect(memDim.target).toBe(60);
```

- [ ] **Step 1.13: Run the suite — confirm RED for the 6 new tests and the 5 updated tests.**

```bash
cd /Users/theo/Projects/claude-extensions
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs 2>&1 | tail -50
```

Expected: 11 failures total (Tests 4, 5, 6, 7, 8, 9, 10, 11 fail because numerator still includes /btw and /rewind; Tests 12a, 12b, 12d, 12e, 12f fail because either the new behavior isn't implemented or the rubric target hasn't been changed yet; Test 12c may pass coincidentally because the evidence string today doesn't contain "Plus … all-time /btw"). The Customization tests below should all stay green (unchanged).

If the RED count is wrong, stop and investigate — either the test fixtures are not actually exercising the changed paths, or the existing scorer is somehow already partially fixed.

- [ ] **Step 1.14: Commit the failing tests.**

```bash
cd /Users/theo/Projects/claude-extensions
git add scripts/__tests__/memory-customization-execution-scorers.test.mjs
git commit -m "$(cat <<'EOF'
test(memory): RED — failing tests for narrowed numerator + /btw evidence — CCE-79

Updates Tests 4-11 to drive the numerator via /clear (the session-coverage
signal that survives the redesign) instead of /btw. Adds Tests 12a-12f
covering the CCE-79 contract: /btw and /rewind excluded from the ratio,
cliBtwUseCountAllTime surfaces as evidence text, gap text narrowed, rubric
target lowered to 60.

Tests intentionally fail against the current scorer; will go green after
Components A and B land.

Spec: docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — GREEN: implement the redesign (Components A, B, E)

### Task 2: Update fixtures to populate cliBtwUseCountAllTime (Component E)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/__tests__/_fixtures.mjs`

The new evidence-text test (Step 1.8) passes `signalsSummary.cliBtwUseCountAllTime` directly through the test fixture, so the source-of-truth path is covered. Still, `makeSignals` / `makeAssessment` should default `cliBtwUseCountAllTime` to `0` so any downstream test that exercises `signalsSummary` through the assessment fixture sees the field rather than `undefined`.

- [ ] **Step 2.1: Locate the `signalsSummary` default in \_fixtures.mjs.**

```bash
cd /Users/theo/Projects/claude-extensions
grep -n "signalsSummary\|cliBtwUseCount" scripts/__tests__/_fixtures.mjs
```

Expected: the file exports `makeSignals`, `makeInsights`, `makeAssessment`, `makeTranscriptInvocations`, `makeHistoryInvocations`. The `signalsSummary` default (or its computation) may live inline within `makeAssessment` or as a separate exported helper. Identify where to add the field.

- [ ] **Step 2.2: Add `cliBtwUseCountAllTime: 0` to the default `signalsSummary` shape.**

If `signalsSummary` is built by an exported helper (e.g., `makeSignalsSummary`), add the field there. If it's spread inline within `makeAssessment`, add it to that object. Use the `deepMerge(base, overrides)` pattern already established in the file so test-level overrides still work.

Minimal edit (insertion into the appropriate `signalsSummary` default object):

```js
cliBtwUseCountAllTime: 0,
```

- [ ] **Step 2.3: Run the full fixtures-using test suite to confirm no fixture regressions.**

```bash
cd /Users/theo/Projects/claude-extensions
npx vitest run scripts/__tests__/_fixtures.test.mjs 2>&1 | tail -20
npx vitest run --no-coverage 2>&1 | tail -10
```

Expected: every test that uses fixtures still loads and runs (counts unchanged from baseline). Memory tests still RED (we haven't changed the scorer yet); everything else unchanged.

- [ ] **Step 2.4: Commit.**

```bash
cd /Users/theo/Projects/claude-extensions
git add scripts/__tests__/_fixtures.mjs
git commit -m "$(cat <<'EOF'
test(fixtures): default signalsSummary.cliBtwUseCountAllTime to 0 — CCE-79

Memory Execution scorer reads cliBtwUseCountAllTime for the new evidence-text
path. Add the field to the fixture defaults so downstream assessment-shape
tests see the field, not undefined.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Redesign the memory scorer (Component A)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/score.mjs` lines 977–1003

- [ ] **Step 3.1: Replace the memory block.**

Use Edit with the exact `old_string` (current block lines 977–1003) and exact `new_string`:

```js
  memory: withGates(
    { transcripts: true, universe: "interactive_or_unknown" },
    (s) => {
      const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
      // CCE-79: numerator restricted to session-coverage signals only.
      // /btw (cumulative all-time) shown as evidence text, not in ratio.
      // /rewind (keyboard-shortcut, near-zero signal) dropped from ratio;
      // kept as a binary next-action probe via rubric satisfiedWhen.
      const clear = maxProbe(s, "clearCommandUses");
      const compact = maxProbe(s, "compactCommandUses");
      const sum = clear + compact;
      const rawRatio = sum / denom;
      const ratio = Math.min(rawRatio, 1);
      const score = Math.round(ratio * 100);
      const capSuffix =
        rawRatio > 1
          ? ` — capped from ${pct(rawRatio * 100)}% (multiple memory commands per session)`
          : "";
      const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
      const btwEvidence =
        btwAllTime > 0
          ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
          : "";
      const evidence = [
        `Memory hygiene commands: ${sum} session-coverage hits across ${denom} interactive_cli∪unknown sessions (${pct(ratio * 100)}%)${capSuffix}.${btwEvidence}`,
      ];
      const gaps = [];
      if (sum === 0) {
        gaps.push(
          "No /clear or /compact in any interactive session",
        );
      }
      return { score, evidence, gaps, gapReason: null };
    },
  ),
```

- [ ] **Step 3.2: Run the memory test file — confirm GREEN.**

```bash
cd /Users/theo/Projects/claude-extensions
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs 2>&1 | tail -30
```

Expected: all memory tests now PASS except Test 12f (rubric-target test still RED; Task 4 fixes it). Customization tests still pass.

If any memory test still RED, debug — likely either the evidence string format doesn't match the test regex, or a fixture path wasn't updated. Do NOT proceed until all memory scorer tests except Test 12f pass.

- [ ] **Step 3.3: Commit.**

```bash
cd /Users/theo/Projects/claude-extensions
git add scripts/score.mjs
git commit -m "$(cat <<'EOF'
feat(scoring): narrow Memory Execution ratio to /clear + /compact — CCE-79

Numerator drops /btw (cumulative all-time, wrong shape for windowed ratio)
and /rewind (keyboard-shortcut, near-zero signal). /btw surfaces as
cumulative evidence text via signalsSummary.cliBtwUseCountAllTime when
non-zero; /rewind remains as a binary next-action probe in rubric.json.

Per-field semantic categorization rationale documented in spec §Context.

Spec: docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 4: Lower rubric target 92 → 60 (Component B)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/app/data/rubric.json` line 226

- [ ] **Step 4.1: Edit the target.**

Use Edit:

```
old_string:       "target": 92,
                  "rubricArea": "Long-horizon context hygiene",
new_string:       "target": 60,
                  "rubricArea": "Long-horizon context hygiene",
```

(The trailing line context disambiguates from other `"target": 92` occurrences if any exist.)

- [ ] **Step 4.2: Run the memory test file — Test 12f now GREEN.**

```bash
cd /Users/theo/Projects/claude-extensions
npx vitest run scripts/__tests__/memory-customization-execution-scorers.test.mjs 2>&1 | tail -10
```

Expected: all memory tests pass (16+ tests), including Test 12f.

- [ ] **Step 4.3: Run the full vitest suite.**

```bash
cd /Users/theo/Projects/claude-extensions
npx vitest run 2>&1 | tail -10
```

Expected: 564+ tests pass; 0 failures. If any non-memory test fails, investigate — likely a fixture-snapshot or rubric-target test elsewhere needs the target update reflected. Common candidates: `rubric.test.mjs`, `assessment-snapshot.test.mjs`, `tracker-counts.test.mjs`.

- [ ] **Step 4.4: Commit.**

```bash
cd /Users/theo/Projects/claude-extensions
git add app/data/rubric.json
git commit -m "$(cat <<'EOF'
feat(rubric): lower Memory target 92 → 60 to match narrowed numerator — CCE-79

With the Execution numerator restricted to 2 commands (/clear + /compact)
instead of 4 (was: + /btw + /rewind), the realistic ceiling for
session-coverage drops. 60% represents mature usage of the narrowed set
("most interactive sessions have at least one /clear OR /compact").

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Docs surface updates (Components C, D, G)

### Task 5: Update methodology page narrative (Component C)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/app/methodology/page.tsx` lines 187–215 (the Memory `<li>` block)

- [ ] **Step 5.1: Re-read the current Memory `<li>` block.**

```bash
cd /Users/theo/Projects/claude-extensions
sed -n '187,215p' app/methodology/page.tsx
```

- [ ] **Step 5.2: Apply the narrative update via Edit.**

The current block enumerates `/btw`, `/clear`, `/compact`, `/rewind` and quotes the rubric target as 92. Replace those references with the new contract. Use this `new_string`:

```tsx
<li>
  <strong>Memory &amp; Context Management</strong> —{" "}
  <span className="mono">
    min(sum / interactiveOrUnknownSessionsAnalyzed, 1) × 100
  </span>
  , where <span className="mono">sum</span> is the inline MAX-merge of
  transcript and history counts for <span className="mono">/clear</span> and{" "}
  <span className="mono">/compact</span> (session-coverage hits — each command
  contributes at most once per session). These are posture commands, so the
  denominator must include the same session kinds the numerator is counted from.
  Rubric target is 60; the radar vertex displays{" "}
  <span className="mono">clamp(round(rawScore / 60 × 100))</span>. When{" "}
  <span className="mono">rawRatio &gt; 1</span> (multiple memory commands per
  session), the score saturates at 100 and the evidence string surfaces{" "}
  <em>&quot;capped from N%&quot;</em> so the over-coverage stays visible rather
  than being silently truncated. CCE-79 narrowed the numerator:{" "}
  <span className="mono">/btw</span> (cumulative all-time invocation count) now
  surfaces as cumulative evidence text rather than in the ratio, and{" "}
  <span className="mono">/rewind</span> (keyboard-shortcut signal, near-zero in
  transcripts) remains a binary next-action probe but not a ratio input.
  <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
    Universe: <span className="mono">interactive_cli ∪ unknown</span>. The
    numerator-subset-of-denominator hard rule applies: the counters come from
    the conservative allowPosture branch (interactive_cli plus
    unknown-classification sessions), so the denominator must include both —
    using <span className="mono">interactive_cli</span> alone would allow the
    ratio to exceed 100% from unknown-session contributions.
  </span>
</li>
```

(Use the existing `<li>` block as `old_string`. Anchor on the unique opening `<strong>Memory &amp; Context Management</strong>` line.)

- [ ] **Step 5.3: Build to confirm no TSX syntax error.**

```bash
cd /Users/theo/Projects/claude-extensions
npm run build 2>&1 | tail -20
```

Expected: build succeeds. If it fails, check the JSX entity escapes (e.g., `∪` rendered literally vs. as an entity).

- [ ] **Step 5.4: Commit.**

```bash
cd /Users/theo/Projects/claude-extensions
git add app/methodology/page.tsx
git commit -m "$(cat <<'EOF'
docs(methodology): reflect narrowed Memory ratio + target 60 — CCE-79

Replace the /btw,/clear,/compact,/rewind enumeration with /clear+/compact;
update the rubric-target callout from 92 to 60; add a sentence explaining
the per-field reclassification (/btw evidence-text, /rewind binary probe).
Universe and numerator-subset-of-denominator language preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 6: Verify dimension-explainer requires no edit (Component D)

**Files:**

- Verify only: `/Users/theo/Projects/claude-extensions/app/lib/dimension-explainer.ts` lines 82–92

- [ ] **Step 6.1: Read the memory block.**

```bash
cd /Users/theo/Projects/claude-extensions
sed -n '82,92p' app/lib/dimension-explainer.ts
```

Expected: the `formula` array lists only PLATFORM contributors (project memory files, claude-md-management plugin, CLAUDE.md exists, ≥10 saved plans). No mention of `/clear`, `/compact`, `/btw`, `/rewind`, execution ratio, or the rubric target.

- [ ] **Step 6.2: Confirm no edit needed.**

If the read confirms the file describes only the PLATFORM half (as expected), this task is a no-op verification. Note in the post-impl gate report that Component D was verified and required no edit. If the read surfaces an EXECUTION reference that was missed during spec authoring, edit it to match the new narrative — but do not invent reasons to edit.

### Task 7: Add CLAUDE.md hard rule for per-field semantic categorization (Component G)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/CLAUDE.md`

- [ ] **Step 7.1: Locate the CCE-78 hard rule.**

```bash
cd /Users/theo/Projects/claude-extensions
grep -n "Don't blend cumulative all-time counters" CLAUDE.md
```

Expected: a `## Hard rules` bullet starting with that phrase, currently citing CCE-78 and ending with the CCE-79 follow-up reference. The CCE-79 follow-up is described inline today; this task replaces that placeholder text with a concrete reference to the new design and adds a fresh bullet documenting the per-field categorization pattern as a standalone rule.

- [ ] **Step 7.2: Append a new bullet right after the CCE-78 rule.**

Use Edit to add the bullet. The exact anchor is the closing reference of the CCE-78 rule (the "**CCE-79**." sentence at the end of the bullet). Append immediately after the closing newline of that bullet, before the next `- **` bullet starts:

```md
- **Per-field semantic categorization before adding to any numerator.** When
  adding a new field to a ratio numerator (or summing multiple fields into
  one), classify each field on two independent axes BEFORE writing the
  `sum`:

  | Axis              | Possible classes                                              |
  | ----------------- | ------------------------------------------------------------- |
  | (a) Time window   | windowed (e.g., 30-day) / cumulative (lifetime)               |
  | (b) Counter class | session-coverage (deduped per session) / raw invocation count |

  If the new field's class on either axis differs from existing numerator
  inputs, it doesn't belong in the same `sum`. Route it to a separate
  surface: evidence text (cumulative), separate predicate (binary), or
  a separate ratio with a matched denominator (windowed-but-different-class).
  CCE-79 (PR TBD) is the reference case: the original Memory Execution
  numerator summed `/btw + /clear + /compact + /rewind` even though `/btw`
  was cumulative-all-time and `/rewind` was a near-zero binary signal —
  three classes in one sum. Redesign restricted the numerator to the two
  session-coverage signals (`/clear + /compact`), surfaced `/btw` as
  cumulative evidence text, kept `/rewind` only as a next-action probe,
  and recalibrated the rubric target 92 → 60 to match the narrowed
  realistic ceiling. Source: per-field table in
  `docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`
  §Context.
```

After PR merges, edit the `(PR TBD)` to `(PR #N)` in a follow-up commit on main (small docs commit, no separate ticket needed).

- [ ] **Step 7.3: Commit.**

```bash
cd /Users/theo/Projects/claude-extensions
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): add per-field semantic categorization hard rule — CCE-79

Two-axis (time window × counter class) categorization required before
any field enters a sum/ratio numerator. References CCE-79 redesign as
the worked example. Continues the CCE-78 lesson: detect class drift at
design time, not at scoring time.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Live baseline-vs-post verification

**Goal:** Per spec §Acceptance criterion 8, the PR body must include the empirical Memory executionScore delta from running the assessor before and after the redesign. The "before" baseline must come from a checkout of `main` (not the feature branch) so the comparison is apples-to-apples.

### Task 8: Capture the baseline assessment

- [ ] **Step 8.1: Stash any uncommitted changes (should be none after Phase 3).**

```bash
cd /Users/theo/Projects/claude-extensions
git status --short
```

Expected: clean working tree on `chore/CCE-79-memory-scorer-redesign` (untracked `.tmp/` and worktrees are fine).

- [ ] **Step 8.2: Snapshot the current branch head, switch to main, capture baseline.**

```bash
cd /Users/theo/Projects/claude-extensions
HEAD_SHA=$(git rev-parse HEAD)
echo "Feature head: $HEAD_SHA"
git checkout main
npm run assess:print --silent 2>&1 | tee /tmp/cce79-baseline.txt | tail -80
```

Expected: assessment runs successfully and prints to stdout + file. The Memory dimension's `executionScore` and `executionRawScore` are visible in the printed output.

If `npm run assess` fails on main, stop and investigate (could be transient — env, fixtures). Do NOT proceed to swap branches without a clean baseline.

- [ ] **Step 8.3: Switch back to the feature branch and capture post.**

```bash
cd /Users/theo/Projects/claude-extensions
git checkout chore/CCE-79-memory-scorer-redesign
npm run assess:print --silent 2>&1 | tee /tmp/cce79-post.txt | tail -80
```

Expected: same shape of output. Memory dim's `executionScore` should reflect the new formula (likely a noticeable change in either direction depending on the user's actual `/btw` and `/rewind` counts).

- [ ] **Step 8.4: Diff the Memory dimension blocks.**

```bash
grep -A 6 "memory" /tmp/cce79-baseline.txt | head -20
echo "---"
grep -A 6 "memory" /tmp/cce79-post.txt | head -20
```

Capture the before/after `executionScore`, `executionRawScore`, evidence text. These numbers go into the PR body.

---

## Phase 5 — Post-implementation 3-agent validation gate

**Goal:** Mirror the Phase 0 gate, but against the implemented diff. All three reviewers receive the diff + final test output + baseline-vs-post snapshot.

- [ ] **Step 5.1: Capture the diff to a file.**

```bash
cd /Users/theo/Projects/claude-extensions
git diff main...HEAD > /tmp/cce79-diff.patch
wc -l /tmp/cce79-diff.patch
```

- [ ] **Step 5.2: Dispatch lens 1 — spec compliance.**

> Read the spec at `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md` and the diff at `/tmp/cce79-diff.patch`. For each acceptance criterion (1 through 9 in §Acceptance criteria), determine whether the diff satisfies it; cite the file+line in the diff. Report any criterion that is missing or only partially implemented. Under 250 words.

- [ ] **Step 5.3: Dispatch lens 2 — code quality / over-build.**

> Read the diff at `/tmp/cce79-diff.patch`. Assess: (a) is the scorer change minimal — no abstractions/comments/error-handling beyond what the spec required? (b) any dead code (e.g., variables computed but unused)? (c) do the new test names clearly describe what they assert? (d) does the methodology page narrative match the actual scorer formula? Report concrete issues with file+line citations. Under 200 words.

- [ ] **Step 5.4: Dispatch lens 3 — regression hunt.**

> Read the diff at `/tmp/cce79-diff.patch` plus the baseline `/tmp/cce79-baseline.txt` and post `/tmp/cce79-post.txt`. Look for: (a) any test outside the memory file that should have been updated and wasn't (run `grep -rn "memory" /Users/theo/Projects/claude-extensions/scripts/__tests__` to ground), (b) any non-memory dimension's executionScore that changed unexpectedly between baseline and post (only memory should move), (c) any consumer of `signalsSummary.btwCommandUses` or `signalsSummary.rewindCommandUses` outside the memory scorer that the change might have orphaned. Report findings. Under 300 words.

- [ ] **Step 5.5: Address blocking concerns inline.**

If any reviewer surfaces a blocking gap (e.g., a missed test file, a non-memory dim score moved, an orphaned consumer), apply a fix commit on the feature branch before proceeding. If only observations, note them in the PR body's "Reviewer notes" section.

---

## Phase 6 — /ship

### Task 9: Run /ship with the standard stage chain

- [ ] **Step 9.1: Confirm working tree is clean and tests pass.**

```bash
cd /Users/theo/Projects/claude-extensions
git status --short
npx vitest run 2>&1 | tail -5
npm run lint 2>&1 | tail -10
npm run build 2>&1 | tail -10
```

Expected: clean tree, 564+ tests pass with 0 failures, lint clean, build clean.

- [ ] **Step 9.2: Invoke /ship.**

```
/ship
```

`/ship` runs Stage 0 (pre-flight including auto-mode classification on the branch) → Stage 1 (test) → Stage 2 (verify-agent) → Stage 3 (simplify) → Stage 4 (code-review) → Stage 5 (commit) → Stage 6 (push + PR open) → Stage 7 (Jira update).

- [ ] **Step 9.3: PR body.**

Use the `--body-file` form (the block-destructive scan flags heredocs containing forbidden substrings). Write the PR body to a temp file first:

```bash
cat > /tmp/cce79-pr-body.md <<'EOF'
## Summary

CCE-79: redesign the Memory Execution scorer so the ratio numerator only
contains semantically-consistent session-coverage signals (/clear + /compact);
surface /btw as cumulative evidence text via `signalsSummary.cliBtwUseCountAllTime`;
drop /rewind from the ratio while keeping its next-action probe; recalibrate
the rubric target 92 → 60.

Parent: CCE-78 (field-level /btw blend fix, PR #119).

## Components

- A — Scorer narrowed: `scripts/score.mjs::memory` numerator = `/clear + /compact`.
- B — Rubric target: `app/data/rubric.json` memory `target: 60` (was 92).
- C — Methodology page: narrative reflects narrowed numerator + new target.
- D — Dimension-explainer: verified — describes PLATFORM half only, no edit.
- E — Test fixtures: `signalsSummary.cliBtwUseCountAllTime` default added.
- F — 6 new + 5 updated test cases in `memory-customization-execution-scorers.test.mjs`.
- G — CLAUDE.md hard rule: per-field semantic categorization (two-axis).

## Baseline vs. post

| Field                                      | Baseline (main) | Post (this branch) |
| ------------------------------------------ | --------------- | ------------------ |
| Memory executionScore                      | TBD             | TBD                |
| Memory executionRawScore                   | TBD             | TBD                |
| Memory evidence (first line)               | TBD             | TBD                |
| Memory rubric target (rawTarget)           | 92              | 60                 |
| Other dimensions' executionScores (diff)   | n/a             | unchanged (verified)|

Fill TBDs from `/tmp/cce79-baseline.txt` and `/tmp/cce79-post.txt` captured
in Phase 4.

## Test plan

- [ ] `npx vitest run` — all 564+ tests pass
- [ ] `npm run lint` — clean
- [ ] `npm run build` — clean
- [ ] `npm run assess:print --no-slack` — Memory dim scores correctly with
      narrowed numerator
- [ ] CLAUDE.md hard rule renders cleanly (no broken table)

## Reviewer notes

[Insert post-impl gate findings if any]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Then in `/ship` Stage 6, the `gh pr create` will use `--body-file /tmp/cce79-pr-body.md`.

- [ ] **Step 9.4: Watch CI to green; squash-merge.**

```bash
cd /Users/theo/Projects/claude-extensions
gh pr checks --watch
gh pr merge --squash --delete-branch --auto
```

If `gh pr checks --watch` exits with "no checks reported" (no CI configured in CCSA), skip directly to `gh pr merge`. Confirm merge with:

```bash
gh pr view <PR#> --json state,mergeCommit
```

Expected: `MERGED` + commit SHA.

- [ ] **Step 9.5: Sync local main.**

```bash
cd /Users/theo/Projects/claude-extensions
git fetch --prune
git checkout main
git merge --ff-only origin/main
git branch -d chore/CCE-79-memory-scorer-redesign 2>/dev/null || true
```

---

## Phase 7 — Jira close-out

### Task 10: Transition CCE-79 to Done

**Authorization gate:** Per CLAUDE.md ("Auto-mode authorization for Jira writes is scoped per action, not per session"), pause and ask the user to authorize each Jira write below. Batch the two writes as a single approval request: "Authorize 1 comment + 1 transition on CCE-79?"

- [ ] **Step 10.1: Post close-out comment.**

```
addCommentToJiraIssue(issueIdOrKey: "CCE-79", commentBody: "Landed in PR #<N> (<merge SHA>). Memory Execution scorer numerator narrowed to /clear + /compact; /btw now surfaces as cumulative evidence text via signalsSummary.cliBtwUseCountAllTime; /rewind retained as binary next-action probe only. Rubric target recalibrated 92 → 60. Baseline-vs-post Memory executionScore delta: <X → Y>. Full per-field categorization rule added to CLAUDE.md as a follow-up to the CCE-78 cumulative-vs-windowed rule.")
```

- [ ] **Step 10.2: Transition to Done.**

```
transitionJiraIssue(issueIdOrKey: "CCE-79", transition: { id: "<Done transition ID>" })
```

If the Done transition ID isn't known, query first:

```
getTransitionsForJiraIssue(issueIdOrKey: "CCE-79")
```

---

## Self-review checklist (before dispatching Phase 0)

- [ ] Every Component A–G from the spec maps to at least one task here.
- [ ] No placeholders — every code step shows actual code, every command shows actual command + expected output.
- [ ] Test names in Phase 1 match the assertion they make.
- [ ] Files cited use absolute paths (Claude Code clickable-link convention).
- [ ] Per-action Jira authorization is called out explicitly in Phase 7.
- [ ] The /ship invocation uses `--body-file`, not a heredoc (block-destructive scan safety).
- [ ] The baseline-vs-post step is explicit and table-shaped (acceptance criterion 8).

---

## Risk surface (mirror of spec §Risk surface, with mitigations operationalized)

| Risk                                             | Mitigation in this plan                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Vertex score jumps for existing users overnight  | Phase 4 captures baseline-vs-post and the PR body table makes it visible.           |
| Users who relied on /btw to inflate Memory score | Spec §Risk surface acknowledges; methodology narrative (Task 5) explains the shift. |
| Downstream consumer of btwCommandUses breaks     | Phase 5 lens 3 (regression hunt) greps for orphaned consumers.                      |
| Rubric-target test elsewhere fails after 92→60   | Step 4.3 runs the full vitest suite explicitly; any failure surfaces before /ship.  |
| Methodology page TSX renders broken              | Step 5.3 runs `npm run build`; failure stops the chain before commit.               |

---

## Execution handoff

After this plan is reviewed in Phase 0 and corrections (if any) are committed, choose one:

1. **Subagent-Driven (recommended for this plan)** — one implementer subagent per task (Tasks 1–10), spec-compliance reviewer + code-quality reviewer between each. Fresh context per task; high quality.
2. **Inline batch** — execute Tasks 1–10 in the current session with the user as the human reviewer between phases.

For this plan, subagent-driven is the right shape: 10 tasks, each ≤30 minutes, most fully specified with code blocks.
