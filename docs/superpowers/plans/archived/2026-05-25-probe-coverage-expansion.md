# Probe Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track three more Boris tips (42 Auto Mode, 41 PostCompact, 2 Opus usage) and add a drift-guard test so probe/citation desync can't silently recur.

**Architecture:** Three stacked PRs. PR1 lands the structured `borisTip` field + integrity tests + F1/F2/F3 fixes (guards first, so later probes are forced to register in the catalog). PR2 adds two settings-derived probes. PR3 adds a transcript Opus-usage scanner that gives `model-effort` its first Execution signal. Every probe follows the existing 5-layer touch: collect (`signals.mjs`/`_usage-data.mjs`) → forward (`run-assessment.mjs`) → predicate (`rubric.json`) → catalog (`probe-catalog.json`) → score (`score.mjs`).

**Tech Stack:** Node ESM (`.mjs`) scripts, Vitest, Next.js 16 dashboard (TSX). Test command: `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-05-25-probe-coverage-expansion-design.md`

---

## File structure

| File                                                               | Responsibility                                       | PR    |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ----- |
| `app/data/probe-catalog.json`                                      | probe registry (F5 guard target)                     | 1,2   |
| `app/data/rubric.json`                                             | `borisTip` fields, citation fixes, new next-actions  | 1,2   |
| `scripts/__tests__/rubric-integrity.test.mjs` (new)                | F5 drift guards                                      | 1     |
| `CLAUDE.md`                                                        | F1 tip-count fix; unmeasured-dim count               | 1,3   |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | audit-spec status updates                            | 1,2,3 |
| `scripts/run-assessment.mjs`                                       | forward `hasPostCompactHook`                         | 2     |
| `scripts/score.mjs`                                                | permissions `+10` credit; `model-effort` exec scorer | 2,3   |
| `scripts/_usage-data.mjs`                                          | Opus turn counts in `scanTranscriptModes`            | 3     |
| `scripts/insights-signals.mjs`                                     | aggregate `opusDominantSessionCount`                 | 3     |
| `scripts/__tests__/_fixtures.mjs`                                  | `makeSignals`/`makeInsights` new fields              | 2,3   |
| `scripts/__tests__/build-signals-summary.test.mjs`                 | `expectedKeys` + snapshot                            | 2     |
| `app/lib/__tests__/rubric-predicates.test.ts`                      | `ALL_SATISFIED_SIGNALS`                              | 2     |
| `app/methodology/page.tsx`                                         | unmeasured-dimension copy                            | 3     |

---

# PR1 — Drift guards + F1/F2/F3 fixes (Workstream A)

Branch: `feat/rubric-integrity-guards`. Test cmd: `npx vitest run`.

## Task 1: F2 — add `colorCommandUses` to the probe catalog

**Files:**

- Modify: `app/data/probe-catalog.json`

- [ ] **Step 1: Add the catalog entry**

Insert after the existing `compactCommandUses` entry (keep alphabetical-ish grouping with siblings):

```json
  "colorCommandUses": {
    "source": "history",
    "path": "~/.claude/history.jsonl + transcript MAX-merge",
    "description": "Count of /color invocations. Per-worktree prompt color so parallel sessions are distinguishable, Boris tip 40."
  },
```

- [ ] **Step 2: Verify valid JSON + entry present**

Run: `jq -e '.colorCommandUses.source == "history"' app/data/probe-catalog.json`
Expected: `true`

- [ ] **Step 3: Commit**

```bash
git add app/data/probe-catalog.json
git commit -m "fix(catalog): add colorCommandUses probe entry (F2)"
```

## Task 2: F3 — correct the four mislabeled Boris-tip citations

**Files:**

- Modify: `app/data/rubric.json`
- Modify: `app/data/probe-catalog.json`

- [ ] **Step 1: Fix the three rubric action citations**

In `app/data/rubric.json`, change each action's trailing citation:

- `code-review-plugin` action text: `(Boris tip 44)` → `(Boris tip 32)`
- `claude-in-chrome` action text: `Boris tip 32` → `Boris tip 51`
- `output-style-tuned` action text: `Boris tip 34` → `Boris tip 26`

- [ ] **Step 2: Fix the catalog spinner-verbs description**

In `app/data/probe-catalog.json`, `hasCustomSpinnerVerbs.description`: `Boris tip 4` → `Boris tip 25`.

- [ ] **Step 3: Verify the corrected numbers map to the right topics**

