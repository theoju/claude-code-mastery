# Detection Polish Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle 5 small follow-ups from the v0.7/v0.8 review into a single PR — each item is independently small, all touch the detection layer, and they share a common test surface.

**Architecture:** Five independent tasks executed in TDD order. Each commits separately so the PR has a clean per-fix history. No score-formula changes (separate PR).

**Tech Stack:** Node.js, vitest. Pure-function or near-pure-function changes.

**Branch:** `feat/detection-polish-bundle` (worktree off main).

---

## Tasks summary

| #   | Item                                                            | Effort |
| --- | --------------------------------------------------------------- | ------ |
| 1   | Streaming refactor for `scanTranscriptInvocations`              | 30 min |
| 2   | Replace `arguments[0]?.<key>` with proper options destructuring | 15 min |
| 3   | Wire `integrations/vercel-cli` predicate                        | 30 min |
| 4   | Q3: rework `effort-xhigh` action wording                        | 5 min  |
| 5   | Align `package.json` version to v0.8.0                          | 2 min  |

---

## File Structure

| File                                               | Change                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/_usage-data.mjs`                          | Streaming refactor in `scanTranscriptInvocations`; options destructuring                                    |
| `scripts/signals.mjs`                              | Add `detectVercelCli` + read it in `gatherSignals`; options destructuring in 2 gatherers                    |
| `scripts/run-assessment.mjs`                       | Forward `hasVercelCli` through `buildSignalsSummary`                                                        |
| `scripts/__tests__/detect-vercel-cli.test.mjs`     | New: unit tests for the detector                                                                            |
| `scripts/__tests__/build-signals-summary.test.mjs` | Snapshot + forwarding test for `hasVercelCli`                                                               |
| `app/data/rubric.json`                             | Add `satisfiedWhen: "hasVercelCli"` to `integrations/vercel-cli`; reword `model-effort/effort-xhigh` action |
| `app/lib/__tests__/rubric-predicates.test.ts`      | Add `hasVercelCli: true` to ALL_SATISFIED_SIGNALS                                                           |
| `package.json`                                     | Bump version to `0.8.0`                                                                                     |

---

## Task 1: Streaming refactor for `scanTranscriptInvocations`

**Files:**

- Modify: `scripts/_usage-data.mjs` — `scanTranscriptInvocations` body
- Test: `scripts/__tests__/scan-transcript-invocations.test.mjs` (existing tests must continue to pass)

**Why:** Code-review on PR #40 flagged that `scanTranscriptInvocations` reads each transcript fully into memory via `readFile + split('\n')`, while sibling `scanTranscriptModes` already uses `createReadStream + readline`. Adopting the same pattern handles large transcripts predictably.

The plan-then-launch detection currently looks at `lines[i+1..i+12]` so we can't pure-stream — we need a small lookahead buffer. The streaming pattern: read line by line, maintain a sliding window of the last 13 parsed lines (current + lookbehind 12), apply the existing per-line logic against the window.

- [ ] **Step 1: Confirm baseline**

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: 10/10 PASS (current state).

- [ ] **Step 2: Add the streaming import**

In `scripts/_usage-data.mjs`, top of file, find the existing imports. The file already imports `createInterface` from `node:readline` (used by `scanTranscriptModes`). Confirm it's available; if not, add:

```js
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
```

- [ ] **Step 3: Refactor the per-file loop in `scanTranscriptInvocations`**

Replace the per-file body:

```js
let raw;
try {
  const { readFile } = await import("node:fs/promises");
  raw = await readFile(path, "utf8");
} catch {
  continue;
}
const lines = raw
  .split("\n")
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

let sessionHasLoop = false;
let sessionHasBabysit = false;

for (let i = 0; i < lines.length; i++) {
  // ...existing scanning logic...
}

if (sessionHasLoop && sessionHasBabysit) counts.babysitLoopUses++;
```

with a streaming version that maintains the same observable behavior. The existing scanning logic uses `lines[i]` for the current entry and `lines[j]` for `j = i+1..i+12` lookahead in the plan-then-launch case. Restructure so the per-line work happens _after_ a 12-line lookahead has been buffered:

```js
const stream = createReadStream(path, { encoding: "utf8" });
const rl = createInterface({ input: stream, crlfDelay: Infinity });
const window = []; // rolling buffer; index 0 = current, 1..12 = lookahead

let sessionHasLoop = false;
let sessionHasBabysit = false;

