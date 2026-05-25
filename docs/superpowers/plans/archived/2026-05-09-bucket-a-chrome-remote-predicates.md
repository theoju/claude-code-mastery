# Bucket A — Chrome + Remote Control Predicates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two unwired rubric next-actions (`verification/chrome-extension`, `remote/remote-control`) so they stop appearing as priority items when the underlying state is already satisfied.

**Architecture:** Q1 is a one-line rubric edit (signal `hasClaudeInChrome` already exists from PR #37). Q5 mirrors the PR #37 pattern: read `hasUsedRemoteControl` from `~/.claude.json` via the existing `cliConfig` plumbing in `gatherSignals`, forward through `buildSignalsSummary` as `hasRemoteControl`, predicate the action.

**Tech Stack:** Node.js, vitest, JSON rubric.

**Branch:** `feat/bucket-a-chrome-remote-predicates` (worktree under `~/.config/superpowers/worktrees/` or repo `.worktrees/`).

---

## File Structure

| File                                               | Change                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/signals.mjs`                              | Add `detectRemoteControl(cliConfig)` helper; expose `hasRemoteControl` in `gatherSignals` return |
| `scripts/run-assessment.mjs`                       | Forward `hasRemoteControl` through `buildSignalsSummary`                                         |
| `app/data/rubric.json`                             | Add `satisfiedWhen` to `verification/chrome-extension` and `remote/remote-control`               |
| `scripts/__tests__/detect-remote-control.test.mjs` | New unit tests for the detector                                                                  |
| `scripts/__tests__/build-signals-summary.test.mjs` | Add `hasRemoteControl` to inline snapshot + forwarding test                                      |
| `app/lib/__tests__/rubric-predicates.test.ts`      | Add `hasRemoteControl: true` to `ALL_SATISFIED_SIGNALS` fixture                                  |

---

## Task 1: Wire `verification/chrome-extension` to existing `hasClaudeInChrome` signal

**Files:**

- Modify: `app/data/rubric.json` (verification dim → chrome-extension action)
- Test: `app/lib/__tests__/rubric-predicates.test.ts` (sweep guard already covers this once predicate is added)

- [ ] **Step 1: Verify the signal already exists in the all-satisfied fixture**

Run:

```bash
grep -n "hasClaudeInChrome" app/lib/__tests__/rubric-predicates.test.ts
```

Expected: matches the line `hasClaudeInChrome: true,` already in `ALL_SATISFIED_SIGNALS` (added by PR #37).

- [ ] **Step 2: Add `satisfiedWhen` to the rubric action**

Edit `app/data/rubric.json` — find the `verification` dim, the `chrome-extension` action, and add the predicate field:

```json
{
  "id": "chrome-extension",
  "action": "Install the Claude Chrome extension for any web work — Boris tip 51",
  "effort": "5min",
  "satisfiedWhen": "hasClaudeInChrome"
}
```

- [ ] **Step 3: Run the predicate sweep guard**

Run:

```bash
npx vitest run app/lib/__tests__/rubric-predicates.test.ts
```

Expected: PASS. Both "every satisfiedWhen resolves to true against an all-satisfied fixture" and "every satisfiedWhen resolves to false against an empty fixture" must pass — the latter proves there's no false positive from accidental truthy default.

- [ ] **Step 4: Commit**

```bash
git add app/data/rubric.json
git commit -m "fix(rubric): wire verification/chrome-extension to hasClaudeInChrome signal"
```

---

## Task 2: Add `hasRemoteControl` signal + predicate

**Files:**

- Modify: `scripts/signals.mjs` (new detector + return value)
- Modify: `scripts/run-assessment.mjs` (forward through `buildSignalsSummary`)
- Modify: `app/data/rubric.json` (add `satisfiedWhen` on `remote/remote-control`)
- Create: `scripts/__tests__/detect-remote-control.test.mjs`
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (snapshot + forwarding test)
- Modify: `app/lib/__tests__/rubric-predicates.test.ts` (add `hasRemoteControl: true` to fixture)

- [ ] **Step 1: Write failing detector test**

Create `scripts/__tests__/detect-remote-control.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { detectRemoteControl } from "../signals.mjs";

describe("detectRemoteControl", () => {
  it("returns false for null/undefined config", () => {
    expect(detectRemoteControl(null)).toBe(false);
    expect(detectRemoteControl(undefined)).toBe(false);
  });

  it("returns false for empty config", () => {
    expect(detectRemoteControl({})).toBe(false);
  });

  it("returns true when hasUsedRemoteControl is strictly true", () => {
    expect(detectRemoteControl({ hasUsedRemoteControl: true })).toBe(true);
  });

  it("rejects non-strict-true values (defensive)", () => {
    expect(detectRemoteControl({ hasUsedRemoteControl: 1 })).toBe(false);
    expect(detectRemoteControl({ hasUsedRemoteControl: "true" })).toBe(false);
    expect(detectRemoteControl({ hasUsedRemoteControl: false })).toBe(false);
  });

  it("ignores unrelated cliConfig fields", () => {
    expect(detectRemoteControl({ claudeInChromeDefaultEnabled: true })).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/detect-remote-control.test.mjs
```

Expected: FAIL — `detectRemoteControl is not exported` or similar import error.

- [ ] **Step 3: Implement detector**

Edit `scripts/signals.mjs`. Below the existing `detectClaudeInChrome` export (around line 145–147), add:

```js
// True when the user has invoked the iOS / web Remote Control flow at least
// once. Boris tip 47. Lives in `~/.claude.json#hasUsedRemoteControl` (CLI
// runtime state), not `~/.claude/settings.json`. Strict equality on `true`
// — the field is a sticky flag, not a config toggle, so we reject coerced
// truthy values (1, "true") to avoid future false positives if the CLI
// changes the encoding.
export function detectRemoteControl(cliConfig) {
  return cliConfig?.hasUsedRemoteControl === true;
}
```

- [ ] **Step 4: Wire detector into gatherSignals return**

In `scripts/signals.mjs`, find the line that reads `cliConfig` (around line 257) and the line that computes `hasClaudeInChrome` from it (line 259). Add `hasRemoteControl` next to it:

```js
const cliConfig =
  (await safeReadJson(join(claudeHome(), "..", ".claude.json"))) || {};
const hasClaudeInChrome = detectClaudeInChrome(cliConfig);
const hasRemoteControl = detectRemoteControl(cliConfig);
```

Then in the return object's `settings` block (where `hasClaudeInChrome` is currently exposed at line 373), add the new flag right beneath it:

```js
hasClaudeInChrome,
hasRemoteControl,
```

- [ ] **Step 5: Run detector test to verify it passes**

```bash
npx vitest run scripts/__tests__/detect-remote-control.test.mjs
```

Expected: PASS — all 5 cases.

- [ ] **Step 6: Forward through buildSignalsSummary**

In `scripts/run-assessment.mjs`, find the `buildSignalsSummary` function and the line that exposes `hasClaudeInChrome` from `signals.settings`. Add the parallel forwarding:

```js
hasClaudeInChrome: !!signals.settings.hasClaudeInChrome,
hasRemoteControl: !!signals.settings.hasRemoteControl,
```

- [ ] **Step 7: Add forwarding test**

In `scripts/__tests__/build-signals-summary.test.mjs`, add a new test next to the existing `hasClaudeInChrome` forwarding test (around line 215):

```js
it("forwards hasRemoteControl from settings.hasRemoteControl", () => {
  expect(
    buildSignalsSummary(
      makeSignals({
        settings: {
          ...makeSignals().settings,
          hasRemoteControl: true,
        },
      }),
    ).hasRemoteControl,
  ).toBe(true);
  expect(buildSignalsSummary(makeSignals()).hasRemoteControl).toBe(false);
});
```

- [ ] **Step 8: Update inline snapshot**

The snapshot test at the bottom of `scripts/__tests__/build-signals-summary.test.mjs` (sortedKeys block, around line 270) must include `"hasRemoteControl"` in alphabetical order. Add it between `"hasPostToolHook"` and `"hasShipCommand"`:

```js
"hasMcpServers",
"hasPostToolHook",
"hasRemoteControl",
"hasShipCommand",
```

- [ ] **Step 9: Run snapshot suite to verify update applies cleanly**

```bash
npx vitest run scripts/__tests__/build-signals-summary.test.mjs
```

Expected: PASS — including the snapshot test (which would fail with a "snapshot mismatch" report if the alphabetical position is wrong; if so, fix and re-run).

- [ ] **Step 10: Add `hasRemoteControl` to the all-satisfied predicate fixture**

In `app/lib/__tests__/rubric-predicates.test.ts`, find `ALL_SATISFIED_SIGNALS` and add the new flag in the `// integrations` group or a new `// remote` group:

```ts
hasClaudeInChrome: true,
mcpServersConnected: 5,
// remote
hasRemoteControl: true,
```

- [ ] **Step 11: Add `satisfiedWhen` to the rubric action**

Edit `app/data/rubric.json` — find the `remote` dim, the `remote-control` action, and add the predicate:

```json
{
  "id": "remote-control",
  "action": "Enable 'Remote Control for all sessions' in /config — Boris tip 47",
  "effort": "5min",
  "satisfiedWhen": "hasRemoteControl"
}
```

- [ ] **Step 12: Run full test suite**

```bash
npx vitest run
```

Expected: PASS — all suites green. The predicate-sweep test in particular asserts both "true under all-satisfied" and "false under empty fixture" — both must pass without weakening.

- [ ] **Step 13: Run a real-environment assessment to confirm end-to-end**

```bash
npm run assess -- --insights-lookback 14 2>&1 | grep -E "(Platform Setup|Execution|chrome-extension|remote-control)" | head -20
```

Expected: Both `verification/chrome-extension` and `remote/remote-control` are no longer listed as priority next-actions in the console output. Score may also tick up a point or two if the dim was in deficit, but score deltas are not a success criterion (predicates affect TODO visibility, not formulas — same as PR #37/#38).

- [ ] **Step 14: Commit**

```bash
git add scripts/signals.mjs scripts/run-assessment.mjs app/data/rubric.json \
        scripts/__tests__/detect-remote-control.test.mjs \
        scripts/__tests__/build-signals-summary.test.mjs \
        app/lib/__tests__/rubric-predicates.test.ts
git commit -m "feat(self-assessment): detect Remote Control opt-in from cliConfig

Mirrors PR #37 (Chrome detection) — reads hasUsedRemoteControl from
~/.claude.json, forwards through buildSignalsSummary, predicates the
remote/remote-control next-action.

Closes Bucket A from the 2026-05-09 detection-gap audit alongside the
verification/chrome-extension wire-up in the prior commit."
```

---

## Self-Review

- **Coverage:** Q1 (chrome-extension wire-up) → Task 1. Q5 (Remote Control signal + predicate) → Task 2. Both Bucket A items covered.
- **Placeholders:** None — every step is concrete.
- **Type consistency:** `hasRemoteControl` (camelCase boolean) used in detector, signals.settings, buildSignalsSummary output, fixture, and predicate string. `detectRemoteControl` named consistently with `detectClaudeInChrome`.
- **Failure mode coverage:** Detector handles null/undefined/empty config, rejects coerced truthy values, ignores unrelated fields. Predicate sweep guard catches typos in `satisfiedWhen` strings.

## Out of scope

- **Score-formula changes.** Predicates only — no `score.mjs` edits. Same scope discipline as PR #37/#38.
- **Q3 doc clarification** about `effortLevel xhigh` detection cadence — separate trivial doc tweak, not bundled here.
- **Q4 action-text update** for `parallel/batch-sweep` — separate, deferred.
