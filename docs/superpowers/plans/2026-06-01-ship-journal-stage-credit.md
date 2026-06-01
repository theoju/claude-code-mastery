# Ship-journal stage credit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credit `/ship` Stage 2 (verify-agent) and Stage 3 (simplify) dispatches in the scorer's `shipVerifyStageRecent` and `simplifyCommandUses` signals across all three `~/.claude/ship/journal.jsonl` format generations — singular `entry.stage`, legacy-numeric `stages_run`, and new-string `stages_run`. Today's `gatherShipJournal` reads only the oldest format and undercounts ~41% of journal entries; a user with `/ship` deeply integrated still scores `simplifyCommandUses=0`.

**Architecture:** A new pure helper `stageRanInEntry(entry, legacyNumber, newName)` in `scripts/signals.mjs` collapses the three format detections into one `Array.includes`-strict-equality check. `gatherShipJournal` consumes it for both `stage2Count` (now broader) and a new `simplifyStageCount`. The `simplifyCommandUses` projection in `scripts/run-assessment.mjs` MAX-merges the journal counter alongside the existing transcript + history sources, mirroring the v0.9.16 `/color` pattern. `shipVerifyStageRecent` automatically inherits the widened `stage2Count` — no projection change.

**Tech Stack:** Node.js 20, vitest, ESM. All paths absolute.

**Spec:** [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md)