const processCurrent = () => {
  const line = window[0];
  if (!line) return;
  const ts = Date.parse(line.timestamp || "");
  if (!Number.isNaN(ts) && ts < cutoff) return;

  const uText = userMessageText(line);
  if (uText) {
    const found = extractSlashCommands(uText);
    if (found.has("go")) counts.goCommandUses++;
    if (found.has("batch")) counts.batchCommandUses++;
    if (found.has("focus")) counts.focusCommandUses++;
    if (found.has("schedule")) counts.scheduleCommandUses++;
    if (found.has("loop")) sessionHasLoop = true;
    if (found.has("babysit")) sessionHasBabysit = true;
  }

  const toolName = assistantToolUseName(line);
  if (toolName === "ExitPlanMode") {
    for (let j = 1; j < window.length; j++) {
      const next = window[j];
      if (next.type !== "assistant") continue;
      const nextTool = assistantToolUseName(next);
      if (nextTool && nextTool !== "ExitPlanMode") {
        counts.planThenLaunchSessions++;
      }
      break;
    }
  }
};

try {
  for await (const rawLine of rl) {
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    window.push(parsed);
    if (window.length > 13) {
      processCurrent();
      window.shift();
    }
  }
} catch {
  rl.close();
  continue;
}
// Drain remaining window (last 13 lines never reached the "full window" branch).
while (window.length > 0) {
  processCurrent();
  window.shift();
}

if (sessionHasLoop && sessionHasBabysit) counts.babysitLoopUses++;
```

Replace the existing inner loop with this block. Keep the outer loop over `sessionFiles`.

- [ ] **Step 4: Run tests to verify behavior preserved**

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: 10/10 PASS — every existing assertion holds because the observable contract is identical.

- [ ] **Step 5: Run real-env spot check**

```bash
node -e 'import("./scripts/signals.mjs").then(async (s) => {
  const sig = await s.gatherSignals(process.cwd());
  console.log(sig.transcriptInvocations);
});'
```

Expected: same shape as before the refactor (the user's real signal counts: `goCommandUses` ~200+, `batchCommandUses` ~140+, `planThenLaunchSessions` ~3, etc.).

- [ ] **Step 6: Commit**

```bash
git add scripts/_usage-data.mjs
git commit -m "refactor(self-assessment): stream transcripts in scanTranscriptInvocations

Mirrors the pattern already established by scanTranscriptModes in the
same file. Maintains a 13-entry rolling window so the existing
ExitPlanMode + 12-line lookahead semantics are preserved. Memory
footprint is now O(window) instead of O(file). 10/10 tests pass with
no observable behavior change."
```

---

## Task 2: Options destructuring across 3 gatherers

**Files:**

- Modify: `scripts/signals.mjs` — `gatherShipJournal`, `gatherShellAliases`
- Modify: `scripts/_usage-data.mjs` — `scanTranscriptInvocations`

**Why:** Code-simplifier on PR #40 flagged that all three gatherers use `arguments[0]?.<key>` to detect "test injecting a path explicitly." That pattern is brittle — fails if the function is ever refactored to a non-arrow form, and reads awkwardly. Replace with explicit options destructuring.

- [ ] **Step 1: Confirm baseline tests**

```bash
npx vitest run scripts/__tests__/gather-ship-journal.test.mjs scripts/__tests__/gather-shell-aliases.test.mjs scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: PASS across all three suites.

- [ ] **Step 2: Refactor `gatherShipJournal`**

In `scripts/signals.mjs`, find `gatherShipJournal`:

Replace:

```js
export async function gatherShipJournal({
  journalPath = join(claudeHome(), "ship", "journal.jsonl"),
  now = new Date(),
  lookbackDays = 14,
} = {}) {
  if (process.env.VITEST && !arguments[0]?.journalPath) {
    return { stage2Count: 0, totalRuns: 0, lastRunAt: null };
  }
  // ...
}
```

with:

```js
export async function gatherShipJournal(options = {}) {
  if (process.env.VITEST && !options.journalPath) {
    return { stage2Count: 0, totalRuns: 0, lastRunAt: null };
  }
  const {
    journalPath = join(claudeHome(), "ship", "journal.jsonl"),
    now = new Date(),
    lookbackDays = 14,
  } = options;
  // ...rest of function body unchanged...
}
```

- [ ] **Step 3: Refactor `gatherShellAliases`**

Same pattern. Replace:

```js
export async function gatherShellAliases({
  rcPaths = [join(homedir(), ".zshrc"), join(homedir(), ".bashrc")],
} = {}) {
  if (process.env.VITEST && !arguments[0]?.rcPaths) {
    return { worktreeAliasCount: 0 };
  }
  // ...
}
```

with:

```js
export async function gatherShellAliases(options = {}) {
  if (process.env.VITEST && !options.rcPaths) {
    return { worktreeAliasCount: 0 };
  }
  const { rcPaths = [join(homedir(), ".zshrc"), join(homedir(), ".bashrc")] } =
    options;
  // ...rest unchanged...
}
```

- [ ] **Step 4: Refactor `scanTranscriptInvocations`**

In `scripts/_usage-data.mjs`. Same pattern — replace destructured params + `arguments[0]?.projectsRoot` with `(options = {})` + early-skip + inner destructuring.

