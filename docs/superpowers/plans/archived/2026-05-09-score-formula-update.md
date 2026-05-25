# Score-Formula Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `scripts/score.mjs` Platform-Setup formulas so the 12 new signals shipped in v0.7.0/v0.8.0 contribute to the per-dimension scores. After this lands, the Setup→Execution Δ shrinks because Setup scores accurately credit infrastructure that today goes uncredited.

**Architecture:** Each new signal slots into the existing `SCORERS.<dim>(s)` function for its dimension. Bonuses are additive on top of the existing base score; thresholds are kept conservative to prevent overcrediting. Gaps get matching evidence/gap entries so the dashboard explains the score change. Calibration is a single end-to-end snapshot diff: capture before/after Setup scores per dim, ensure no dim jumps more than +15 in one go (sanity bound).

**Tech Stack:** Node.js, vitest. Pure-function changes only.

**Branch:** `feat/score-formula-update` (worktree off main).

---

## Signal-to-dimension matrix (where each new signal lands)

| New signal               | Dimension                         | Bonus          | Rationale                                                                          |
| ------------------------ | --------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `mcpServersConnected`    | `integrations`                    | min(15, n × 3) | breadth of external tooling; same shape as existing plugin scoring                 |
| `hasClaudeInChrome`      | `integrations` and `verification` | +5 each        | Boris tip 51 lives in both rubric areas; double-counting tracks dual-action wiring |
| `hasRemoteControl`       | `remote`                          | +25            | iOS / cross-device flow is the dim's primary action                                |
| `shipVerifyStageRecent`  | `verification`                    | +10 if ≥1      | indicates a real /ship verify-agent run in lookback                                |
| `goCommandUses`          | `verification`                    | +5 if ≥3       | reflex adoption (Boris tip 73)                                                     |
| `batchCommandUses`       | `parallel`                        | +10 if ≥1      | mid-sentence /batch usage = active sweep prompt phrasing (Boris tip 30)            |
| `worktreeAliasCount`     | `parallel`                        | +8 if ≥3       | personal ergonomics for worktree switching                                         |
| `focusCommandUses`       | `customization`                   | +5 if ≥1       | /focus is a customization signal                                                   |
| `babysitLoopUses`        | `scheduled`                       | +15 if ≥1      | direct evidence of loop adoption                                                   |
| `scheduleCommandUses`    | `scheduled`                       | +10 if ≥1      | direct evidence of scheduled-routine adoption                                      |
| `planThenLaunchSessions` | `planning`                        | +5 if ≥1       | replaces the existing behavioral-only gap text                                     |
| `shipsRecent`            | `automation`                      | +5 if ≥1       | /ship adoption is automation-codification                                          |

Calibration cap: any single dim's Setup score may not move more than +15 points after this PR. Verified by Task 8 (snapshot diff).

---

## File Structure