**Ticket:** [CCE-72](https://designitright.atlassian.net/browse/CCE-72)

---

## File structure

**Modified:**

- [/Users/theo/Projects/claude-extensions/scripts/signals.mjs](/Users/theo/Projects/claude-extensions/scripts/signals.mjs) — export `stageRanInEntry`, widen `gatherShipJournal` return shape to include `simplifyStageCount`, swap the `entry.stage === 2` check for `stageRanInEntry(entry, 2, "verify-agent")`, add the parallel `simplifyStageCount` counter via `stageRanInEntry(entry, 3, "simplify")`, update the VITEST guard + missing-file fallback to include `simplifyStageCount: 0`, change the call site at line 765 to pass `insightsLookbackDays`.
- [/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs](/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs) — change line 142's `simplifyCommandUses` projection to MAX-merge `signals.shipJournal?.simplifyStageCount ?? 0` alongside `maxProbe(signals, "simplifyCommandUses")`.
- [/Users/theo/Projects/claude-extensions/scripts/\_\_tests\_\_/gather-ship-journal.test.mjs](/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs) — update line 26's `toEqual({...})` assertion to include the new `simplifyStageCount: 0` field; append 6 fixture tests (Tests 1-6) + a new sub-describe for `stageRanInEntry` (Test 7, six sub-cases).
- [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md) — annotate Settings/Journal layer header (`shipVerifyStageRecent` row) and Transcripts layer (`simplify` row) with the `[^journal-stage-credit]` footnote; append the footnote definition at the end of Part 1.
- [/Users/theo/Projects/claude-extensions/CLAUDE.md](/Users/theo/Projects/claude-extensions/CLAUDE.md) — add one bullet under `## Conventions` for the `stageRanInEntry` pattern + CCE-72 reference.

**Created:** none. The branch already carries the design spec at commit 58455ba.

---

## Task 1: `stageRanInEntry` helper + pure-function tests (Test 7)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/signals.mjs` (insert immediately above `export async function gatherShipJournal` at line 532)
- Test: `/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs` (append a new `describe` block at end of file)

- [ ] **Step 1: Write the failing pure-function tests for `stageRanInEntry` (Test 7, six sub-cases)**

Append to `/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs` after the existing closing `});` (line 73):

```js
import { stageRanInEntry } from "../signals.mjs";

describe("stageRanInEntry", () => {
  it("matches singular entry.stage equal to legacy number", () => {
    expect(stageRanInEntry({ stage: 3 }, 3, "simplify")).toBe(true);
  });

  it("rejects singular entry.stage that does not equal legacy number", () => {
    expect(stageRanInEntry({ stage: 99 }, 3, "simplify")).toBe(false);
  });

  it("matches legacy-numeric stages_run array containing legacy number", () => {
    expect(stageRanInEntry({ stages_run: [0, 1, 3, 4] }, 3, "simplify")).toBe(
      true,
    );
  });

  it("matches new-string stages_run array containing new name", () => {
    expect(
      stageRanInEntry(
        { stages_run: ["test", "verify-agent", "simplify"] },
        3,
        "simplify",
      ),
    ).toBe(true);
  });

  it("rejects string '3' against integer 3 (type-strict includes)", () => {
    expect(stageRanInEntry({ stages_run: ["3"] }, 3, "simplify")).toBe(false);
  });

  it("returns false for null / non-object / missing-fields input without throwing", () => {
    expect(stageRanInEntry(null, 3, "simplify")).toBe(false);
    expect(stageRanInEntry(undefined, 3, "simplify")).toBe(false);
    expect(stageRanInEntry("not-an-object", 3, "simplify")).toBe(false);
    expect(stageRanInEntry({}, 3, "simplify")).toBe(false);
    expect(stageRanInEntry({ stages_run: "not-an-array" }, 3, "simplify")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/__tests__/gather-ship-journal.test.mjs`
Expected: existing 4 tests pass; new 6 tests fail with `stageRanInEntry is not a function` (or `Module has no exported member 'stageRanInEntry'`) at import time.

- [ ] **Step 3: Add the `stageRanInEntry` helper to `scripts/signals.mjs`**

Insert the following block immediately ABOVE the line `// Reads ~/.claude/ship/journal.jsonl line by line. Counts stage:2 entries` (the comment that introduces `gatherShipJournal` at roughly line 525):

```js
// Detects whether a /ship stage RAN, regardless of journal format generation.
// Three format generations exist in ~/.claude/ship/journal.jsonl:
//   1. entry.stage === legacyNumber           (oldest, single-stage entries)
//   2. entry.stages_run.includes(legacyNumber) (intermediate, numeric array)
//   3. entry.stages_run.includes(newName)      (latest, string-named array)
// Array.prototype.includes uses strict equality so a string "3" never
// matches the integer 3 — no defensive code needed.
//
// Stage-number / -name mapping (canonical; future stages append to end):
//   0 pre-flight | 1 test | 2 verify-agent | 3 simplify | 4 code-review
//   5 commit     | 6 push-pr | 7 jira-update
export function stageRanInEntry(entry, legacyNumber, newName) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.stage === legacyNumber) return true;
  const sr = entry.stages_run;
  if (Array.isArray(sr)) {
    return sr.includes(legacyNumber) || sr.includes(newName);
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/gather-ship-journal.test.mjs`
Expected: 10 tests pass (4 existing + 6 new pure-function sub-cases).

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: full suite passes (baseline + 6 = pass; no regressions in unrelated tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/gather-ship-journal.test.mjs
git commit -m "$(cat <<'EOF'
feat(signals): add stageRanInEntry helper for ship-journal format detection

Pure helper that returns true if a /ship stage ran, across all three
journal format generations: singular entry.stage, legacy-numeric
stages_run array, and new-string stages_run array. Array.includes is
type-strict so "3" never matches integer 3.

Stage-number / -name mapping documented inline; future stages append
to the end of the workflow.

Six unit tests cover each detector arm plus null / non-object / missing-
field / wrong-shape inputs.

Refs CCE-72.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `gatherShipJournal` with `simplifyStageCount` + fixture tests (Tests 1-6)

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/signals.mjs:532-565` (`gatherShipJournal` body)
- Test: `/Users/theo/Projects/claude-extensions/scripts/__tests__/gather-ship-journal.test.mjs` (update line 26's `toEqual` shape; append 6 fixture tests inside the existing `describe("gatherShipJournal", …)`)

- [ ] **Step 1: Write the failing fixture tests (Tests 1-6) and update the existing line-26 assertion**

First, update the existing test at line 20-27. The current assertion is:

```js
expect(r).toEqual({ stage2Count: 0, totalRuns: 0, lastRunAt: null });
```

`toEqual` does deep equality on the full object shape, so adding `simplifyStageCount` to the return value would break this test. Change the assertion to:

```js
expect(r).toEqual({
  stage2Count: 0,
  simplifyStageCount: 0,
  totalRuns: 0,
  lastRunAt: null,
});
```

(This adjustment is part of the same task — it co-evolves with the function's contract widening.)

Then append the following six `it` blocks immediately before the closing `});` of the existing `describe("gatherShipJournal", …)` block (just before line 73):

```js
// --- CCE-72 fixture tests ----------------------------------------------

it("Test 1: singular entry.stage===3 counts toward simplifyStageCount", async () => {
  writeJournal([`{"ts":"2026-05-10T01:00:00Z","stage":3}`]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 14,
  });
  expect(r.simplifyStageCount).toBe(1);
  expect(r.stage2Count).toBe(0);
});

it("Test 2: legacy-numeric stages_run [0,1,2,3,4,5,6,7] counts both verify and simplify", async () => {
  writeJournal([
    `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","stages_run":[0,1,2,3,4,5,6,7]}`,
  ]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 14,
  });
  expect(r.stage2Count).toBe(1);
  expect(r.simplifyStageCount).toBe(1);
});

it("Test 3: new-string stages_run counts both verify and simplify", async () => {
  writeJournal([
    `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","stages_run":["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}`,
  ]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 14,
  });
  expect(r.stage2Count).toBe(1);
  expect(r.simplifyStageCount).toBe(1);
});