- [ ] **Step 5: Run all three suites again**

```bash
npx vitest run scripts/__tests__/gather-ship-journal.test.mjs scripts/__tests__/gather-shell-aliases.test.mjs scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: PASS — observable behavior is identical.

- [ ] **Step 6: Commit**

```bash
git add scripts/signals.mjs scripts/_usage-data.mjs
git commit -m "refactor(self-assessment): replace arguments[0] with options destructuring

The VITEST skip pattern was using arguments[0]?.<key> to detect test
injection of explicit paths — brittle (fails on non-arrow refactors)
and harder to read. Switch to (options = {}) + explicit guard +
inline destructuring. Mirrors the pattern in PR feedback from
code-simplifier on PR #40."
```

---

## Task 3: Wire `integrations/vercel-cli` predicate

**Files:**

- Create: `scripts/__tests__/detect-vercel-cli.test.mjs`
- Modify: `scripts/signals.mjs` (new `detectVercelCli` async helper)
- Modify: `scripts/run-assessment.mjs` (forward through `buildSignalsSummary`)
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (snapshot + forwarding)
- Modify: `app/data/rubric.json` (`integrations/vercel-cli` action gets `satisfiedWhen`)
- Modify: `app/lib/__tests__/rubric-predicates.test.ts` (fixture)

**Why:** `integrations/vercel-cli` action is "npm i -g vercel to unlock env/deploy/logs agentic flows" — currently unpredicated despite being trivially detectable via `command -v vercel`. Closes one more rubric coverage gap.

- [ ] **Step 1: Write failing detector test**

Create `scripts/__tests__/detect-vercel-cli.test.mjs`:

```js
import { describe, it, expect, vi } from "vitest";
import { detectVercelCli } from "../signals.mjs";