Run:

```bash
for n in 32 51 26 25; do jq -r --arg n "$n" '.tips[$n].topic' app/data/boris-tip-index.json; done
```

Expected (in order): `Code Review Agents`, `Chrome Extension`, `Output Styles`, `Spinner Verbs`

- [ ] **Step 4: Commit**

```bash
git add app/data/rubric.json app/data/probe-catalog.json
git commit -m "fix(rubric): correct mislabeled Boris-tip citations (F3)"
```

## Task 3: Add the structured `borisTip` field to every next-action

**Files:**

- Modify: `app/data/rubric.json`

- [ ] **Step 1: Add `borisTip` to each action and add the batch-sweep citation**

Add a `"borisTip"` key to every object in each dimension's `nextActions`, per this map. For `batch-sweep`, also append `" — Boris tip 30"` to its `action` text so prose and field agree.

```
hook-formatter:7   ship-command:5   verify-agent:[14,73]   stop-hook:13   simplify-skill:29
auto-mode-on:42   fewer-permission-prompts:69   wildcard-allowlist:20   fewer-perms-skill:69
effort-xhigh:[67,72]   effort-max-reflex:34   auto-compact-window:64
worktree-aliases:1   batch-sweep:30   agent-isolation:28
chrome-extension:51   go-reflex:73   branch-diff:10   code-review-plugin:32
auto-dream:45   rewind-reflex:62   claude-md-corrections:4   btw-side-channel:[33,54]
compact-clear-balance-compact:63   compact-clear-balance-clear:63
goal-constraints-template:66   plan-then-launch:65
vercel-cli:null   slack-mcp:9   claude-in-chrome:51   mcp-servers:9
per-worktree-color:40   focus-mode:71   spinner-verbs:25   voice-input:60
babysit-loop:48   stop-hook-notification:75   promote-routine:61
remote-control:47   ios-task:46   spaced-repetition-skill:15   output-style-tuned:26
```

Example (single + array + null):

```json
{ "id": "hook-formatter", "action": "Add a PostToolUse hook … — Boris tip 7", "effort": "10min", "satisfiedWhen": "hasFormatterHook", "borisTip": 7 },
{ "id": "verify-agent", "action": "Build one personal … — Boris tip 14/73", "effort": "30min", "satisfiedWhen": "hasVerifyAgent", "borisTip": [14, 73] },
{ "id": "vercel-cli", "action": "npm i -g vercel to unlock env/deploy/logs agentic flows", "effort": "5min", "satisfiedWhen": "hasVercelCli", "borisTip": null }
```

- [ ] **Step 2: Verify all 42 actions carry the key + valid JSON**

Run: `jq '[.dimensions[].nextActions[] | select(has("borisTip"))] | length' app/data/rubric.json`
Expected: `42`

- [ ] **Step 3: Commit**

```bash
git add app/data/rubric.json
git commit -m "feat(rubric): add structured borisTip field to next-actions"
```

## Task 4: F5 — the rubric-integrity test

**Files:**

- Create: `scripts/__tests__/rubric-integrity.test.mjs`

- [ ] **Step 1: Write the test (it must pass once Tasks 1-3 landed)**

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rubric = JSON.parse(
  readFileSync(join(process.cwd(), "app", "data", "rubric.json"), "utf8"),
);
const catalog = JSON.parse(
  readFileSync(
    join(process.cwd(), "app", "data", "probe-catalog.json"),
    "utf8",
  ),
);
const tipIndex = JSON.parse(
  readFileSync(
    join(process.cwd(), "app", "data", "boris-tip-index.json"),
    "utf8",
  ),
);

const actions = rubric.dimensions.flatMap((d) =>
  d.nextActions.map((a) => ({ ...a, dim: d.id })),
);

// Split a satisfiedWhen predicate into its LHS field names.
function lhsFields(predicate) {
  return predicate
    .split("&")
    .map((clause) => clause.trim().replace(/^!/, ""))
    .map((clause) => clause.split(/[<>=!~]/)[0].trim())
    .filter(Boolean);
}

// Parse every tip number out of a "Boris tip 14/73" / "tip 33+54" / "tip 67, 72" suffix.
function proseTips(text) {
  const m = text.match(/Boris tip\s+([\d/+,\s]+)/i);
  if (!m) return [];
  return [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]));
}

