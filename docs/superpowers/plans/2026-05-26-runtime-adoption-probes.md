# Runtime-Adoption Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument 4 previously-untracked Boris tips (50 Cowork Dispatch, 27 Customize Everything, 74 4.6→4.7 Shifts, 39 Auto Session Naming) plus stronger signals for already-tracked behaviors (33 `btw`, planning, learning) by mining `~/.claude.json` adoption flags, splitting signals across the two axes per Approach C.

**Architecture:** Extend the existing `gatherSignals` cliConfig-detector seam in `scripts/signals.mjs` (NOT a new module — `~/.claude.json` is already loaded there). New behavioral flags project through `buildSignalsSummary` into the flat `signalsSummary` map. A new `adoptionBonus()` helper in `scripts/score.mjs` produces capped, labelled credit that composes _into_ the existing `withGates` Execution scorers (parallel, model-effort, automation, planning, learning). tip 27 strengthens the Platform `SCORERS.customization` breadth. tip 39 is a non-scored info signal. The probes page gains a `runtime` source with a new `A` (adoption) axis badge; the tracker + README are updated in the same change and shipped together.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Next.js 16 server component (probes page TSX), JSON data files.

**Spec:** `docs/superpowers/specs/2026-05-26-runtime-adoption-probes-design.md`

---

## File Structure

| File                                                               | Responsibility                   | Change                                                                                               |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scripts/signals.mjs`                                              | filesystem/cliConfig capture     | Add 4 `detect*` helpers; wire into `gatherSignals` settings return                                   |
| `scripts/run-assessment.mjs`                                       | `buildSignalsSummary` projection | Add new keys; strengthen `btwCommandUses` via MAX with `cliConfig.btwUseCount`                       |
| `scripts/score.mjs`                                                | scoring                          | Add `adoptionBonus()` helper; compose into 5 Execution scorers; tip 27 into Platform `customization` |
| `scripts/_usage-data.mjs`                                          | transcript scan                  | (tip 39) detect `ai-title` entry → `aiTitlePresent`                                                  |
| `scripts/__tests__/_fixtures.mjs`                                  | test fixtures                    | Add new signal fields to `makeSignals`                                                               |
| `app/data/rubric.json`                                             | rubric                           | Add 2 `satisfiedWhen` next-actions (cowork, opus47)                                                  |
| `app/data/probe-catalog.json`                                      | probe metadata                   | Add `runtime` source + 2 entries                                                                     |
| `app/methodology/probes/page.tsx`                                  | probes UI                        | Add `runtime` source, `A` axis badge + legend                                                        |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | tracker                          | Part 1 runtime layer; Part 2 tip flips + tally; re-derive 5 header counts                            |
| `README.md`                                                        | docs                             | Update "Probe coverage" section                                                                      |

**New signalsSummary keys:** `coworkDispatchAdopted` (bool), `opus47AwarenessAdopted` (bool), `planModeRecencyDays` (number|null), `skillsUsedRecently` (number), `aiTitlePresent` (bool). `btwCommandUses` gets a stronger source (no new key).

---

## Task 1: cliConfig adoption detectors in `scripts/signals.mjs`

**Files:**

- Modify: `scripts/signals.mjs` (add helpers near `detectTerminalSetup`, ~line 186; wire into `gatherSignals` settings return, ~line 762)
- Test: `scripts/__tests__/signals.test.mjs` (existing file — add a `describe` block)

- [ ] **Step 1: Write failing tests for the detectors**

Add to `scripts/__tests__/signals.test.mjs` (import the new names alongside existing imports from `../signals.mjs`):

```js
import {
  detectCoworkDispatch,
  detectOpus47Awareness,
  detectBtwUseCount,
  detectPlanModeRecencyDays,
  detectSkillsUsedRecently,
} from "../signals.mjs";