describe("detectVercelCli", () => {
  it("returns false when execFile rejects (vercel not installed)", async () => {
    const fakeExec = vi.fn().mockRejectedValue(new Error("ENOENT"));
    expect(await detectVercelCli({ execFile: fakeExec })).toBe(false);
  });

  it("returns true when execFile resolves with a path", async () => {
    const fakeExec = vi
      .fn()
      .mockResolvedValue({ stdout: "/usr/local/bin/vercel\n", stderr: "" });
    expect(await detectVercelCli({ execFile: fakeExec })).toBe(true);
  });

  it("returns false when stdout is empty (which printed nothing)", async () => {
    const fakeExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    expect(await detectVercelCli({ execFile: fakeExec })).toBe(false);
  });

  it("returns false when stdout is whitespace-only", async () => {
    const fakeExec = vi.fn().mockResolvedValue({ stdout: "  \n", stderr: "" });
    expect(await detectVercelCli({ execFile: fakeExec })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/detect-vercel-cli.test.mjs
```

Expected: FAIL — import error.

- [ ] **Step 3: Implement detector**

In `scripts/signals.mjs`, near the existing `gatherMcpServers` (which already uses `execFile`), add:

```js
// True if the `vercel` CLI is on PATH. Boris tip 18 (Vercel CLI unlocks
// env/deploy/logs agentic flows). Uses `which` so we get a path on
// success, ENOENT on failure. The injectable execFile parameter exists
// purely for tests — production callers always use the default.
export async function detectVercelCli({ execFile = defaultExecFile } = {}) {
  try {
    const { stdout } = await execFile("which", ["vercel"], { timeout: 2000 });
    return typeof stdout === "string" && stdout.trim().length > 0;
  } catch {
    return false;
  }
}
```

If `defaultExecFile` is not yet exported/used, add at the top of the file:

```js
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
const defaultExecFile = promisify(execFileCb);
```

(Reuse the existing `execFile` import if `gatherMcpServers` already imports it.)

- [ ] **Step 4: Wire into `gatherSignals`**

In `gatherSignals`, alongside the existing `mcpServers` line:

```js
const mcpServers = await gatherMcpServers();
const hasVercelCli = process.env.VITEST ? false : await detectVercelCli();
```

The `process.env.VITEST` guard prevents the integration test suite from spawning a `which` subprocess against the developer's real PATH.

Add `hasVercelCli` to the return object's `settings` block alongside `hasClaudeInChrome` and `hasRemoteControl`.

- [ ] **Step 5: Forward through `buildSignalsSummary`**

In `scripts/run-assessment.mjs`:

```js
hasVercelCli: !!signals.settings.hasVercelCli,
```

Add next to `hasClaudeInChrome` / `hasRemoteControl` lines.

- [ ] **Step 6: Add forwarding + snapshot test**

In `scripts/__tests__/build-signals-summary.test.mjs`:

Add to `expectedKeys` array (alphabetical position between `hasStopHook` and `hasVercelPlugin`... actually `hasVercelCli` lands between `hasStopHookNotification` and `hasVercelPlugin`):

```js
"hasStopHookNotification",
"hasVercelCli",
"hasVercelPlugin",
```

Add forwarding test:

```js
it("forwards hasVercelCli from settings.hasVercelCli", () => {
  expect(
    buildSignalsSummary(
      makeSignals({
        settings: { ...makeSignals().settings, hasVercelCli: true },
      }),
    ).hasVercelCli,
  ).toBe(true);
  expect(buildSignalsSummary(makeSignals()).hasVercelCli).toBe(false);
});
```

Update the inline-snapshot test at the bottom — add `"hasVercelCli"` between `"hasStopHookNotification"` and `"hasVercelPlugin"`. Run the test once with `-u` to confirm the diff is exactly that single insertion.

- [ ] **Step 7: Add `satisfiedWhen` to rubric action**

In `app/data/rubric.json`, find `integrations/vercel-cli` and add:

```json
{
  "id": "vercel-cli",
  "action": "npm i -g vercel to unlock env/deploy/logs agentic flows",
  "effort": "5min",
  "satisfiedWhen": "hasVercelCli"
}
```

- [ ] **Step 8: Update predicate sweep fixture**

In `app/lib/__tests__/rubric-predicates.test.ts`, add to `ALL_SATISFIED_SIGNALS`:

```ts
hasVercelCli: true,
```

(Group it with the other `integrations` flags.)

- [ ] **Step 9: Run full suite**

```bash
npx vitest run
```

Expected: PASS across all suites.

- [ ] **Step 10: Commit**

```bash
git add scripts/signals.mjs scripts/run-assessment.mjs \
        scripts/__tests__/detect-vercel-cli.test.mjs \
        scripts/__tests__/build-signals-summary.test.mjs \
        app/data/rubric.json \
        app/lib/__tests__/rubric-predicates.test.ts
git commit -m "feat(self-assessment): detect vercel CLI on PATH; wire integrations/vercel-cli predicate"
```

---

## Task 4: Q3 — reword `effort-xhigh` action to match sticky-once predicate

**Files:**

- Modify: `app/data/rubric.json`

**Why:** The action text reads as a cadence ("change effortLevel to 'xhigh' in settings.json — Boris tip 67, 72") but the predicate is sticky: setting `effortLevel: xhigh` once → satisfies forever. Rewording to "Set ... once" aligns the wording with the predicate semantics.

- [ ] **Step 1: Update action text**

In `app/data/rubric.json`, find `model-effort/effort-xhigh`:

Replace:

```json
"action": "Change effortLevel to 'xhigh' in settings.json — Boris tip 67, 72"
```

with:

```json
"action": "Set effortLevel to 'xhigh' or 'max' once in ~/.claude/settings.json — Boris tip 67, 72"
```

- [ ] **Step 2: No code change**

The predicate (`effortLevel=xhigh|max`) already correctly matches the new wording.

- [ ] **Step 3: Run tests**

```bash
npx vitest run app/lib/__tests__/rubric-predicates.test.ts
```

Expected: PASS — predicate sweep unaffected (action text isn't tested, only the predicate).

- [ ] **Step 4: Commit**

```bash
git add app/data/rubric.json
git commit -m "fix(rubric): reword effort-xhigh action to match sticky-once predicate"
```

---

## Task 5: Align `package.json` version to v0.8.0

**Files:**

- Modify: `package.json`

**Why:** Released tags are `v0.5–v0.8` but `package.json#version` is still `0.1.0`. The tag is the source of truth for releases, but a version mismatch invites confusion and breaks downstream tooling that reads package.json (e.g. dashboard footer, telemetry pings if any).

- [ ] **Step 1: Update version**

In `package.json`, change:

```json
"version": "0.1.0"
```

to:

```json
"version": "0.8.0"
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: PASS — no test asserts the version directly. If one does (unlikely), update it.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump package.json version to 0.8.0 to match release tag"
```

---

## Self-Review

**1. Spec coverage:**

- All 5 items in the user's request are covered (Tasks 1–5 ✓)
- Each task has its own commit so PR history is clean
- Task 1 has a real-env spot check; Task 3 has a predicate sweep test

**2. Placeholder scan:**

- No "TBD", no "implement later", no "see Task N" — every code block is concrete.

**3. Type consistency:**

- `hasVercelCli` (camelCase boolean) used consistently in detector, signals.settings, buildSignalsSummary output, fixture, and predicate.
- Streaming refactor preserves the existing `processCurrent` logic — same per-line semantics, different traversal pattern.

## Out of scope

- Score-formula update (separate plan: `2026-05-09-score-formula-update.md`).
- Bucket C scoping (separate plan: `2026-05-09-bucket-c-scoping.md`).
- Documentation rewrite for `effortLevel` cadence (Task 4 is wording-only).