| File                               | Change                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/score.mjs`                | Update 7 SCORERS (`integrations`, `verification`, `remote`, `parallel`, `customization`, `scheduled`, `planning`, `automation`) with new bonuses |
| `scripts/__tests__/score.test.mjs` | New tests covering each new bonus path; existing tests must continue to pass                                                                     |
| `scripts/__tests__/_fixtures.mjs`  | Extend `makeSignals` to include the new flat signals (forwarded shape from `buildSignalsSummary`)                                                |

---

## Task 1: Read existing score.mjs SCORERS and confirm baseline

**Files:**

- Read: `scripts/score.mjs` lines 14–248
- Read: `scripts/__tests__/score.test.mjs` (existing test patterns)
- Read: `scripts/__tests__/_fixtures.mjs` (existing fixture shape)

- [ ] **Step 1: Baseline assessment**

Run:

```bash
npm run assess -- --insights-lookback 14 2>&1 | head -20 > /tmp/score-before.txt
cat /tmp/score-before.txt
```

Expected: 12 dimension lines like `78 / 100  →  Automation — Hooks, Commands, Agents (raw 70/90)`. Save this file — Task 8 diffs against it.

- [ ] **Step 2: Confirm signals reach `SCORERS`**

In `scripts/score.mjs`, the `SCORERS.<dim>(s)` functions take a `signals` object `s`. Confirm the new keys are present on `s` by adding a one-liner sanity log to one scorer (don't commit — just confirm):

```js
console.error(
  "DEBUG signals:",
  Object.keys(s).filter(
    (k) =>
      k.includes("Command") || k.includes("ship") || k.includes("worktree"),
  ),
);
```

Verify keys like `goCommandUses`, `batchCommandUses`, `worktreeAliasCount`, `shipVerifyStageRecent` appear. If not, the wiring from `buildSignalsSummary` to `SCORERS` is broken — investigate before continuing.

Remove the debug log.

---

## Task 2: Extend `_fixtures.mjs` makeSignals with new flat signals

**Files:**

- Modify: `scripts/__tests__/_fixtures.mjs` (`makeSignals` function)

- [ ] **Step 1: Add new keys with falsy defaults**

In `scripts/__tests__/_fixtures.mjs`, find the `makeSignals` function. Add the 12 new flat signals with safe defaults (so existing tests continue to assert against pre-bonus values):

```js
function makeSignals(overrides = {}) {
  return {
    // ...existing fields...
    hasClaudeInChrome: false,
    hasRemoteControl: false,
    mcpServersConnected: 0,
    hasMcpServers: false,
    shipVerifyStageRecent: 0,
    shipsRecent: 0,
    goCommandUses: 0,
    batchCommandUses: 0,
    focusCommandUses: 0,
    scheduleCommandUses: 0,
    babysitLoopUses: 0,
    planThenLaunchSessions: 0,
    worktreeAliasCount: 0,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run existing test suite to confirm no regressions**

```bash
npx vitest run scripts/__tests__/score.test.mjs
```

Expected: PASS — existing tests still hold because new fields default to falsy.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/_fixtures.mjs
git commit -m "test(self-assessment): extend makeSignals fixture with v0.7/v0.8 signals"
```

---

## Task 3: `integrations` scorer — credit `mcpServersConnected` and `hasClaudeInChrome`

**Files:**

- Modify: `scripts/score.mjs` (`SCORERS.integrations`, lines ~189–201)
- Modify: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Write failing tests**

Add to `scripts/__tests__/score.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { SCORERS } from "../score.mjs";
import { makeSignals } from "./_fixtures.mjs";

describe("SCORERS.integrations — v0.8 bonuses", () => {
  it("adds bonus for mcpServersConnected (capped at +15)", () => {
    const baseline = SCORERS.integrations(makeSignals()).score;
    const oneMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 1 }),
    ).score;
    const fiveMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 5 }),
    ).score;
    const tenMcp = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 10 }),
    ).score;
    expect(oneMcp).toBe(Math.min(100, baseline + 3));
    expect(fiveMcp).toBe(Math.min(100, baseline + 15));
    expect(tenMcp).toBe(Math.min(100, baseline + 15)); // capped
  });

  it("adds +5 for hasClaudeInChrome", () => {
    const baseline = SCORERS.integrations(makeSignals()).score;
    const withChrome = SCORERS.integrations(
      makeSignals({ hasClaudeInChrome: true }),
    ).score;
    expect(withChrome).toBe(Math.min(100, baseline + 5));
  });

  it("evidence reflects new credits", () => {
    const r = SCORERS.integrations(
      makeSignals({ mcpServersConnected: 3, hasClaudeInChrome: true }),
    );
    expect(r.evidence.some((e) => e.includes("MCP server"))).toBe(true);
    expect(r.evidence.some((e) => e.includes("Claude in Chrome"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "v0.8 bonuses"
```

Expected: FAIL.

- [ ] **Step 3: Update integrations scorer**

In `scripts/score.mjs`, in `SCORERS.integrations`, add inside the function body before the `return`:

```js
if (s.mcpServersConnected > 0) {
  const mcpBonus = Math.min(15, s.mcpServersConnected * 3);
  score += mcpBonus;
  ev.push(`${s.mcpServersConnected} connected MCP server(s)`);
}
if (s.hasClaudeInChrome) {
  score += 5;
  ev.push("Claude in Chrome integration enabled");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "v0.8 bonuses"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): credit mcpServersConnected and hasClaudeInChrome in integrations"
```

---

## Task 4: `verification` scorer — credit `hasClaudeInChrome`, `shipVerifyStageRecent`, `goCommandUses`

**Files:**

- Modify: `scripts/score.mjs` (`SCORERS.verification`, lines ~144–157)
- Modify: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
describe("SCORERS.verification — v0.8 bonuses", () => {
  it("adds +5 for hasClaudeInChrome", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const withChrome = SCORERS.verification(
      makeSignals({ hasClaudeInChrome: true }),
    ).score;
    expect(withChrome).toBe(Math.min(100, baseline + 5));
  });

  it("adds +10 when shipVerifyStageRecent >= 1", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const oneShip = SCORERS.verification(
      makeSignals({ shipVerifyStageRecent: 1 }),
    ).score;
    const fiveShip = SCORERS.verification(
      makeSignals({ shipVerifyStageRecent: 5 }),
    ).score;
    expect(oneShip).toBe(Math.min(100, baseline + 10));
    expect(fiveShip).toBe(Math.min(100, baseline + 10)); // not stacking
  });

  it("adds +5 when goCommandUses >= 3 (reflex adoption)", () => {
    const baseline = SCORERS.verification(makeSignals()).score;
    const oneGo = SCORERS.verification(makeSignals({ goCommandUses: 1 })).score;
    const threeGo = SCORERS.verification(
      makeSignals({ goCommandUses: 3 }),
    ).score;
    expect(oneGo).toBe(baseline); // below threshold
    expect(threeGo).toBe(Math.min(100, baseline + 5));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "verification — v0.8"
```

Expected: FAIL.

- [ ] **Step 3: Update verification scorer**

In `scripts/score.mjs`, in `SCORERS.verification`, add before the `return`:

```js
if (s.hasClaudeInChrome) {
  score += 5;
  ev.push("Claude in Chrome — frontend verification reach");
}
if (s.shipVerifyStageRecent >= 1) {
  score += 10;
  ev.push(`/ship verify-agent fired ${s.shipVerifyStageRecent}× recently`);
}
if (s.goCommandUses >= 3) {
  score += 5;
  ev.push(`/go reflex adopted (${s.goCommandUses} uses)`);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "verification — v0.8"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): credit Chrome + /ship verify + /go reflex in verification"
```

---

## Task 5: `parallel` scorer — credit `worktreeAliasCount` and `batchCommandUses`

**Files:**

- Modify: `scripts/score.mjs` (`SCORERS.parallel`, lines ~118–142)
- Modify: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
describe("SCORERS.parallel — v0.8 bonuses", () => {
  it("adds +8 when worktreeAliasCount >= 3", () => {
    const baseline = SCORERS.parallel(makeSignals()).score;
    const twoAliases = SCORERS.parallel(
      makeSignals({ worktreeAliasCount: 2 }),
    ).score;
    const threeAliases = SCORERS.parallel(
      makeSignals({ worktreeAliasCount: 3 }),
    ).score;
    expect(twoAliases).toBe(baseline);
    expect(threeAliases).toBe(Math.min(100, baseline + 8));
  });

  it("adds +10 when batchCommandUses >= 1", () => {
    const baseline = SCORERS.parallel(makeSignals()).score;
    const withBatch = SCORERS.parallel(
      makeSignals({ batchCommandUses: 1 }),
    ).score;
    expect(withBatch).toBe(Math.min(100, baseline + 10));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "parallel — v0.8"
```

Expected: FAIL.

- [ ] **Step 3: Update parallel scorer**

In `scripts/score.mjs`, in `SCORERS.parallel`, add before the `return`:

```js
if (s.worktreeAliasCount >= 3) {
  score += 8;
  ev.push(`${s.worktreeAliasCount} worktree alias(es) (za/zb/zc) configured`);
}
if (s.batchCommandUses >= 1) {
  score += 10;
  ev.push(`/batch prompt phrasing adopted (${s.batchCommandUses} uses)`);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "parallel — v0.8"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): credit worktree aliases and /batch usage in parallel"
```

---

## Task 6: `scheduled`, `customization`, `planning`, `automation`, `remote` — small additive bonuses

**Files:**

- Modify: `scripts/score.mjs` (5 SCORERS)
- Modify: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Write failing tests for all 5 dims**

```js
describe("SCORERS — v0.8 small bonuses across remaining dims", () => {
  it("scheduled: +15 for babysitLoopUses, +10 for scheduleCommandUses", () => {
    const baseline = SCORERS.scheduled(makeSignals()).score;
    expect(SCORERS.scheduled(makeSignals({ babysitLoopUses: 1 })).score).toBe(
      Math.min(100, baseline + 15),
    );
    expect(
      SCORERS.scheduled(makeSignals({ scheduleCommandUses: 1 })).score,
    ).toBe(Math.min(100, baseline + 10));
  });

  it("customization: +5 for focusCommandUses >= 1", () => {
    const baseline = SCORERS.customization(makeSignals()).score;
    expect(
      SCORERS.customization(makeSignals({ focusCommandUses: 1 })).score,
    ).toBe(Math.min(100, baseline + 5));
  });

  it("planning: +5 for planThenLaunchSessions >= 1", () => {
    const baseline = SCORERS.planning(makeSignals()).score;
    expect(
      SCORERS.planning(makeSignals({ planThenLaunchSessions: 1 })).score,
    ).toBe(Math.min(100, baseline + 5));
  });

  it("automation: +5 for shipsRecent >= 1", () => {
    const baseline = SCORERS.automation(makeSignals()).score;
    expect(SCORERS.automation(makeSignals({ shipsRecent: 1 })).score).toBe(
      Math.min(100, baseline + 5),
    );
  });

  it("remote: +25 for hasRemoteControl", () => {
    const baseline = SCORERS.remote(makeSignals()).score;
    expect(SCORERS.remote(makeSignals({ hasRemoteControl: true })).score).toBe(
      Math.min(100, baseline + 25),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "small bonuses"
```

Expected: FAIL.

- [ ] **Step 3: Update each scorer**

In `scripts/score.mjs`:

`SCORERS.scheduled` — add before return:

```js
if (s.babysitLoopUses >= 1) {
  score += 15;
  ev.push(`/loop /babysit pattern adopted (${s.babysitLoopUses} session(s))`);
}
if (s.scheduleCommandUses >= 1) {
  score += 10;
  ev.push(`/schedule routine adopted (${s.scheduleCommandUses} use(s))`);
}
```

`SCORERS.customization` — add before return:

```js
if (s.focusCommandUses >= 1) {
  score += 5;
  ev.push(`/focus adopted (${s.focusCommandUses} use(s))`);
}
```

`SCORERS.planning` — add before return:

```js
if (s.planThenLaunchSessions >= 1) {
  score += 5;
  ev.push(
    `Plan-then-launch discipline detected (${s.planThenLaunchSessions} session(s))`,
  );
}
```

`SCORERS.automation` — add before return:

```js
if (s.shipsRecent >= 1) {
  score += 5;
  ev.push(`${s.shipsRecent} /ship run(s) recently`);
}
```

`SCORERS.remote` — add before return:

```js
if (s.hasRemoteControl) {
  score += 25;
  ev.push("Remote Control opted in (Boris tip 47)");
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run scripts/__tests__/score.test.mjs -t "small bonuses"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): credit v0.8 signals across scheduled/customization/planning/automation/remote"
```

---

## Task 7: Run full test suite

**Files:** none — verification only.

- [ ] **Step 1: Full vitest run**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: PASS — all suites green. If anything fails, the most likely cause is an existing test that asserted a baseline score for a fixture that now picks up a bonus. Check fixtures: existing tests should use `makeSignals()` with default falsy bonuses, so they should be unaffected. If a test fails, INSPECT the failing assertion before changing fixtures — fix the test if it's asserting against the new behavior, not by weakening the new code.

---

## Task 8: Calibration check — before/after assessment diff

**Files:** none — verification only.

- [ ] **Step 1: After-assessment**

```bash
npm run assess -- --insights-lookback 14 2>&1 | head -20 > /tmp/score-after.txt
diff /tmp/score-before.txt /tmp/score-after.txt
```

- [ ] **Step 2: Inspect deltas**

For each of the 12 dimensions, expected behavior:

- **Increases** are expected on `integrations`, `verification`, `parallel`, `scheduled`, `customization`, `planning`, `automation`, `remote` for the user (whose signals fire).
- **No change** on `permissions`, `model-effort`, `memory`, `learning` (no new signals affect these).
- **Cap check:** no single dim's Setup score may move more than +15 points. If any does, re-tune the bonus weights in the relevant task and re-run.

Document deltas in the PR body.

- [ ] **Step 3: Setup→Execution Δ check**

Compare `Platform Setup` and `Execution` lines:

```bash
grep -E "Platform Setup|Execution" /tmp/score-before.txt /tmp/score-after.txt
```

Expected: Setup score increases (5–10 points typical for the user's environment); Execution unchanged. Δ shrinks.

- [ ] **Step 4: No commit needed** — verification only.

---

## Self-Review

**1. Spec coverage:**

- All 12 new signals are credited in at least one scorer (matrix at top of plan ✓)
- Each new bonus is testable and tested (Tasks 3-6 cover one dim per task ✓)
- Calibration step bounds the per-dim score change (Task 8 ✓)

**2. Placeholder scan:**

- No "TBD", no "implement later", no "similar to Task N" — every code block is concrete.
- Each task has full test code, full implementation snippet, exact commands.

**3. Type consistency:**

- All new keys (`mcpServersConnected`, `hasClaudeInChrome`, etc.) match `buildSignalsSummary` output exactly (verified in Task 1 Step 2 — debug log).
- Bonus values consistent across plan tasks and matrix table.
- Threshold values consistent: `goCommandUses>=3`, `worktreeAliasCount>=3`, all others `>=1`.

## Out of scope

- **Execution-side scorers** in `EXECUTION_SCORERS` (lines 317+). Those depend on insights JSON; v0.7/v0.8 signals are platform-side, not execution-side. Different PR.
- **Rubric `target` re-tuning.** This PR only adjusts bonus deltas. If the new bonuses push real-world scores past existing dim targets, that's a separate calibration question for a follow-up.
- **`memory`, `permissions`, `model-effort`, `learning` dims** — no new signals affect these.