describe("cliConfig adoption detectors", () => {
  const NOW = Date.parse("2026-05-26T00:00:00.000Z");

  it("detectCoworkDispatch reads hasUsedAgentsFleet", () => {
    expect(detectCoworkDispatch({ hasUsedAgentsFleet: true })).toBe(true);
    expect(detectCoworkDispatch({ hasUsedAgentsFleet: false })).toBe(false);
    expect(detectCoworkDispatch({})).toBe(false);
    expect(detectCoworkDispatch(null)).toBe(false);
  });

  it("detectOpus47Awareness is true when release notes or launch seen", () => {
    expect(detectOpus47Awareness({ opus47LaunchSeenCount: 12 })).toBe(true);
    expect(detectOpus47Awareness({ unpinOpus47LaunchEffort: true })).toBe(true);
    expect(detectOpus47Awareness({ lastReleaseNotesSeen: "2.1.150" })).toBe(
      true,
    );
    expect(detectOpus47Awareness({})).toBe(false);
    expect(detectOpus47Awareness(null)).toBe(false);
  });

  it("detectBtwUseCount reads the counter, defaults 0", () => {
    expect(detectBtwUseCount({ btwUseCount: 36 })).toBe(36);
    expect(detectBtwUseCount({})).toBe(0);
    expect(detectBtwUseCount(null)).toBe(0);
  });

  it("detectPlanModeRecencyDays returns whole days since lastPlanModeUse", () => {
    const ts = "2026-05-23T00:00:00.000Z"; // 3 days before NOW
    expect(detectPlanModeRecencyDays({ lastPlanModeUse: ts }, NOW)).toBe(3);
    expect(detectPlanModeRecencyDays({}, NOW)).toBeNull();
    expect(detectPlanModeRecencyDays(null, NOW)).toBeNull();
  });

  it("detectSkillsUsedRecently counts skills used within 30 days", () => {
    const cfg = {
      skillUsage: {
        a: { lastUsedAt: "2026-05-20T00:00:00.000Z" }, // 6 days
        b: { lastUsedAt: "2026-03-01T00:00:00.000Z" }, // >30 days
        c: { lastUsedAt: "2026-05-25T00:00:00.000Z" }, // 1 day
      },
    };
    expect(detectSkillsUsedRecently(cfg, NOW)).toBe(2);
    expect(detectSkillsUsedRecently({}, NOW)).toBe(0);
    expect(detectSkillsUsedRecently(null, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/__tests__/signals.test.mjs -t "cliConfig adoption detectors"`
Expected: FAIL — `detectCoworkDispatch is not a function` (not yet exported).

- [ ] **Step 3: Implement the detectors**

Add to `scripts/signals.mjs` immediately after `detectTerminalSetup` (~line 195). These mirror the existing `detectRemoteControl` pattern (all take the parsed `cliConfig` object, tolerate `null`):

```js
// Boris tip 50: cowork / agents-fleet dispatch. ~/.claude.json#hasUsedAgentsFleet
// is a durable "has used" adoption flag (same shape as hasUsedRemoteControl).
export function detectCoworkDispatch(cliConfig) {
  return cliConfig?.hasUsedAgentsFleet === true;
}

// Boris tip 74: awareness of the 4.6→4.7 shift. Proxy — engagement with the
// release-notes / Opus-4.7-launch surfaces, not behavioral mastery.
export function detectOpus47Awareness(cliConfig) {
  if (!cliConfig) return false;
  return (
    (typeof cliConfig.opus47LaunchSeenCount === "number" &&
      cliConfig.opus47LaunchSeenCount > 0) ||
    cliConfig.unpinOpus47LaunchEffort === true ||
    (typeof cliConfig.lastReleaseNotesSeen === "string" &&
      cliConfig.lastReleaseNotesSeen.length > 0)
  );
}

// Boris tip 33: /btw side-channel. ~/.claude.json#btwUseCount is a stronger
// counter than the history.jsonl scan (MAX-merged in buildSignalsSummary).
export function detectBtwUseCount(cliConfig) {
  const n = cliConfig?.btwUseCount;
  return typeof n === "number" && n > 0 ? n : 0;
}

// Whole days since the last plan-mode use, or null if never. Corroborates the
// transcript-derived plan-mode ratio (planning dimension).
export function detectPlanModeRecencyDays(cliConfig, nowMs = Date.now()) {
  const ts = cliConfig?.lastPlanModeUse;
  if (typeof ts !== "string") return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}

// Count of skills whose lastUsedAt is within the project's 30-day window.
// Corroborates the explanatory-mode learning scorer.
const SKILL_RECENCY_DAYS = 30;
export function detectSkillsUsedRecently(cliConfig, nowMs = Date.now()) {
  const usage = cliConfig?.skillUsage;
  if (!usage || typeof usage !== "object") return 0;
  let n = 0;
  for (const entry of Object.values(usage)) {
    const t = Date.parse(entry?.lastUsedAt ?? "");
    if (Number.isFinite(t) && (nowMs - t) / 86_400_000 <= SKILL_RECENCY_DAYS)
      n++;
  }
  return n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/signals.test.mjs -t "cliConfig adoption detectors"`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire detectors into `gatherSignals`**

In `scripts/signals.mjs`, the `cliConfig` is already parsed (~line 601). Read the existing `settings`-object return literal (around lines 760–765 where `hasClaudeInChrome, hasRemoteControl, hasTerminalSetup` are added) and add these alongside them, computing once near the other cliConfig detectors (~line 602):

```js
// near line 602, with the other cliConfig detectors:
const coworkDispatchAdopted = detectCoworkDispatch(cliConfig);
const opus47AwarenessAdopted = detectOpus47Awareness(cliConfig);
const cliBtwUseCount = detectBtwUseCount(cliConfig);
const planModeRecencyDays = detectPlanModeRecencyDays(cliConfig);
const skillsUsedRecently = detectSkillsUsedRecently(cliConfig);
```

Then in the returned `settings` object literal, alongside `hasClaudeInChrome, hasRemoteControl, hasTerminalSetup,`:

```js
      coworkDispatchAdopted,
      opus47AwarenessAdopted,
      cliBtwUseCount,
      planModeRecencyDays,
      skillsUsedRecently,
```

- [ ] **Step 6: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/signals.test.mjs
git commit -m "feat(signals): cliConfig adoption detectors for tips 50/74/33/planning/learning"
```

---

## Task 2: Project new signals through `buildSignalsSummary`

**Files:**

- Modify: `scripts/run-assessment.mjs:55` (`buildSignalsSummary`)
- Test: `scripts/__tests__/run-assessment.test.mjs` (existing) or `scripts/__tests__/signals-summary.test.mjs` if present — add cases

- [ ] **Step 1: Write failing test**

Add a test that builds a signals object with the new `settings` fields and asserts the projection. Use the existing test file that imports `buildSignalsSummary`; if none, create `scripts/__tests__/signals-summary.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { buildSignalsSummary } from "../run-assessment.mjs";
import { makeSignals } from "./_fixtures.mjs";

describe("buildSignalsSummary — runtime adoption", () => {
  it("projects the new adoption flags", () => {
    const s = makeSignals({
      settings: {
        coworkDispatchAdopted: true,
        opus47AwarenessAdopted: true,
        cliBtwUseCount: 36,
        planModeRecencyDays: 3,
        skillsUsedRecently: 2,
      },
    });
    const out = buildSignalsSummary(s);
    expect(out.coworkDispatchAdopted).toBe(true);
    expect(out.opus47AwarenessAdopted).toBe(true);
    expect(out.planModeRecencyDays).toBe(3);
    expect(out.skillsUsedRecently).toBe(2);
  });

  it("btwCommandUses takes MAX of history and cliConfig counter", () => {
    const s = makeSignals({
      historyInvocations: { btwCommandUses: 5 },
      settings: { cliBtwUseCount: 36 },
    });
    expect(buildSignalsSummary(s).btwCommandUses).toBe(36);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/signals-summary.test.mjs`
Expected: FAIL — `out.coworkDispatchAdopted` is `undefined`.

- [ ] **Step 3: Add the projections**

In `buildSignalsSummary` (`scripts/run-assessment.mjs`), add to the returned object (near the other `settings`-derived booleans, e.g. after `hasRemoteControl` line 89):

```js
    coworkDispatchAdopted: !!signals.settings.coworkDispatchAdopted,
    opus47AwarenessAdopted: !!signals.settings.opus47AwarenessAdopted,
    planModeRecencyDays: signals.settings.planModeRecencyDays ?? null,
    skillsUsedRecently: signals.settings.skillsUsedRecently ?? 0,
```

And strengthen the existing `btwCommandUses` projection — find its current line and replace with a MAX over history and the cliConfig counter:

```js
    btwCommandUses: Math.max(
      maxProbe(signals, "btwCommandUses"),
      signals.settings.cliBtwUseCount ?? 0,
    ),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/signals-summary.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-assessment.mjs scripts/__tests__/signals-summary.test.mjs
git commit -m "feat(signals): project runtime-adoption flags through buildSignalsSummary"
```

---

## Task 3: `adoptionBonus()` helper in `scripts/score.mjs`

**Files:**

- Modify: `scripts/score.mjs` (add helper after `pct()`, ~line 533)
- Test: `scripts/__tests__/score.test.mjs` (existing) — add a `describe`

- [ ] **Step 1: Write failing test**

```js
import { adoptionBonus } from "../score.mjs"; // add to existing imports

describe("adoptionBonus", () => {
  it("boolean: full cap when on, zero when off", () => {
    expect(adoptionBonus({ on: true, kind: "boolean", cap: 15 }).points).toBe(
      15,
    );
    expect(adoptionBonus({ on: false, kind: "boolean", cap: 15 }).points).toBe(
      0,
    );
  });
  it("counter: scales to cap, never exceeds", () => {
    expect(
      adoptionBonus({ value: 0, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(0);
    expect(
      adoptionBonus({ value: 5, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(10);
    expect(
      adoptionBonus({ value: 50, kind: "counter", cap: 10, target: 5 }).points,
    ).toBe(10);
  });
  it("recency: full cap when recent, decays to 0 past window", () => {
    expect(
      adoptionBonus({ days: 0, kind: "recency", cap: 10, window: 30 }).points,
    ).toBe(10);
    expect(
      adoptionBonus({ days: 30, kind: "recency", cap: 10, window: 30 }).points,
    ).toBe(0);
    expect(
      adoptionBonus({ days: null, kind: "recency", cap: 10, window: 30 })
        .points,
    ).toBe(0);
  });
  it("emits evidence when credited, gap when not", () => {
    const hit = adoptionBonus({
      on: true,
      kind: "boolean",
      cap: 15,
      evidenceText: "E",
      gapText: "G",
    });
    expect(hit.evidence).toBe("E");
    expect(hit.gap).toBeNull();
    const miss = adoptionBonus({
      on: false,
      kind: "boolean",
      cap: 15,
      evidenceText: "E",
      gapText: "G",
    });
    expect(miss.evidence).toBeNull();
    expect(miss.gap).toBe("G");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "adoptionBonus"`
Expected: FAIL — `adoptionBonus is not a function`.

- [ ] **Step 3: Implement the helper**

Add to `scripts/score.mjs` after `pct()` (~line 533). Export it:

```js
// Capped adoption credit — a third scorer-contribution shape alongside the
// withGates ratio scorers. NOT gated by a session denominator: these signals
// are global booleans / counters / recency from ~/.claude.json, not per-session
// rates. `cap` bounds the contribution so one ever-used flag can't dominate a
// dimension. `label` ("behavioral" | "awareness" | "proxy") is carried for
// honest rendering. Returns { points, evidence, gap, label }.
export function adoptionBonus({
  kind,
  cap,
  on,
  value,
  days,
  window,
  target,
  label = "behavioral",
  evidenceText = null,
  gapText = null,
}) {
  let frac;
  if (kind === "boolean") frac = on ? 1 : 0;
  else if (kind === "counter")
    frac = target > 0 ? Math.min(value / target, 1) : 0;
  else if (kind === "recency")
    frac =
      typeof days === "number" && window > 0
        ? Math.max(0, 1 - days / window)
        : 0;
  else throw new Error(`adoptionBonus: unknown kind ${kind}`);
  const points = Math.round(cap * frac);
  return {
    points,
    label,
    evidence: points > 0 ? evidenceText : null,
    gap: points > 0 ? null : gapText,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "adoptionBonus"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): adoptionBonus() capped-credit helper"
```

---

## Task 4: Compose adoption credit into the `parallel` Execution scorer (tip 50)

**Files:**

- Modify: `scripts/score.mjs` `EXECUTION_SCORERS.parallel` (~line 653)
- Test: `scripts/__tests__/score.test.mjs` — add cases

- [ ] **Step 1: Write failing test**

```js
import { EXECUTION_SCORERS } from "../score.mjs";
import { makeSignals, makeInsights } from "./_fixtures.mjs";

describe("parallel execution — cowork adoption credit (tip 50)", () => {
  it("adds capped credit when cowork dispatch adopted", () => {
    const base = makeSignals({
      insights: makeInsights({
        subagentSessionCount: 0,
        transcriptsScanned: true,
      }),
    });
    const withCowork = makeSignals({
      settings: { coworkDispatchAdopted: true },
      insights: makeInsights({
        subagentSessionCount: 0,
        transcriptsScanned: true,
      }),
    });
    const a = EXECUTION_SCORERS.parallel(base).score;
    const b = EXECUTION_SCORERS.parallel(withCowork).score;
    expect(b).toBeGreaterThan(a);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "cowork adoption"`
Expected: FAIL — scores equal (credit not wired).

- [ ] **Step 3: Compose the bonus into the scorer body**

In `EXECUTION_SCORERS.parallel`, just before the final `return { score: clamp(Math.round(score)), ... }` (~line 677):

```js
const cowork = adoptionBonus({
  kind: "boolean",
  cap: 15,
  on: !!s.settings?.coworkDispatchAdopted,
  label: "behavioral",
  evidenceText:
    "Cowork / agents-fleet dispatch adopted (~/.claude.json hasUsedAgentsFleet) — Boris tip 50",
  gapText: "Never dispatched a cowork / agents-fleet run — Boris tip 50",
});
score += cowork.points;
if (cowork.evidence) evidence.push(cowork.evidence);
if (cowork.gap) gaps.push(cowork.gap);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "cowork adoption"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): cowork-dispatch adoption credit in parallel scorer (tip 50)"
```

---

## Task 5: Compose adoption credit into model-effort / automation / planning / learning

**Files:**

- Modify: `scripts/score.mjs` — `EXECUTION_SCORERS["model-effort"]` (~839), `automation` (~701), `planning` (~681), `learning` (~881)
- Test: `scripts/__tests__/score.test.mjs` — add cases

- [ ] **Step 1: Write failing tests**

```js
describe("execution adoption credit (tips 74/33/planning/learning)", () => {
  const ins = () =>
    makeInsights({
      transcriptsScanned: true,
      opusDominantSessionCount: 0,
      planModeSessionCount: 0,
      multiTaskSessionCount: 1,
      hookFireCount: 0,
      learningModeSessionCount: 0,
    });

  it("model-effort gains awareness credit (tip 74, capped low)", () => {
    const a = EXECUTION_SCORERS["model-effort"](
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS["model-effort"](
      makeSignals({
        settings: { opus47AwarenessAdopted: true },
        insights: ins(),
      }),
    ).score;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThanOrEqual(30); // awareness cap is low
  });
  it("automation gains btw counter credit (tip 33)", () => {
    const a = EXECUTION_SCORERS.automation(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.automation(
      makeSignals({ settings: { cliBtwUseCount: 36 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
  it("planning gains plan-mode recency credit", () => {
    const a = EXECUTION_SCORERS.planning(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.planning(
      makeSignals({ settings: { planModeRecencyDays: 1 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
  it("learning gains skill-recency credit", () => {
    const a = EXECUTION_SCORERS.learning(
      makeSignals({ insights: ins() }),
    ).score;
    const b = EXECUTION_SCORERS.learning(
      makeSignals({ settings: { skillsUsedRecently: 3 }, insights: ins() }),
    ).score;
    expect(b).toBeGreaterThan(a);
  });
});
```

Note: `automation` reads `s.settings.cliBtwUseCount` directly (the raw counter), not the MAX-merged summary, because scorers receive the raw signals object.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "execution adoption credit"`
Expected: FAIL.

- [ ] **Step 3a: model-effort (tip 74, awareness, cap 8 ≈ 30% of typical credit)**

In `EXECUTION_SCORERS["model-effort"]`, before its `return`:

```js
const awareness = adoptionBonus({
  kind: "boolean",
  cap: 8,
  on: !!s.settings?.opus47AwarenessAdopted,
  label: "awareness",
  evidenceText:
    "Engaged with the 4.7 release surface (release notes / launch) — Boris tip 74 (awareness proxy)",
  gapText: null, // awareness proxy: absence is not a coached gap
});
score += awareness.points;
if (awareness.evidence) evidence.push(awareness.evidence);
```

- [ ] **Step 3b: automation (tip 33 btw counter, cap 10, target 10)**

In `EXECUTION_SCORERS.automation`, before its `return`:

```js
const btw = adoptionBonus({
  kind: "counter",
  cap: 10,
  value: s.settings?.cliBtwUseCount ?? 0,
  target: 10,
  label: "behavioral",
  evidenceText: `/btw side-channel adopted (${s.settings?.cliBtwUseCount ?? 0} uses) — Boris tip 33`,
  gapText: null,
});
score += btw.points;
if (btw.evidence) evidence.push(btw.evidence);
```

- [ ] **Step 3c: planning (plan-mode recency, cap 8, window 30)**

In `EXECUTION_SCORERS.planning`, before its `return` (inside the body after the ratio is computed):

```js
const planRecency = adoptionBonus({
  kind: "recency",
  cap: 8,
  days: s.settings?.planModeRecencyDays ?? null,
  window: 30,
  label: "behavioral",
  evidenceText: `Plan mode used in the last ${s.settings?.planModeRecencyDays} day(s) — recency corroboration`,
  gapText: null,
});
score = clamp(score + planRecency.points);
if (planRecency.evidence) evidence.push(planRecency.evidence);
```

- [ ] **Step 3d: learning (skill recency, cap 10, target 3 skills)**

In `EXECUTION_SCORERS.learning`, before its `return`:

```js
const skillRecency = adoptionBonus({
  kind: "counter",
  cap: 10,
  value: s.settings?.skillsUsedRecently ?? 0,
  target: 3,
  label: "behavioral",
  evidenceText: `${s.settings?.skillsUsedRecently ?? 0} skill(s) used in the last 30 days — active self-improving toolkit`,
  gapText: null,
});
score = clamp(score + skillRecency.points);
if (skillRecency.evidence) evidence.push(skillRecency.evidence);
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "execution adoption credit"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): adoption credit in model-effort/automation/planning/learning"
```

---

## Task 6: tip 27 — Platform customization breadth composite

**Files:**

- Modify: `scripts/score.mjs` `SCORERS.customization` (~line 379)
- Test: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Write failing test**

```js
import { SCORERS } from "../score.mjs";

describe("customization breadth (tip 27)", () => {
  it("rewards configuring many customization surfaces", () => {
    const few = makeSignals({ statuslineConfigured: true });
    const many = makeSignals({
      statuslineConfigured: true,
      keybindingsConfigured: true,
      has: { explanatoryStyle: true },
      settings: { customSpinnerVerbCount: 3, hasTerminalSetup: true },
    });
    expect(SCORERS.customization(many).score).toBeGreaterThan(
      SCORERS.customization(few).score,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "customization breadth"`
Expected: may already PASS partially (existing surfaces score). If it passes, tighten: assert `many` reaches a "customize everything" breadth bonus by checking evidence contains "surfaces". Add the assertion `expect(SCORERS.customization(many).evidence.join(" ")).toMatch(/customization surface/)` — THIS fails until Step 3.

- [ ] **Step 3: Add the breadth composite**

In `SCORERS.customization`, before the final `return`, count distinct configured surfaces and award a capped "customize everything" bonus (Boris tip 27):

```js
const surfaces = [
  s.statuslineConfigured,
  s.keybindingsConfigured,
  s.has.explanatoryStyle,
  (s.settings?.customSpinnerVerbCount || 0) > 0,
  !!s.settings?.hasTerminalSetup,
  (s.colorCommandUses ?? 0) > 0,
  (s.voiceCommandUses ?? 0) > 0,
].filter(Boolean).length;
if (surfaces >= 4) {
  score += 10;
  ev.push(
    `${surfaces} customization surfaces configured — "customize everything" (Boris tip 27)`,
  );
} else {
  gaps.push(
    `Only ${surfaces} customization surface(s) configured — Boris tip 27 rewards breadth`,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "customization breadth"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): customization breadth composite (tip 27, Platform axis)"
```

---

## Task 7: tip 39 — `aiTitlePresent` info signal (lowest value; non-scored)

**Files:**

- Modify: `scripts/_usage-data.mjs` `scanTranscriptModes` (detect `{type:"ai-title"}`)
- Modify: `scripts/run-assessment.mjs` `buildSignalsSummary` (project `aiTitlePresent`)
- Test: `scripts/__tests__/usage-data.test.mjs` (existing)

> **Decision:** `aiTitlePresent` is detected and surfaced but NOT scored (auto-naming is non-discriminating, ~universal). It gets NO rubric `satisfiedWhen` and NO catalog entry (the catalog is keyed by predicate signals only), so it does not affect any tracker probe count. It is documented in the tracker as info-only (🗣). If transcript scanning surface cost is judged not worth it during review, this task may be dropped without affecting Tasks 1–6.

- [ ] **Step 1: Write failing test**

```js
it("scanTranscriptModes detects ai-title entries", async () => {
  // build a temp transcript with one {"type":"ai-title"} line, scan it
  // assert result.hasAiTitle === true (field name per implementation)
});
```

Write a concrete temp-file test using `mktemp`/`/tmp` (absolute path) following the existing usage-data test pattern in the file.

- [ ] **Step 2: Run to verify it fails.** Expected: `hasAiTitle` undefined.

- [ ] **Step 3:** In `scanTranscriptModes`, set `hasAiTitle = true` when a parsed line has `type === "ai-title"`; include it in the returned object. In `buildSignalsSummary`, add `aiTitlePresent: !!signals.insights?.aiTitlePresent` (or wherever the per-session scan aggregates — mirror how `learningModeMatchesTotal` aggregates). Keep aggregation simple: `aiTitlePresent` true if any scanned session had one.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add scripts/_usage-data.mjs scripts/run-assessment.mjs scripts/__tests__/usage-data.test.mjs
git commit -m "feat(signals): detect ai-title sessions as info-only signal (tip 39)"
```

---

## Task 8: Fixtures — add new signal fields to `makeSignals`

**Files:**

- Modify: `scripts/__tests__/_fixtures.mjs` `makeSignals` base (line 7 `settings` block)

- [ ] **Step 1:** Add to the `settings` object in `makeSignals` base (so no test NaNs from missing fields):

```js
      coworkDispatchAdopted: false,
      opus47AwarenessAdopted: false,
      cliBtwUseCount: 0,
      planModeRecencyDays: null,
      skillsUsedRecently: 0,
      customSpinnerVerbCount: 0,
      hasTerminalSetup: false,
```

(Confirm `customSpinnerVerbCount` / `hasTerminalSetup` aren't already present; add only if missing.)

- [ ] **Step 2: Run the full suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: all green (existing + new).

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/_fixtures.mjs
git commit -m "test(fixtures): add runtime-adoption fields to makeSignals"
```

---

## Task 9: rubric.json — 2 new `satisfiedWhen` next-actions

**Files:**

- Modify: `app/data/rubric.json` (`parallel` + `model-effort` dimensions)

- [ ] **Step 1:** Append to the `parallel` dimension's `nextActions` array:

```json
{
  "id": "cowork-dispatch",
  "action": "Dispatch a cowork / agents-fleet run at least once — Boris tip 50",
  "effort": "10min",
  "satisfiedWhen": "coworkDispatchAdopted",
  "borisTip": 50
}
```

Append to the `model-effort` dimension's `nextActions` array:

```json
{
  "id": "opus47-awareness",
  "action": "Review the 4.7 release notes to absorb the 4.6→4.7 workflow shifts — Boris tip 74",
  "effort": "5min",
  "satisfiedWhen": "opus47AwarenessAdopted",
  "borisTip": 74
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "require('./app/data/rubric.json'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add app/data/rubric.json
git commit -m "feat(rubric): cowork-dispatch + opus47-awareness next-actions (tips 50/74)"
```

---

## Task 10: probe-catalog.json — `runtime` source + 2 entries

**Files:**

- Modify: `app/data/probe-catalog.json`

- [ ] **Step 1:** Add `"runtime"` to `_meta.sourceCategories` (after `"history"`), and append two entries:

```json
"coworkDispatchAdopted": {
  "source": "runtime",
  "path": "~/.claude.json → hasUsedAgentsFleet",
  "description": "True once the user has dispatched a cowork / agents-fleet run. Durable 'has used' adoption flag (Boris tip 50). Axis A — feeds Execution adoption credit, not Platform Setup."
},
"opus47AwarenessAdopted": {
  "source": "runtime",
  "path": "~/.claude.json → opus47LaunchSeenCount / unpinOpus47LaunchEffort / lastReleaseNotesSeen",
  "description": "True when the user has engaged the 4.7 release surface. Awareness proxy for the 4.6→4.7 workflow shifts (Boris tip 74), not behavioral mastery. Axis A."
}
```

Also update the `_meta.generated` note to mention that `runtime`-source signals feed the Execution axis (axis A), unlike `settings`-source ~/.claude.json fields which are Platform config posture.

- [ ] **Step 2: Validate JSON parses + count**

Run: `node -e "const c=require('./app/data/probe-catalog.json'); const n=Object.keys(c).filter(k=>k!=='_meta').length; console.log('entries:', n)"`
Expected: `entries: 47` (was 45).

- [ ] **Step 3: Commit**

```bash
git add app/data/probe-catalog.json
git commit -m "feat(probes): runtime source + cowork/opus47 catalog entries"
```

---

## Task 11: probes page — `runtime` source + `A` axis badge

**Files:**

- Modify: `app/methodology/probes/page.tsx`

- [ ] **Step 1:** Update the `SourceKey` type to include `"runtime"` (find its definition near the top — it's a union of the catalog source strings).

- [ ] **Step 2:** Widen the `SOURCE_META` value type and add the entry. Change line 55 type to `axis: "P" | "P*" | "A"` and append after `history`:

```tsx
  runtime: {
    title: "Runtime adoption (~/.claude.json)",
    blurb:
      "Durable feature-adoption flags from ~/.claude.json (hasUsedAgentsFleet, release-notes engagement). Axis A: these feed Execution adoption credit, not Platform Setup.",
    order: 6,
    axis: "A",
  },
```

- [ ] **Step 3:** Update the comment at lines 49–52 to note axis A exists for runtime adoption signals that feed Execution.

- [ ] **Step 4:** Update the axis-badge color branch (~line 330). Currently `axisLabel === "P" ? <green> : <other>`. Make it a three-way so `A` gets a distinct color (e.g. amber):

```tsx
axisLabel === "P"
  ? "<existing P classes>"
  : axisLabel === "P*"
    ? "<existing P* classes>"
    : "<amber A classes>";
```

(Read the exact current className strings at line 330 and extend; do not invent new utility names beyond the palette already in the file.)

- [ ] **Step 5:** Update the intro legend (~lines 220–224) to add an `axis A` line stating it feeds the Execution axis (adoption credit), and adjust the "checks feed Platform Setup" sentence to note A is the exception.

- [ ] **Step 6: Validate the page builds**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds; `/methodology/probes` compiles. (Or `npx tsc --noEmit` if faster.)

- [ ] **Step 7: Commit**

```bash
git add app/methodology/probes/page.tsx
git commit -m "feat(probes): runtime source + A (adoption) axis badge on probes page"
```

---

## Task 12: Update the probe tracker (part of the release)

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1:** Part 1 — add a `runtime` source layer with registry rows for `coworkDispatchAdopted` and `opus47AwarenessAdopted` (and note the strengthened `btwCommandUses` source + the recency corroboration signals).

- [ ] **Step 2:** Part 2 — flip tip 50 and tip 74 off ❌ (50 → ✅/📊 measurable; 74 → 🗣/📊 awareness proxy); flip tip 27 (Platform breadth) off ❌; add tip 39 as 🗣 info-only note. Re-derive the ✅/📊/🗣/❌ tally so it still sums to 75.

- [ ] **Step 3: Re-derive ALL FIVE header counts (do NOT guess).**

```bash
# probe-catalog entries:
node -e "const c=require('./app/data/probe-catalog.json'); console.log('catalog:', Object.keys(c).filter(k=>k!=='_meta').length)"
# signalsSummary keys — INVOKE, never parse:
node --input-type=module -e "import {buildSignalsSummary} from './scripts/run-assessment.mjs'; import {makeSignals} from './scripts/__tests__/_fixtures.mjs'; console.log('signalsSummary:', Object.keys(buildSignalsSummary(makeSignals())).length)"
# next-actions with satisfiedWhen:
node -e "const r=require('./app/data/rubric.json'); let n=0; for(const d of r.dimensions) for(const a of (d.nextActions||[])) if(a.satisfiedWhen) n++; console.log('next-actions:', n)"
# dimensions:
node -e "const r=require('./app/data/rubric.json'); console.log('dimensions:', r.dimensions.length)"
# tips: (Boris snapshot count — keep as-is unless changed)
```

Update the tracker header's five cited counts to match this output exactly.

- [ ] **Step 4: Run the count-enforcement test**

Run: `npx vitest run scripts/__tests__/tracker-counts.test.mjs`
Expected: PASS — the header now matches re-derived live counts.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "docs(tracker): runtime-adoption layer + tip 50/74/27/39 reclassification"
```

---

## Task 13: Update README probe-coverage section

**Files:**

- Modify: `README.md` ("## Probe coverage" section)

- [ ] **Step 1:** Read the current "## Probe coverage" section. Update: the per-layer table to add the `runtime` source row (axis A); the legend to include axis A (adoption → Execution); and the predicate/probe counts to match the re-derived numbers from Task 12 Step 3. Note the 3 newly-instrumented tips (50, 27, 74) and the info-only tip 39.

- [ ] **Step 2: Verify counts in prose match the live numbers** from Task 12 Step 3 (no hand-typed number that isn't re-derived).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): runtime-adoption probe coverage (tips 50/27/74/39)"
```

---

## Task 14: End-to-end validation of the implemented changes

**Files:** none (validation only)

This task satisfies the explicit "add validation for the implemented changes" requirement — beyond unit tests, prove the new signals surface in a real run.

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run`
Expected: all tests pass (existing + all new). Note the new total count.

- [ ] **Step 2: Real assessment surfaces the new signals**

Run: `npm run assess:print -- --include-transcripts --insights-lookback 30 2>&1 | tail -60`
Expected: output includes the new evidence/gaps (cowork dispatch, /btw uses, customization surfaces) and the radar shows movement on the affected Execution dims. Confirm `app/data/assessment.json#signalsSummary` now carries `coworkDispatchAdopted`, `opus47AwarenessAdopted`, `planModeRecencyDays`, `skillsUsedRecently`.

```bash
node -e "const a=require('./app/data/assessment.json'); const s=a.signalsSummary; console.log({cowork:s.coworkDispatchAdopted, opus47:s.opus47AwarenessAdopted, planDays:s.planModeRecencyDays, skills:s.skillsUsedRecently, btw:s.btwCommandUses})"
```

- [ ] **Step 3: Probes page renders the runtime group**

Run: `npm run build 2>&1 | tail -10` (or start `npm run dev` and load `http://localhost:3737/methodology/probes`)
Expected: a "Runtime adoption (~/.claude.json)" section with an `axis A` badge and 2 checks; the source count in the header increments to 6.

- [ ] **Step 4: Lint clean**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 5: Commit any assessment.json refresh (gitignored — skip if not tracked).** No commit if `assessment.json` is gitignored (it is).

---

## Task 15: Ship

- [ ] **Step 1:** Run `/ship` to execute the full chain (test → verify-agent → simplify → code review → commit → push + PR → Jira). The tracker + README updates are already committed on this branch, so they ship in the same PR and become part of the release.

- [ ] **Step 2:** After merge, cut the release per the project's release-branch flow (bump `package.json`, release-branch PR, tag `main`, `gh release create --target main`). The release notes should call out the 3 newly-instrumented tips (50, 27, 74) + the `runtime`/A axis.

---

## Self-Review

**Spec coverage:**

- §3.1 ingestion → Task 1 (refined: extends `signals.mjs`, not a new module). ✓
- §3.2 signal extraction → Task 2. ✓
- §3.3 `adoptionBonus` → Task 3; composition → Tasks 4–5. ✓
- §3.4 progression milestones → **GAP.** The spec proposed timestamped milestones (`lastPlanModeUse`, skill recency). This plan instead routes those as recency _credit_ (Tasks 4–5) and does not add `progression.mjs` DETECTORS. **Decision:** dropped from this iteration — the recency signals are more useful as continuous credit than as one-time milestones, and milestones add `progression.mjs` surface + config-progression state for marginal value. Documented here so it's an explicit cut, not an oversight. If milestones are wanted, add a follow-up task mirroring the `DETECTORS` shape (timestamp from `lastPlanModeUse`).
- §4 axis routing → Tasks 4–6 (Execution) + Task 6 (Platform tip 27). ✓
- §5 probes/catalog → Tasks 10–11. ✓
- §6 tracker → Task 12. ✓
- §7 testing → Tasks 1–8 (TDD) + Task 14 (e2e validation). ✓
- §8 privacy → no raw flags on shareable surfaces: scorers emit aggregate evidence strings only; `assessment.json` is local/gitignored. ✓ (Add a one-line methodology note as part of Task 13 if desired.)
- §9 risks: `hasUsedAgentsFleet`→tip 50 semantic mapping is asserted in catalog/evidence text; confirm against release notes during Task 15 verify-agent.

**Placeholder scan:** Task 7 (tip 39) and Task 11 (exact className strings) require the executor to read the live file region — these are real "read then extend" steps, not placeholders; the surrounding code/decision is fully specified.

**Type consistency:** signal field names are identical across tasks — `coworkDispatchAdopted`, `opus47AwarenessAdopted`, `cliBtwUseCount` (raw, on `settings`), `planModeRecencyDays`, `skillsUsedRecently`, `aiTitlePresent`. `adoptionBonus` signature (`{kind, cap, on, value, days, window, target, label, evidenceText, gapText}`) is consistent between Task 3 definition and Tasks 4–5 call sites.