it("Test 4: mixed-format journal sums correctly across all three formats", async () => {
  writeJournal([
    `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
    `{"ts":"2026-05-10T02:00:00Z","outcome":"shipped","stages_run":[0,1,2,3]}`,
    `{"ts":"2026-05-10T03:00:00Z","outcome":"shipped","stages_run":["simplify"]}`,
  ]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 14,
  });
  expect(r.stage2Count).toBe(2);
  expect(r.simplifyStageCount).toBe(2);
});

it("Test 5: regression — singular stage===2 entries continue to count", async () => {
  writeJournal([
    `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
    `{"ts":"2026-05-10T02:00:00Z","stage":2}`,
  ]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 14,
  });
  expect(r.stage2Count).toBe(2);
  expect(r.simplifyStageCount).toBe(0);
});

it("Test 6: entries outside the lookback window are excluded for both counters", async () => {
  writeJournal([
    `{"ts":"2026-04-01T00:00:00Z","stage":3}`,
    `{"ts":"2026-05-10T05:00:00Z","stage":3}`,
  ]);
  const r = await gatherShipJournal({
    journalPath: join(dir, "journal.jsonl"),
    now: new Date("2026-05-10T12:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.simplifyStageCount).toBe(1);
});
```

- [ ] **Step 2: Run the file to verify the new tests fail and the existing ones still pass**

Run: `npx vitest run scripts/__tests__/gather-ship-journal.test.mjs`

Expected:

- `stageRanInEntry` describe block (6 tests from Task 1): pass.
- Existing `gatherShipJournal` `"returns zeros…"` test (line 20-27): **fail** — `toEqual` now expects `simplifyStageCount: 0` but the function still returns `{stage2Count, totalRuns, lastRunAt}` without it.
- Existing `"counts stage===2…"` (line 29) + `"counts outcome==='shipped'…"` (line 44) + `"skips malformed lines…"` (line 59): pass — they read fields, not full shape.
- New Tests 1-6: **fail** — `r.simplifyStageCount` is `undefined`, not the expected count.

This is the red phase. Confirm the failures match expectations before proceeding.

- [ ] **Step 3: Update `gatherShipJournal` in `scripts/signals.mjs`**

Apply the following four edits to `/Users/theo/Projects/claude-extensions/scripts/signals.mjs`:

(a) Update the VITEST-guard return at line 535-537 to include `simplifyStageCount`:

```js
if (process.env.VITEST && !options.journalPath) {
  return {
    stage2Count: 0,
    simplifyStageCount: 0,
    totalRuns: 0,
    lastRunAt: null,
  };
}
```

(b) Update the missing-file fallback at line 547 to match:

```js
try {
  raw = await readFile(journalPath, "utf8");
} catch {
  return {
    stage2Count: 0,
    simplifyStageCount: 0,
    totalRuns: 0,
    lastRunAt: null,
  };
}
```

(c) Replace the counter block at line 550-564 with a `simplifyStageCount` accumulator and the format-aware detector calls:

```js
const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
let stage2Count = 0;
let simplifyStageCount = 0;
let totalRuns = 0;
let lastRunAt = null;
for (const line of raw.split("\n")) {
  const entry = parseJournalLine(line);
  if (!entry || typeof entry.ts !== "string") continue;
  const t = Date.parse(entry.ts);
  if (Number.isNaN(t) || t < cutoff) continue;
  if (stageRanInEntry(entry, 2, "verify-agent")) stage2Count++;
  if (stageRanInEntry(entry, 3, "simplify")) simplifyStageCount++;
  if (entry.outcome === "shipped") {
    totalRuns++;
    if (!lastRunAt || entry.ts > lastRunAt) lastRunAt = entry.ts;
  }
}
return { stage2Count, simplifyStageCount, totalRuns, lastRunAt };
```

(d) Update the leading docstring comment (lines 525-531) so it reflects the widened contract:

```js
// Reads ~/.claude/ship/journal.jsonl line by line. Counts stage 2
// (verify-agent) and stage 3 (simplify) executions and outcome:"shipped"
// entries within the lookback window. Stage execution is detected across
// all three journal format generations via stageRanInEntry. Empty/missing
// file returns all zeros. Malformed lines are skipped silently — same
// fault tolerance as parseJournalLine.
//
// Inputs are injected (journalPath, now) so tests can drive temp files
// without monkey-patching globals.
```

- [ ] **Step 4: Run the gather-ship-journal test file to confirm all tests pass**

Run: `npx vitest run scripts/__tests__/gather-ship-journal.test.mjs`
Expected: 16 tests pass (4 existing gatherShipJournal + 6 stageRanInEntry from Task 1 + 6 new fixture tests from Task 2).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: full suite passes. No other test in the repo references the journal return shape directly (verified via `grep -rn "stage2Count" scripts/ app/`).

- [ ] **Step 6: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/gather-ship-journal.test.mjs
git commit -m "$(cat <<'EOF'
feat(signals): credit ship-journal stages 2 + 3 across all format generations

gatherShipJournal now uses stageRanInEntry for both stage2Count and a
new simplifyStageCount, detecting stage execution across:
  - singular entry.stage (oldest)
  - legacy-numeric stages_run array
  - new-string stages_run array

VITEST guard and missing-file fallback return the widened shape with
simplifyStageCount: 0.

Six fixture tests cover the three format generations, mixed-format
sums, the existing singular-stage regression case, and lookback-
window exclusion. Existing line-26 toEqual assertion widened in lock-
step with the new return shape.

Refs CCE-72.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Lookback alignment + projection MAX-merge

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/signals.mjs:765` (call site — pass `insightsLookbackDays`)
- Modify: `/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:142` (`simplifyCommandUses` projection)

- [ ] **Step 1: Update the production call site at `signals.mjs:765`**

Locate the current line:

```js
const shipJournal = await gatherShipJournal({ lookbackDays: 14 });
```

Replace with:

```js
const shipJournal = await gatherShipJournal({
  lookbackDays: insightsLookbackDays,
});
```

The variable `insightsLookbackDays` is already in scope in `gatherSignals` (it's the parameter passed in from `run-assessment.mjs`, defaulting to 30). Confirm scope with: `grep -n "insightsLookbackDays" scripts/signals.mjs | head -5` (expect the function param + multiple uses).

The function's own parameter default `lookbackDays = 14` at line 541 stays — no breaking change for any other caller, only the one production call site widens.

- [ ] **Step 2: Update the `simplifyCommandUses` projection at `run-assessment.mjs:142`**

Locate the current line:

```js
simplifyCommandUses: maxProbe(signals, "simplifyCommandUses"),
```

Replace with:

```js
simplifyCommandUses: Math.max(
  maxProbe(signals, "simplifyCommandUses"),
  signals.shipJournal?.simplifyStageCount ?? 0,
),
```

`shipVerifyStageRecent` at line 121 stays untouched — it already reads `signals.shipJournal?.stage2Count`, which now reflects the widened semantic automatically. Same for `shipsRecent` at line 122.

- [ ] **Step 3: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: full suite passes. The lookback change does not affect fixture tests (they pass `lookbackDays` explicitly). The projection change does not break any existing assertion (no test pins `simplifyCommandUses` to a transcript-only value).

- [ ] **Step 4: Confirm `assessment.json` writes a non-zero `simplifyCommandUses` from the journal**

Run:

```bash
npm run assess -- --no-slack --print > /tmp/cce72-quick-smoke.txt 2>&1
node -e 'console.log(JSON.parse(require("fs").readFileSync("app/data/assessment.json","utf8")).signalsSummary.simplifyCommandUses)'
```

Expected: a number > 0 if the developer's `~/.claude/ship/journal.jsonl` contains any Stage-3 entries within `insightsLookbackDays` (30 by default). If 0, that's still a valid local state — but on the author's environment (52 Stage-3 entries in the 14-day window, per the spec) it should be ≥ 52.

This is a sanity probe, not an assertion. The full pre/post delta capture lives in Task 6.

- [ ] **Step 5: Commit**

```bash
git add scripts/signals.mjs scripts/run-assessment.mjs
git commit -m "$(cat <<'EOF'
feat(scoring): MAX-merge ship-journal simplifyStageCount + align lookback

run-assessment's simplifyCommandUses projection now reads from three
sources via Math.max: transcript-invocations, history-invocations, and
the newly-exposed ship-journal simplifyStageCount. This credits users
whose /simplify runs as /ship Stage 3 (subagent dispatch) and never
emits the literal <command-name>/simplify</command-name> markup.

signals.mjs's production gatherShipJournal call site widens from a
hardcoded 14-day lookback to insightsLookbackDays (default 30), so
journal-derived signals align with transcript-derived ones. The
parameter default stays 14 to preserve test-injection contracts.

shipVerifyStageRecent and shipsRecent automatically inherit the
broader stage2Count / totalRuns semantics — no projection change.

Refs CCE-72.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Probe-tracker footnote

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1: Locate the affected rows in Part 1**

Run:

```bash
grep -n "shipVerifyStageRecent\|simplifyCommandUses\|Settings.*Journal\|Transcripts" docs/superpowers/specs/2026-05-25-probe-implementation-status.md | head -30
```

Identify the Part 1 registry rows for `shipVerifyStageRecent` (under the Settings/Journal layer) and `simplifyCommandUses` (under the Transcripts layer). The five header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys) stay **unchanged** for this PR — no new probes / catalog entries / signalsSummary keys.

- [ ] **Step 2: Append `[^journal-stage-credit]` to the two affected rows**

In each of the two rows identified in Step 1, append the footnote anchor `[^journal-stage-credit]` after the signal name (or wherever the spec's row layout places per-row annotations — match the partition footnote precedent from PR #110 if other rows already carry footnote anchors).

If neither row carries an existing footnote, the cleanest placement is in the "Notes" or final column of each row; if the row is too narrow, anchor the layer header (`Settings/Journal[^journal-stage-credit]` / `Transcripts[^journal-stage-credit]`) and reference both signals from the footnote body.

- [ ] **Step 3: Add the footnote definition at the end of Part 1**

Append at the end of Part 1 (before the `---` separator that opens Part 2):

```markdown
[^journal-stage-credit]:
    As of PR #N (CCE-72, spec 2026-06-01), `gatherShipJournal` counts
    stage execution across all three journal format generations:
    singular `entry.stage`, legacy-numeric `stages_run`, and new-string
    `stages_run`. `simplifyCommandUses` is MAX-merged with the journal's
    `simplifyStageCount` at the projection layer (run-assessment.mjs).
    `shipVerifyStageRecent` consumes the now-broader `stage2Count`
    automatically. The five machine-enforced header counts are
    unchanged (no new probes / catalog entries / signalsSummary keys).
```

Literal `PR #N` is intentional — swapped pre-merge in Task 7 Step 6.

- [ ] **Step 4: Run the tracker-counts test to confirm no count drift**

Run: `npx vitest run scripts/__tests__/tracker-counts.test.mjs`
Expected: 5/5 PASS. The five machine-enforced header counts (75 / 12 / 48 / 47 / 71) are unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "$(cat <<'EOF'
docs(probe-tracker): annotate ship-journal + simplify rows for CCE-72

shipVerifyStageRecent (Settings/Journal layer) and simplifyCommandUses
(Transcripts layer) now honor the journal format-aware stage detector
introduced in PR #N. No new probes, catalog entries, or signalsSummary
keys — the five machine-enforced header counts are unchanged
(75/12/48/47/71).

Refs CCE-72.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CLAUDE.md Conventions bullet

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/CLAUDE.md` (`## Conventions` section)

- [ ] **Step 1: Locate the Conventions section anchor**

Run: `grep -n "^## Conventions" CLAUDE.md`

The new bullet appends to the end of the Conventions block (just before the next top-level `##` section, typically `## Issue tracking`).

- [ ] **Step 2: Append the new bullet**

Add the following bullet at the end of the `## Conventions` section, immediately before the next `## ` heading:

```markdown
- **Ship-journal counters use `stageRanInEntry()` to detect stage
  execution across all three journal format generations** (singular
  `entry.stage`, legacy-numeric `stages_run`, new-string `stages_run`).
  Adding a new stage counter follows this pattern — see CCE-72 / PR #N
  for the reference implementation. The canonical stage-number /
  -name mapping lives inline in `scripts/signals.mjs::stageRanInEntry`
  (stages 0–7: pre-flight, test, verify-agent, simplify, code-review,
  commit, push-pr, jira-update). New stages append to the end of the
  workflow, never insert in the middle, so the numeric detector arm
  stays stable.
```

(Literal `PR #N` is swapped pre-merge in Task 7 Step 6.)

- [ ] **Step 3: Verify the file still reads cleanly**

Run: `grep -A 3 "Ship-journal counters" CLAUDE.md`
Expected: shows the new bullet's first three lines, no stray duplicated text.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(memory): record stageRanInEntry pattern for ship-journal counters

Adds a Conventions bullet pointing future readers at the format-aware
detector for /ship Stage X credit. Canonical stage-number / -name
mapping is anchored to scripts/signals.mjs::stageRanInEntry, with the
"new stages append to end" assumption documented so the numeric
detector arm stays stable across schema evolution.

Refs CCE-72.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Live verification — capture pre/post deltas

**Files:**

- Read-only: `/Users/theo/Projects/claude-extensions/app/data/assessment.json` (gitignored, written by `npm run assess`)

- [ ] **Step 1: Snapshot the pre-PR baseline (worktree-primary path)**

By the time Task 6 runs, Tasks 1-5 have already committed
`scripts/signals.mjs`, `scripts/run-assessment.mjs`, the test file,
the probe-tracker, and CLAUDE.md. `git stash` against those files
would not isolate them cleanly. Use a temporary worktree at `main` to
measure the pre-fix state directly:

```bash
git worktree add /tmp/cce72-baseline-wt main
(cd /tmp/cce72-baseline-wt && npm install --silent && npm run assess -- --include-transcripts --insights-lookback 30 --print --no-slack > /tmp/cce72-baseline.txt 2>&1)
git worktree remove /tmp/cce72-baseline-wt
```

> **`npm run assess` flag forwarding:** the single `--` after `assess`
> tells npm to pass everything after it directly to the script
> (`node scripts/run-assessment.mjs`). Writing
> `npm run assess --include-transcripts -- --print` would cause npm to
> swallow `--include-transcripts` and only the post-`--` flags would
> reach the script, silently invalidating the delta capture.

- [ ] **Step 2: Snapshot the post-PR state**

Run from the feature branch with Tasks 1-5 committed:

```bash
npm run assess -- --include-transcripts --insights-lookback 30 --print --no-slack > /tmp/cce72-post.txt 2>&1
```

- [ ] **Step 3: Extract and compare `simplifyCommandUses` and `shipVerifyStageRecent`**

Run:

```bash
grep -E "simplifyCommandUses|shipVerifyStageRecent|shipsRecent" /tmp/cce72-baseline.txt > /tmp/cce72-targets-before.txt
grep -E "simplifyCommandUses|shipVerifyStageRecent|shipsRecent" /tmp/cce72-post.txt > /tmp/cce72-targets-after.txt
diff /tmp/cce72-targets-before.txt /tmp/cce72-targets-after.txt
```

Expected on the author's environment (per spec §Cost & blast radius):

- `simplifyCommandUses`: 0 (baseline) → ≥ 52 (post). Direction: **up** — formerly false negative.
- `shipVerifyStageRecent`: small (singular-format only) → larger (now reflects all three formats). Direction: **up**.
- `shipsRecent`: changes if the lookback widening (14 → 30) captures more `outcome:"shipped"` entries. May go up; no down direction expected.

On a different developer's environment the numbers will differ; what matters is that all three direction-changes match: up or flat, never down (the fix only adds signal, never subtracts).

- [ ] **Step 4: Compare the score deltas (Execution axis is the one that moves)**

Run:

```bash
grep -E "Platform Setup|Execution|Verification|Automation" /tmp/cce72-baseline.txt > /tmp/cce72-scores-before.txt
grep -E "Platform Setup|Execution|Verification|Automation" /tmp/cce72-post.txt > /tmp/cce72-scores-after.txt
diff /tmp/cce72-scores-before.txt /tmp/cce72-scores-after.txt
```

Expected: Verification (Execution side) bumps up modestly thanks to the widened `shipVerifyStageRecent`; Automation may bump if the `simplify-skill` predicate flips. Platform Setup is unchanged. No dimension regresses.

- [ ] **Step 5: Confirm the top-N priority list no longer flags `/simplify`**

Run:

```bash
grep -A 10 "Top 3 priority\|next.actions\|rankedNextActions" /tmp/cce72-baseline.txt > /tmp/cce72-top3-before.txt
grep -A 10 "Top 3 priority\|next.actions\|rankedNextActions" /tmp/cce72-post.txt > /tmp/cce72-top3-after.txt
diff /tmp/cce72-top3-before.txt /tmp/cce72-top3-after.txt
```

OR directly inspect the satisfied-predicate state:

```bash
node -e 'const s = JSON.parse(require("fs").readFileSync("app/data/assessment.json","utf8")); console.log("simplifyCommandUses =", s.signalsSummary.simplifyCommandUses); console.log("rankedNextActions includes simplify-skill?", s.rankedNextActions?.some(a => a.id?.includes("simplify-skill")) ?? "n/a");'
```

Expected: post-fix, `simplifyCommandUses > 0` and `automation/simplify-skill` is absent from the top-N (its predicate `simplifyCommandUses>=1` is now satisfied).

- [ ] **Step 6: Save the captured deltas to the PR notes file**

```bash
cat > /tmp/cce72-pr-notes.txt <<'EOF'
## Summary

**CCE-72** · https://designitright.atlassian.net/browse/CCE-72

Credit `/ship` Stage 2 (verify-agent) and Stage 3 (simplify) dispatches across all three journal format generations. The existing `gatherShipJournal` reads only `entry.stage === 2`, missing ~41% of journal entries (the entire `stages_run` cohort) — so a user with `/ship` deeply integrated still scores `simplifyCommandUses=0`.

A new pure helper `stageRanInEntry(entry, legacyNumber, newName)` collapses the three detections into one `Array.includes` strict-equality check. `gatherShipJournal` uses it for both `stage2Count` (widened) and a new `simplifyStageCount`. `run-assessment.mjs` MAX-merges the journal counter into the `simplifyCommandUses` projection, mirroring the v0.9.16 `/color` pattern. `shipVerifyStageRecent` inherits the widened `stage2Count` automatically — no projection change.

The lookback at the production call site widens from 14 → `insightsLookbackDays` (30), aligning journal-derived signals with transcript-derived ones.

## Spec + plan

- Spec: `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-ship-journal-stage-credit.md`

## Live-verification deltas (npm run assess --include-transcripts --insights-lookback 30)

### Target signals (pre → post)

EOF
diff /tmp/cce72-targets-before.txt /tmp/cce72-targets-after.txt >> /tmp/cce72-pr-notes.txt
cat >> /tmp/cce72-pr-notes.txt <<'EOF'

### Score deltas (Verification + Automation are the moves)

EOF
diff /tmp/cce72-scores-before.txt /tmp/cce72-scores-after.txt >> /tmp/cce72-pr-notes.txt
cat >> /tmp/cce72-pr-notes.txt <<'EOF'

### Top-N priority list (simplify-skill exits)

EOF
diff /tmp/cce72-top3-before.txt /tmp/cce72-top3-after.txt >> /tmp/cce72-pr-notes.txt
cat >> /tmp/cce72-pr-notes.txt <<'EOF'

## Test plan

- [x] `npx vitest run scripts/__tests__/gather-ship-journal.test.mjs` — 16 tests pass (4 existing + 6 stageRanInEntry + 6 fixture)
- [x] `npx vitest run` — full suite passes
- [x] `npx vitest run scripts/__tests__/tracker-counts.test.mjs` — 5/5 pass (no probe-set drift; five header counts at 75/12/48/47/71)
- [x] Live `npm run assess --include-transcripts --insights-lookback 30` from baseline-main worktree and feature branch — pre/post deltas above confirm `simplifyCommandUses` and `shipVerifyStageRecent` move up (never down)

## Files

- `scripts/signals.mjs` — `stageRanInEntry` helper export + widened `gatherShipJournal` (stage2Count widened semantic + new simplifyStageCount + VITEST/missing-file fallback shapes) + production call site widened from 14 → insightsLookbackDays
- `scripts/run-assessment.mjs` — `simplifyCommandUses` projection MAX-merges `signals.shipJournal?.simplifyStageCount ?? 0`
- `scripts/__tests__/gather-ship-journal.test.mjs` — 12 new tests (6 stageRanInEntry sub-cases + 6 fixture tests) + line-26 `toEqual` widened
- `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — `[^journal-stage-credit]` footnote on shipVerifyStageRecent + simplifyCommandUses rows
- `CLAUDE.md` — Conventions bullet for `stageRanInEntry` pattern + CCE-72 reference
- `docs/superpowers/specs/2026-06-01-ship-journal-stage-credit-design.md` — design spec (committed in 58455ba)
- `docs/superpowers/plans/2026-06-01-ship-journal-stage-credit.md` — implementation plan

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

(This file feeds `/ship` Stage 6 — `gh pr create --body-file /tmp/cce72-pr-notes.txt`. Required because the PR body discusses block-destructive-pattern-adjacent strings that `block-destructive.sh` would otherwise reject if passed via heredoc.)

- [ ] **Step 7: No commit (live-verification artifacts are local-only)**

The captured `/tmp/cce72-*.txt` files are not committed. The PR body file is consumed by `/ship` in Task 7.

---

## Task 7: `/ship` the PR (with Jira transition)

**Files:** none directly — the `/ship` chain handles staging, commit, push, PR, Jira.

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --short`
Expected: no uncommitted changes. Tasks 1-5 each committed their own changes; Task 6 wrote to `/tmp/` only.

- [ ] **Step 2: Confirm branch and base**

Run: `git branch --show-current && git log --oneline main..HEAD`
Expected: `feat/CCE-72-ship-journal-stage-credit`; six commits visible — the design spec (58455ba) plus five feature commits from Tasks 1-5.

- [ ] **Step 3: Invoke /ship**

In Claude Code, type:

```
/ship --body-file /tmp/cce72-pr-notes.txt
```

The chain handles Stages 0-7 (pre-flight, cost gate, test, verify-agent, simplify, code review, commit-skip if already committed, push, PR open, Jira transition).

- [ ] **Step 4: At Stage 6 (push + PR), confirm the PR notes file is consumed**

`/ship` Stage 6 should invoke `gh pr create` with `--body-file /tmp/cce72-pr-notes.txt` (forwarded from the slash-command flag in Step 3). If the chain instead generates its own body, **stop and dispatch `gh pr create` manually** with the notes file:

```bash
gh pr create --base main --title "feat(scoring): credit /ship Stage 2 + 3 across journal format generations — CCE-72" --body-file /tmp/cce72-pr-notes.txt
```

- [ ] **Step 5: At Stage 7 (Jira), transition CCE-72 to In Progress**

`extract-jira-key.sh` reads the branch name `feat/CCE-72-ship-journal-stage-credit` and should yield `CCE-72`. The `/ship` chain then:

1. Posts a comment to CCE-72 with the PR URL.
2. Transitions CCE-72 from `Backlog` (current state) → `In Progress`.

If `extract-jira-key.sh` returns exit 1 (no key detected — e.g., if the branch name doesn't match its regex), dispatch the comment + transition manually via the Atlassian MCP. The user has explicitly directed Jira integration ("the ship command says always use JIRA!" from the CCE-71 cycle).

After the PR squash-merges, the user (or a follow-up turn) transitions CCE-72 from `In Progress` → `Done`. **Do NOT pre-emptively transition to Done before merge** — auto-mode authorization for Jira writes is scoped per action, not per session (CLAUDE.md hard rule).

- [ ] **Step 6: Pre-merge: swap `PR #N` placeholders on the feature branch**

The probe-tracker footnote (Task 4 Step 3) and the CLAUDE.md Conventions bullet (Task 5 Step 2) both contain literal `PR #N` placeholders. Once `gh pr create` returns the PR number, run on the feature branch BEFORE the squash-merge:

```bash
PR_NUM=$(gh pr view --json number -q '.number')
sed -i '' "s/PR #N/PR #${PR_NUM}/g" docs/superpowers/specs/2026-05-25-probe-implementation-status.md CLAUDE.md
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md CLAUDE.md
git commit -m "docs: replace PR #N placeholders with actual PR number (CCE-72)"
git push
```

This keeps the merged commit on `main` fully self-describing. Doing it post-merge would require a follow-up PR. Note: `sed -i ''` is the macOS/BSD form; if running on Linux, drop the `''` argument.

- [ ] **Step 7: After squash-merge, sync local main and confirm CCE-72 is ready for Done transition**

```bash
gh pr view --json state,mergeCommit
git fetch --prune
git checkout main
git merge --ff-only origin/main
git worktree list  # confirm feature-branch worktree (if any) is clean
git branch -d feat/CCE-72-ship-journal-stage-credit  # local cleanup
```

Then dispatch the CCE-72 `In Progress` → `Done` transition via the Atlassian MCP (the user must authorize this write, per the per-action Jira authorization rule).

---

## Self-review notes

Spec coverage check completed:

- §Architecture §1 (stageRanInEntry helper) → Task 1 Step 3
- §Architecture §2 (gatherShipJournal widening + VITEST guard + missing-file fallback) → Task 2 Steps 3 a/b/c/d
- §Architecture §3 (lookback alignment at signals.mjs:765) → Task 3 Step 1
- §Architecture §4 (MAX-merge projection at run-assessment.mjs:142) → Task 3 Step 2
- §Architecture §5 (probe-tracker footnote) → Task 4
- §Architecture §6 (CLAUDE.md Conventions bullet) → Task 5
- §Tests 1-6 → Task 2 Step 1 (the six new `it` blocks)
- §Test 7 (six sub-cases for stageRanInEntry) → Task 1 Step 1
- §Error handling (no module-load assertion, optional-chaining defense) → encoded in Task 1 Step 3 (stageRanInEntry's defensive null/type guards) and Task 3 Step 2 (`?? 0`)
- §Acceptance criteria "All 7 new tests pass (1-6 + Test 7's six sub-cases)" → Tasks 1-2 collectively land 12 new tests; full suite confirms in Task 2 Step 5 and Task 3 Step 3
- §Acceptance criteria "Live verification capture" → Task 6
- §Acceptance criteria "simplify-skill exits the top-10" → Task 6 Step 5
- §Acceptance criteria "tracker-counts test passes" → Task 4 Step 4

Type-consistency check: `stageRanInEntry`, `simplifyStageCount`, `stage2Count`, `shipJournal`, `gatherShipJournal`, `insightsLookbackDays`, `maxProbe`, `shipVerifyStageRecent`, `simplifyCommandUses`, `shipsRecent` — all named identically across tasks. The stage-number / -name mapping (0 pre-flight, 1 test, 2 verify-agent, 3 simplify, …) is repeated in Task 1 Step 3 (inline comment), Task 5 Step 2 (CLAUDE.md bullet), and the spec — same form everywhere.

Placeholder scan: only the literal `PR #N` placeholders for the probe-tracker footnote (Task 4 Step 3) and CLAUDE.md (Task 5 Step 2). These are intentional — they get replaced pre-merge in Task 7 Step 6.

No "TBD", "TODO", "fill in details", or vague "implement appropriately" phrases. Every code block contains complete code that runs as-is. Every `Expected:` line cites observable output (test name, number of passes, grep matches).