function tipSet(borisTip) {
  if (borisTip == null) return [];
  return Array.isArray(borisTip) ? borisTip : [borisTip];
}

describe("rubric integrity", () => {
  it("every satisfiedWhen LHS field has a probe-catalog entry", () => {
    const missing = [];
    for (const a of actions) {
      if (!a.satisfiedWhen) continue;
      for (const f of lhsFields(a.satisfiedWhen)) {
        if (!Object.prototype.hasOwnProperty.call(catalog, f)) {
          missing.push(`${a.dim}/${a.id}: ${f}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every borisTip is an integer in 1-75", () => {
    const bad = [];
    for (const a of actions) {
      for (const n of tipSet(a.borisTip)) {
        if (!Number.isInteger(n) || n < 1 || n > 75) {
          bad.push(`${a.dim}/${a.id}: ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("prose 'Boris tip N' citation matches the borisTip field", () => {
    const mismatches = [];
    for (const a of actions) {
      const prose = proseTips(a.action).sort((x, y) => x - y);
      const field = tipSet(a.borisTip).sort((x, y) => x - y);
      if (JSON.stringify(prose) !== JSON.stringify(field)) {
        mismatches.push(`${a.dim}/${a.id}: prose=[${prose}] field=[${field}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every borisTip resolves to a known topic (informational)", () => {
    for (const a of actions) {
      for (const n of tipSet(a.borisTip)) {
        expect(tipIndex.tips[String(n)]?.topic).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run and verify it passes**

Run: `npx vitest run scripts/__tests__/rubric-integrity.test.mjs`
Expected: PASS (4 tests). If "catalog entry" fails → Task 1 incomplete; if "prose matches" fails → Task 2/3 incomplete.

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/__tests__/rubric-integrity.test.mjs
git commit -m "test(rubric): add catalog-completeness + borisTip drift guards (F5)"
```

## Task 5: F1 — fix the tip-count in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit the count**

Change the project-memory line "scores Claude Code usage against Boris Cherny's 87 workflow tips" to "75 workflow tips".

- [ ] **Step 2: Verify**

Run: `grep -c "87 workflow tips" CLAUDE.md`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): correct Boris tip count 87 -> 75 (F1)"
```

## Task 6: Update the audit spec (F1/F2/F3/F5 resolved)

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1: Mark findings resolved**

In Part 3's findings table, change the Status of F1, F2, F3 to `resolved (PR1)` and F5 to `resolved (PR1)`. In Part 1, change the `colorCommandUses` Catalog cell from `❌ **missing**` to `✅`.

- [ ] **Step 2: Verify no stray "missing" for colorCommandUses**

Run: `grep -c "colorCommandUses.*missing" docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "docs(audit): mark F1/F2/F3/F5 resolved"
```

**PR1 ship:** run `/ship` (squash to `main`).

---

# PR2 — PostCompact + Auto Mode probes (Workstreams B + C)

Branch: `feat/postcompact-automode-probes` (base on PR1). Test cmd: `npx vitest run`.

## Task 7: PostCompact hook signal forwarding

**Files:**

- Modify: `scripts/run-assessment.mjs:165-168`
- Test: `scripts/__tests__/build-signals-summary.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `build-signals-summary.test.mjs` (the local `makeSignals` sets `hookEvents: ["Stop", "PostToolUse"]`):

```js
it("derives hasPostCompactHook from hookEvents membership", () => {
  expect(buildSignalsSummary(makeSignals()).hasPostCompactHook).toBe(false);
  const withPC = makeSignals({
    settings: {
      ...makeSignals().settings,
      hookEvents: ["Stop", "PostCompact"],
    },
  });
  expect(buildSignalsSummary(withPC).hasPostCompactHook).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/build-signals-summary.test.mjs -t "hasPostCompactHook"`
Expected: FAIL (`hasPostCompactHook` is undefined).

- [ ] **Step 3: Forward the derived field**

In `scripts/run-assessment.mjs`, inside `buildSignalsSummary`'s returned object, after the `permissionsDefaultMode` line (currently `:167`):

```js
    // Tip 41: PostCompact hook re-injects critical instructions after compaction.
    // Derived from the already-parsed hookEvents key list (signals.mjs).
    hasPostCompactHook: (signals.settings.hookEvents || []).includes("PostCompact"),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/build-signals-summary.test.mjs -t "hasPostCompactHook"`
Expected: PASS

- [ ] **Step 5: Update the key-set contract**

In `build-signals-summary.test.mjs`, add `"hasPostCompactHook"` to the `expectedKeys` array (after `"hasPostToolHook"`) and to the sorted inline snapshot (alphabetical position between `"hasPostToolHook"` and `"hasRemoteControl"`). Run `npx vitest run scripts/__tests__/build-signals-summary.test.mjs` and confirm green.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-assessment.mjs scripts/__tests__/build-signals-summary.test.mjs
git commit -m "feat(probes): derive hasPostCompactHook signal (tip 41)"
```

## Task 8: PostCompact next-action + catalog entry

**Files:**

- Modify: `app/data/rubric.json` (automation dimension)
- Modify: `app/data/probe-catalog.json`
- Modify: `app/lib/__tests__/rubric-predicates.test.ts`

- [ ] **Step 1: Add the next-action**

In `rubric.json`, append to the `automation` dimension's `nextActions`:

```json
{
  "id": "post-compact-hook",
  "action": "Add a PostCompact hook to re-inject critical instructions after context compaction — Boris tip 41",
  "effort": "15min",
  "satisfiedWhen": "hasPostCompactHook",
  "borisTip": 41
}
```

- [ ] **Step 2: Add the catalog entry**

In `probe-catalog.json`:

```json
  "hasPostCompactHook": {
    "source": "settings",
    "path": "~/.claude/settings.json → hooks.PostCompact",
    "description": "True if a PostCompact hook is defined (fires after context compaction to re-inject instructions), Boris tip 41."
  },
```

- [ ] **Step 3: Satisfy the predicate in the all-satisfied fixture**

In `rubric-predicates.test.ts` `ALL_SATISFIED_SIGNALS`, add `hasPostCompactHook: true,`.

- [ ] **Step 4: Run predicate + integrity tests**

Run: `npx vitest run app/lib/__tests__/rubric-predicates.test.ts scripts/__tests__/rubric-integrity.test.mjs`
Expected: PASS (the integrity test proves the new predicate's LHS has a catalog entry and the borisTip/prose agree).

- [ ] **Step 5: Commit**

```bash
git add app/data/rubric.json app/data/probe-catalog.json app/lib/__tests__/rubric-predicates.test.ts
git commit -m "feat(rubric): PostCompact hook next-action + catalog (tip 41)"
```

## Task 9: Auto-mode predicate wiring (`permissionsDefaultMode`)

**Files:**

- Modify: `app/data/rubric.json` (`auto-mode-on` action)
- Modify: `app/data/probe-catalog.json`
- Modify: `app/lib/__tests__/rubric-predicates.test.ts`

- [ ] **Step 1: Change the predicate**

In `rubric.json`, `auto-mode-on` action: `"satisfiedWhen": "!skipDangerous"` → `"satisfiedWhen": "permissionsDefaultMode=auto & !skipDangerous"`. (`borisTip` is already 42 from PR1.)

- [ ] **Step 2: Add the catalog entry**

```json
  "permissionsDefaultMode": {
    "source": "settings",
    "path": "~/.claude/settings.json → permissions.defaultMode",
    "description": "Permission default mode string. 'auto' is the auto-mode classifier (Boris tip 42); 'acceptEdits'/'default'/'plan' are the alternatives."
  },
```

- [ ] **Step 3: Satisfy the predicate in the all-satisfied fixture**

In `rubric-predicates.test.ts` `ALL_SATISFIED_SIGNALS`, add `permissionsDefaultMode: "auto",` (and confirm `skipDangerous: false` is already present — it is).

- [ ] **Step 4: Run predicate + integrity tests**

Run: `npx vitest run app/lib/__tests__/rubric-predicates.test.ts scripts/__tests__/rubric-integrity.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/data/rubric.json app/data/probe-catalog.json app/lib/__tests__/rubric-predicates.test.ts
git commit -m "feat(rubric): wire permissionsDefaultMode into auto-mode action (tip 42)"
```

## Task 10: Permissions Platform scorer `+10` auto-mode credit

**Files:**

- Modify: `scripts/score.mjs:81-120` (`permissions` scorer)
- Modify: `scripts/__tests__/_fixtures.mjs` (`makeSignals` settings)
- Test: `scripts/__tests__/score.test.mjs` (or the existing scorer test file)

- [ ] **Step 1: Add the field to the platform fixture**

In `_fixtures.mjs` `makeSignals`, inside `settings`, add `permissionsDefaultMode: null,` (default — most tests expect no auto credit).

- [ ] **Step 2: Write the failing test**

In the scorer test file:

```js
it("permissions: +10 when defaultMode is auto", () => {
  const base = SCORERS.permissions(
    makeSignals({
      settings: {
        ...makeSignals().settings,
        permissionsDefaultMode: "default",
      },
    }),
  ).score;
  const auto = SCORERS.permissions(
    makeSignals({
      settings: { ...makeSignals().settings, permissionsDefaultMode: "auto" },
    }),
  ).score;
  expect(auto - base).toBe(10);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run -t "defaultMode is auto"`
Expected: FAIL (delta is 0).

- [ ] **Step 4: Implement the credit**

In `scripts/score.mjs` `permissions(s)`, after the `skipDangerousModePermissionPrompt` if/else block (around `:93`), before the allowlist block:

```js
if (s.settings.permissionsDefaultMode === "auto") {
  score += 10;
  ev.push("permissions.defaultMode: auto — auto-mode classifier active");
}
```

- [ ] **Step 5: Run to verify it passes (and clamp note)**

Run: `npx vitest run -t "defaultMode is auto"`
Expected: PASS. Note: pre-clamp arithmetic; if a future fixture already sits at 100 the delta test still holds because the `default` baseline is below clamp.

- [ ] **Step 6: Full suite**

Run: `npx vitest run`
Expected: all pass (existing permissions tests use `permissionsDefaultMode: null` → unaffected).

- [ ] **Step 7: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/_fixtures.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): +10 permissions credit for auto defaultMode (tip 42)"
```

## Task 11: Update the audit spec (tips 41, 42 tracked)

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1: Flip the rows**

In Part 2, tip 41 status `📊` → `✅` (`hasPostCompactHook`); tip 42 already `✅` — update its probe cell to note `permissionsDefaultMode=auto` is now wired. Add `hasPostCompactHook` and `permissionsDefaultMode` to the Part 1 registry (settings layer, ✅ catalog). Re-derive the tally line (one tip moves 📊→✅: 47/12/2/14).

- [ ] **Step 2: Verify tally sums to 75**

Run: `grep -n "Tally" docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
Expected: the numbers add to 75.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "docs(audit): tips 41/42 now tracked"
```

**PR2 ship:** run `/ship`.

---

# PR3 — Opus execution scanner (Workstream D)

Branch: `feat/opus-execution-scanner` (base on PR2). Test cmd: `npx vitest run`.

## Task 12: `scanTranscriptModes` returns Opus turn counts

**Files:**

- Modify: `scripts/_usage-data.mjs:402-444`
- Test: `scripts/__tests__/scan-transcript-modes.test.mjs` (existing) or `scan-transcript-invocations.test.mjs`

- [ ] **Step 1: Write the failing test**

Using the existing modes-test harness (writes a temp `.jsonl`, calls `scanTranscriptModes(path)`):

```js
it("counts opus vs total assistant turns", async () => {
  const path = writeLines([
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-7" },
    }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-7" },
    }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-haiku-4-5" },
    }),
    JSON.stringify({ type: "user" }),
  ]);
  const r = await scanTranscriptModes(path);
  expect(r.assistantTurns).toBe(3);
  expect(r.opusAssistantTurns).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run -t "opus vs total assistant turns"`
Expected: FAIL (fields undefined).

- [ ] **Step 3: Implement the counters**

In `scripts/_usage-data.mjs` `scanTranscriptModes`, add before the loop:

```js
let assistantTurns = 0;
let opusAssistantTurns = 0;
```

Inside the `for await` loop, after the existing `if (entry.type === "assistant" && raw.includes("★ Insight "))` block:

```js
if (entry.type === "assistant") {
  assistantTurns += 1;
  const model = entry.message?.model;
  if (typeof model === "string" && /opus/i.test(model)) opusAssistantTurns += 1;
}
```

Change the return to include them:

```js
return {
  modes,
  hasWorktreeState,
  skills,
  learningModeMatches,
  assistantTurns,
  opusAssistantTurns,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run -t "opus vs total assistant turns"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/scan-transcript-modes.test.mjs
git commit -m "feat(usage): scanTranscriptModes returns opus turn counts (tip 2)"
```

## Task 13: Aggregate `opusDominantSessionCount` in insights

**Files:**

- Modify: `scripts/insights-signals.mjs:183-234`
- Test: `scripts/__tests__/insights-signals.test.mjs` (existing)

- [ ] **Step 1: Write the failing test**

Construct a usage-data fixture with two interactive sessions, one Opus-dominant (2 opus / 1 haiku) and one not (1 opus / 2 sonnet), then:

```js
const r = await gatherInsightsSignals({
  claudeHome,
  lookbackDays: 30,
  includeTranscripts: true,
});
expect(r.opusDominantSessionCount).toBe(1);
expect(r.opusModelMatchesTotal).toBe(3); // 2 + 1 opus turns, broad
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs -t "opusDominant"`
Expected: FAIL (`opusDominantSessionCount` undefined).

- [ ] **Step 3: Implement aggregation**

In `insights-signals.mjs`, in the transcripts-skipped `result` object (after `learningModeMatchesTotal: null,` at `:188`):

```js
    opusDominantSessionCount: null,
    opusModelMatchesTotal: null,
```

In the `if (includeTranscripts)` block, add initializers (after `let learningModeMatchesTotal = 0;` at `:197`):

```js
let opusDominantSessionCount = 0;
let opusModelMatchesTotal = 0;
```

Destructure from `scanTranscriptModes` (extend the existing destructure at `:201`):

```js
const {
  modes,
  hasWorktreeState,
  learningModeMatches,
  assistantTurns,
  opusAssistantTurns,
} = await scanTranscriptModes(path);
```

Inside the `if (isInteractive)` block (after the learning increment, before its closing brace at `:225`):

```js
// Tip 2: session is Opus-dominant when a strict majority of its
// assistant turns ran on Opus. Ties and zero-turn sessions are not
// dominant. Interactive-only (model choice is user posture).
if (assistantTurns > 0 && opusAssistantTurns * 2 > assistantTurns)
  opusDominantSessionCount += 1;
```

After the loop, broad total (mirrors `learningModeMatchesTotal`), and assign results (after `:234`):

```js
opusModelMatchesTotal += opusAssistantTurns;
```

```js
result.opusDominantSessionCount = opusDominantSessionCount;
result.opusModelMatchesTotal = opusModelMatchesTotal;
```

(Place the `opusModelMatchesTotal +=` line next to the existing `learningModeMatchesTotal += learningModeMatches;` so it runs for all sessions, not only interactive.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs -t "opusDominant"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/insights-signals.mjs scripts/__tests__/insights-signals.test.mjs
git commit -m "feat(insights): aggregate opusDominantSessionCount (tip 2)"
```

## Task 14: `model-effort` Execution scorer

**Files:**

- Modify: `scripts/score.mjs:826` (replace `"model-effort": noTelemetry()`)
- Modify: `scripts/__tests__/_fixtures.mjs` (`makeInsights`)
- Test: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Add the new fields to `makeInsights` (default null)**

In `_fixtures.mjs` `makeInsights` base, after `learningModeMatchesTotal: null,`:

```js
    opusDominantSessionCount: null,
    opusModelMatchesTotal: null,
```

- [ ] **Step 2: Write the failing test**

```js
it("model-effort execution: opus-dominant ratio", () => {
  const ex = EXECUTION_SCORERS["model-effort"](
    makeSignals({
      insights: makeInsights({
        transcriptsScanned: true,
        interactiveSessionsAnalyzed: 10,
        opusDominantSessionCount: 8,
        opusModelMatchesTotal: 40,
      }),
    }),
  );
  expect(ex.score).toBe(80);
  expect(ex.gapReason).toBe(null);
});

it("model-effort execution: unmeasured without transcripts", () => {
  const ex = EXECUTION_SCORERS["model-effort"](
    makeSignals({
      insights: makeInsights({ transcriptsScanned: false }),
    }),
  );
  expect(ex.score).toBe(null);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "model-effort execution"`
Expected: FAIL (currently returns `NO_TELEMETRY_FOR_DIMENSION`, score null for both — the ratio test fails).

- [ ] **Step 4: Implement the scorer**

In `scripts/score.mjs`, replace the line `"model-effort": noTelemetry(),` with:

```js
  // Tip 2: Opus-dominant session ratio. The MODEL half of "Model & Effort" —
  // effort level is not logged per-turn, so it stays settings-only/unmeasured.
  // Universe interactive_only: model choice is user posture.
  "model-effort": withGates(
    { transcripts: true, universe: "interactive_only" },
    (s) => {
      const {
        opusDominantSessionCount,
        opusModelMatchesTotal,
        interactiveSessionsAnalyzed,
      } = s.insights;
      if (opusDominantSessionCount == null)
        return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
      const ratio = opusDominantSessionCount / interactiveSessionsAnalyzed;
      const score = clamp(Math.round(ratio * 100));
      const evidence = [
        `Opus-dominant in ${opusDominantSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(ratio * 100)}%) — ${opusModelMatchesTotal} Opus assistant turns total`,
      ];
      const gaps = [];
      if (ratio < 0.5)
        gaps.push(
          "Opus-dominant in fewer than half of interactive sessions — Boris tip 2",
        );
      return { score, evidence, gaps, gapReason: null };
    },
  ),
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "model-effort execution"`
Expected: PASS (ratio 8/10 → 80; null insights.opus → null).

- [ ] **Step 6: Full suite (watch executionOverall tests)**

Run: `npx vitest run`
Expected: all pass. Existing `scoreAll`/`executionOverall` tests use `makeInsights` with `opusDominantSessionCount: null` → `model-effort` exec stays null → excluded from the average exactly as before. If any test set `transcriptsScanned: true` AND a non-null opus count, update its expected `executionOverall`.

- [ ] **Step 7: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/_fixtures.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): model-effort execution scorer from Opus usage (tip 2)"
```

## Task 15: Methodology + CLAUDE.md doc updates

**Files:**

- Modify: `app/methodology/page.tsx:188-207`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the methodology section**

In `app/methodology/page.tsx`:

- Section title `:188`: "Why the remaining 3 dimensions are unmeasured" → "Why the remaining 2 dimensions are unmeasured".
- `:190`: "Three dimensions render with no Execution vertex." → "Two dimensions render with no Execution vertex."
- `:196-198`: remove `<strong>Model &amp; Effort Tuning</strong>,{" "}` from the list (keep Memory & Context and Terminal & Customization). Add a sentence: "Model & Effort is now <em>partially</em> measured — Opus-usage (tip 2) is scored from transcripts; effort level remains settings-only."

- [ ] **Step 2: Update CLAUDE.md scoring-model note**

In `CLAUDE.md`, the "Nine of twelve dims have Execution scorers. The remaining three (Model & Effort, Memory & Context, Terminal & Customization) route to unmeasured" → "Ten of twelve dims have Execution scorers. The remaining two (Memory & Context, Terminal & Customization) route to unmeasured. Model & Effort is partially measured (Opus usage; effort stays settings-only)."

- [ ] **Step 3: Verify the build typechecks**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/methodology/page.tsx CLAUDE.md
git commit -m "docs: model-effort now partially measured (Opus usage, tip 2)"
```

## Task 16: Final audit-spec update (tip 2 tracked, F4 + counts)

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1: Update the audit**

- Part 2 tip 2: status `📊` → `✅`, probe `opusDominantSessionCount (exec)`, axis `P+E`; change its "exec unmeasured" note.
- Part 1: add the insights signals `opusDominantSessionCount`/`opusModelMatchesTotal` to the insights table; flip `model-effort` out of the "No Execution scorer" list.
- Part 3 F4: note `model-effort` is no longer fully unmeasured (now 2 unmeasured dims, not 3).
- Re-derive the Part 2 tally (tip 2 moves 📊→✅).

- [ ] **Step 2: Verify**

Run: `grep -n "Tally\|unmeasured" docs/superpowers/specs/2026-05-25-probe-implementation-status.md | head`
Expected: tally sums to 75; unmeasured count reads 2.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "docs(audit): tip 2 tracked, model-effort partially measured"
```

**PR3 ship:** run `/ship`. After merge, run `npm run assess -- --include-transcripts` and confirm `model-effort` shows an Execution vertex on the radar.

---

## Self-review notes (for the implementer)

- **Score movement is expected** (PR2 permissions `+10`; PR3 adds `model-effort` to `executionOverall`). Capture `npm run assess` before/after each and confirm the swing matches the change; calibrate only if surprised.
- **Run order matters in PR1:** Task 4's integrity test only passes after Tasks 1-3. The full suite (`npx vitest run`) is the gate before each `/ship`.
- **Opus dominance edge cases** are pinned: ties (`opusAssistantTurns*2 > assistantTurns` is strict `>`), zero-turn sessions (`assistantTurns > 0` guard), interactive-only universe.
