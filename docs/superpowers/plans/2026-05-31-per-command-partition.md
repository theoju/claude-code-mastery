# Per-command partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop posture-command counters in `scanTranscriptInvocations` from inflating when an observer session quotes the primary session's `<command-name>` markup, while preserving broad volume-command counting so autonomous-workflow signal (`/loop`, `/schedule`, `/babysit`) survives across SDK and observer contexts.

**Architecture:** Two module-level Sets (`POSTURE_COMMANDS`, `VOLUME_COMMANDS`) gate posture counters behind a per-session `allowPosture` flag computed from `classifySessionKind`. A fail-loud `assertCommandPartition` helper runs at module load and catches any drift between the partition and `TARGET_COMMANDS`. Volume-command counters stay structurally unchanged.

**Tech Stack:** Node.js 20, vitest, ESM. All paths absolute.

**Spec:** [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-31-per-command-partition-design.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-31-per-command-partition-design.md)

---

## File structure

**Modified:**

- [/Users/theo/Projects/claude-extensions/scripts/\_usage-data.mjs](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs) — add Sets, `assertCommandPartition` export, module-load call, and per-session `allowPosture` gate inside `scanTranscriptInvocations`.
- [/Users/theo/Projects/claude-extensions/scripts/**tests**/\_usage-data.test.mjs](/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs) — append 10 new `it` blocks (Test 7's four assertion cases + Tests 1-6 fixtures).
- [/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md](/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md) — annotate Transcripts-layer posture rows with the partition footnote.
- [/Users/theo/Projects/claude-extensions/CLAUDE.md](/Users/theo/Projects/claude-extensions/CLAUDE.md) — rewrite the "Known limitation / deferred follow-up" paragraph; add canonical-Sets pointer to Conventions; add fail-loud operational note.

**Created:** none.

---

## Task 1: Sets, partition helper, and module-load assertion

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:406-418` (insert before `PLANNING_SKILL_COMMANDS`)
- Test: `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs` (append new `describe` block at end of file)

- [ ] **Step 1: Write the failing tests for `assertCommandPartition`**

Append to `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs` (after the existing final `describe`):

```js
import {
  POSTURE_COMMANDS,
  VOLUME_COMMANDS,
  TARGET_COMMANDS,
  assertCommandPartition,
} from "../_usage-data.mjs";

describe("assertCommandPartition (Test 7)", () => {
  it("throws when posture and volume overlap (disjointness violation)", () => {
    const posture = new Set(["color", "loop"]); // 'loop' shouldn't be here
    const volume = new Set(["loop", "schedule"]);
    const target = new Set(["color", "loop", "schedule"]);
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      /must be disjoint/,
    );
  });

  it("throws when a TARGET_COMMANDS member is missing from the partition", () => {
    const posture = new Set(["color"]);
    const volume = new Set(["loop"]);
    const target = new Set(["color", "loop", "voice"]); // 'voice' uncategorized
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      /not classified as posture or volume/,
    );
  });

  it("throws when a partition member is missing from TARGET_COMMANDS (dead classification)", () => {
    const posture = new Set(["color", "obsolete-cmd"]); // 'obsolete-cmd' dead
    const volume = new Set(["loop"]);
    const target = new Set(["color", "loop"]);
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      /dead classification/,
    );
  });

  it("does not throw against the live Sets (happy path)", () => {
    expect(() =>
      assertCommandPartition(
        POSTURE_COMMANDS,
        VOLUME_COMMANDS,
        TARGET_COMMANDS,
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "assertCommandPartition"`
Expected: All four FAIL with import error (`POSTURE_COMMANDS`, `VOLUME_COMMANDS`, `TARGET_COMMANDS`, `assertCommandPartition` are not exported).

- [ ] **Step 3: Add the Sets and the helper to `_usage-data.mjs`**

In `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs`, locate line 99 (`const TARGET_COMMANDS = new Set([`). Change it to `export const TARGET_COMMANDS = new Set([` (the constant exists today as module-private; the helper test needs it exported).

Then, immediately before line 406 (`const PLANNING_SKILL_COMMANDS = new Set([`), insert:

```js
// Per-command partition (see docs/superpowers/specs/2026-05-31-per-command-partition-design.md).
// POSTURE_COMMANDS are user-posture signals that observer/SDK sessions
// frequently echo via <command-name> markup but did not actually invoke;
// they are gated behind allowPosture in scanTranscriptInvocations.
// VOLUME_COMMANDS represent autonomous-workflow volume that is real
// regardless of who fired it (subagents/SDK runs etc.); they stay
// unconditional.
export const POSTURE_COMMANDS = new Set([
  "color",
  "voice",
  "focus",
  "btw",
  "clear",
  "compact",
  "simplify",
  "rewind",
  "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop",
  "schedule",
  "babysit",
  "go",
  "batch",
]);

// Fail-loud module-load guard. Catches three drift cases:
//   1. posture ∩ volume ≠ ∅ (overlap)
//   2. TARGET ⊄ posture ∪ volume (uncategorized scanned command)
//   3. posture ∪ volume ⊄ TARGET (dead classification — member not scanned)
// Factored out as an exported function so vitest can test it against
// forged Sets without import-cache games (see Test 7).
export function assertCommandPartition(posture, volume, target) {
  const union = new Set([...posture, ...volume]);
  if (posture.size + volume.size !== union.size) {
    throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
  }
  for (const cmd of target) {
    if (!union.has(cmd)) {
      throw new Error(
        `TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`,
      );
    }
  }
  for (const cmd of union) {
    if (!target.has(cmd)) {
      throw new Error(
        `Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`,
      );
    }
  }
}

assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "assertCommandPartition"`
Expected: 4/4 PASS.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: 622 + 4 = 626 PASS (or current baseline + 4). If a pre-existing test fails, stop — the assertion fired at module load and surfaces a real drift.

- [ ] **Step 6: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/_usage-data.test.mjs
git commit -m "$(cat <<'EOF'
feat(scoring): add POSTURE/VOLUME command partition + fail-loud assertion

Two module-level Sets (POSTURE_COMMANDS, VOLUME_COMMANDS) codify the
documented posture-vs-volume split that lived as a deferred follow-up
in CLAUDE.md. assertCommandPartition runs at module load and catches
three drift cases: disjointness, TARGET ⊇ partition, partition ⊆ TARGET.

No behavior change yet — Task 2 wires the gate into the per-session
loop. This commit is purely additive infrastructure plus its 4 unit
tests.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Session-kind gate inside `scanTranscriptInvocations`

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:289-329` (top of per-session loop + per-command counters)
- Test: `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs` (append a new `describe` block)

- [ ] **Step 1: Write the failing fixture tests (Tests 1-6 + Test 8)**

Append to `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs`:

```js
import { scanTranscriptInvocations } from "../_usage-data.mjs";

describe("scanTranscriptInvocations — per-command partition", () => {
  let tmpHome2;

  beforeEach(() => {
    tmpHome2 = mkdtempSync(join(tmpdir(), "partition-test-"));
  });

  afterEach(() => {
    rmSync(tmpHome2, { recursive: true, force: true });
  });

  function writeSessionFile(projectDirName, fileName, lines) {
    const projectDir = join(tmpHome2, "projects", projectDirName);
    mkdirSync(projectDir, { recursive: true });
    const path = join(projectDir, fileName);
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return path;
  }

  it("Test 1: posture command in observer session does NOT count", async () => {
    writeSessionFile(
      "-Users-theo--claude-mem-observer-sessions",
      "obs1.jsonl",
      [
        { type: "user", entrypoint: "sdk-cli", userType: "external" },
        {
          type: "user",
          timestamp: "2026-05-30T00:00:00Z",
          message: {
            role: "user",
            content: "<command-name>/color</command-name>",
          },
        },
      ],
    );
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.colorCommandUses).toBe(0);
  });

  it("Test 2: volume command in observer session DOES count", async () => {
    writeSessionFile(
      "-Users-theo--claude-mem-observer-sessions",
      "obs2.jsonl",
      [
        { type: "user", entrypoint: "sdk-cli", userType: "external" },
        {
          type: "user",
          timestamp: "2026-05-30T00:00:00Z",
          message: {
            role: "user",
            content: "<command-name>/loop</command-name>",
          },
        },
      ],
    );
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.loopCommandUses).toBe(1);
  });

  it("Test 3: posture command in SDK-orchestrated session does NOT count", async () => {
    writeSessionFile(
      "-Users-theo-Projects-engineering-docs-agent",
      "sdk1.jsonl",
      [
        { type: "user", entrypoint: "sdk-cli", userType: "external" },
        {
          type: "user",
          timestamp: "2026-05-30T00:00:00Z",
          message: {
            role: "user",
            content: "<command-name>/color</command-name>",
          },
        },
      ],
    );
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.colorCommandUses).toBe(0);
  });

  it("Test 4: volume command in SDK-orchestrated session DOES count", async () => {
    writeSessionFile(
      "-Users-theo-Projects-engineering-docs-agent",
      "sdk2.jsonl",
      [
        { type: "user", entrypoint: "sdk-cli", userType: "external" },
        {
          type: "user",
          timestamp: "2026-05-30T00:00:00Z",
          message: {
            role: "user",
            content: "<command-name>/loop</command-name>",
          },
        },
      ],
    );
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.loopCommandUses).toBe(1);
  });

  it("Test 5: posture command in interactive session DOES count", async () => {
    writeSessionFile("-Users-theo-Projects-foo", "interactive1.jsonl", [
      { type: "user", entrypoint: "cli", userType: "external" },
      {
        type: "user",
        timestamp: "2026-05-30T00:00:00Z",
        message: {
          role: "user",
          content: "<command-name>/color</command-name>",
        },
      },
    ]);
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.colorCommandUses).toBe(1);
  });

  it("Test 6: unknown entrypoint falls back to interactive (posture counts)", async () => {
    writeSessionFile("-Users-theo-Projects-bar", "unknown1.jsonl", [
      { type: "noise", n: 0 },
      { type: "noise", n: 1 },
      {
        type: "user",
        timestamp: "2026-05-30T00:00:00Z",
        message: {
          role: "user",
          content: "<command-name>/color</command-name>",
        },
      },
    ]);
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.colorCommandUses).toBe(1);
  });

  it("Test 8: existing interactive fixtures retain expected counts (regression)", async () => {
    // Two interactive sessions, one with /color + /loop, one with /focus.
    // Pre-partition baseline: color=1, loop=1, focus=1.
    // Post-partition (allowPosture=true for entrypoint=cli): identical.
    writeSessionFile("-Users-theo-Projects-a", "a.jsonl", [
      { type: "user", entrypoint: "cli", userType: "external" },
      {
        type: "user",
        timestamp: "2026-05-30T00:00:00Z",
        message: {
          role: "user",
          content:
            "<command-name>/color</command-name> <command-name>/loop</command-name>",
        },
      },
    ]);
    writeSessionFile("-Users-theo-Projects-b", "b.jsonl", [
      { type: "user", entrypoint: "cli", userType: "external" },
      {
        type: "user",
        timestamp: "2026-05-30T00:00:00Z",
        message: {
          role: "user",
          content: "<command-name>/focus</command-name>",
        },
      },
    ]);
    const counts = await scanTranscriptInvocations({
      homeDir: tmpHome2,
      cutoff: null,
    });
    expect(counts.colorCommandUses).toBe(1);
    expect(counts.loopCommandUses).toBe(1);
    expect(counts.focusCommandUses).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify Tests 1, 3 fail (posture-suppression) while 2, 4, 5, 6, 8 pass or fail variably**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "per-command partition"`
Expected:

- Tests 1, 3 FAIL (posture command in observer/SDK currently counts as 1, expected 0).
- Tests 2, 4 PASS (volume currently unconditional).
- Tests 5, 6, 8 PASS (interactive/unknown not affected by partition today).

(If Tests 2/4 fail, double-check the fixture's transcript shape — the `entrypoint: "sdk-cli"` must be on the first JSONL line for `classifySessionKind` to detect it.)

- [ ] **Step 3: Wire the session-kind gate into `scanTranscriptInvocations`**

In `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs`, modify the per-session loop starting at line 289.

Insert immediately after `for (const path of sessionFiles) {` (line 289):

```js
// Per-command partition (spec 2026-05-31): observer and SDK-orchestrated
// sessions echo the primary session's <command-name> markup, falsely
// inflating posture counters. Volume commands stay unconditional —
// autonomous-workflow signal is real regardless of who fires it.
// Note: classifySessionKind also returns "subagent" for paths matching
// .../subagents/agent-*.jsonl, but the traversal at line 263-278 reads
// projectsRoot/*/*.jsonl (depth 2) and subagent transcripts live at
// depth 4, so they are unreachable here. A future traversal that
// recurses must add `if (sessionKind === "subagent") continue` here.
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Then replace the existing slash-command extraction block at lines 311-329:

```js
const uText = userMessageText(line);
if (uText) {
  const found = extractSlashCommands(uText);
  // Volume commands — counted across all session kinds the scanner sees.
  if (found.has("go")) counts.goCommandUses++;
  if (found.has("batch")) counts.batchCommandUses++;
  if (found.has("schedule")) counts.scheduleCommandUses++;
  if (found.has("loop")) sessionHasLoop = true;
  if (found.has("babysit")) sessionHasBabysit = true;
  // Posture commands — counted only when allowPosture is true
  // (interactive_cli or unknown — the conservative fallback).
  if (found.has("focus") && allowPosture) counts.focusCommandUses++;
  if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;
  if (found.has("simplify") && allowPosture) sessionHasSimplify = true;
  if (found.has("btw") && allowPosture) sessionHasBtw = true;
  if (found.has("voice") && allowPosture) sessionHasVoice = true;
  if (found.has("clear") && allowPosture) sessionHasClear = true;
  if (found.has("compact") && allowPosture) sessionHasCompact = true;
  if (found.has("color") && allowPosture) sessionHasColor = true;
  if (found.has("fewer-permission-prompts") && allowPosture)
    sessionHasFewerPerms = true;
  // effortMax detection uses regex over the prompt text, not
  // <command-name> markup, so it sits outside the partition.
  if (hasEffortMax(uText)) sessionHasEffortMax = true;
}
```

- [ ] **Step 4: Run the partition-test block to confirm pass**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "per-command partition"`
Expected: 7/7 PASS (Tests 1, 2, 3, 4, 5, 6, 8).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: 626 + 7 = 633 PASS (or current baseline after Task 1 + 7). If any pre-existing test fails, stop and inspect — interactive fixtures should be unaffected (`entrypoint: "cli"` → `allowPosture = true`; missing entrypoint → `"unknown"` → `allowPosture = true`).

- [ ] **Step 6: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/_usage-data.test.mjs
git commit -m "$(cat <<'EOF'
feat(scoring): gate posture-command counters behind session-kind partition

scanTranscriptInvocations now classifies each session via
classifySessionKind and only counts posture commands when the
session kind is interactive_cli or unknown. Volume commands
(loop/schedule/babysit/go/batch) stay unconditional — the
v0.9.17 regression that lost ~12 /loop signal is avoided.

Fixes the documented "Known limitation" in CLAUDE.md (the
observer-session false-positive for posture commands like /color
that the history MAX-merge was masking) without re-introducing the
SDK-orchestrated volume-signal drop.

Six new fixture tests cover all session-kind paths:
  Test 1: posture in observer → 0
  Test 2: volume in observer → 1
  Test 3: posture in sdk_orchestrated → 0
  Test 4: volume in sdk_orchestrated → 1
  Test 5: posture in interactive_cli → 1
  Test 6: posture in unknown (fallback) → 1
  Test 8: regression — existing interactive expectations unchanged

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Probe-tracker footnote

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [ ] **Step 1: Locate the Part 1 Transcripts layer rows for posture commands**

Run: `grep -n "color\|voice\|btw\|clear\|compact\|simplify\|focus\|rewind\|fewer-permission-prompts" docs/superpowers/specs/2026-05-25-probe-implementation-status.md | head -30`

The Part 1 registry has a "Transcripts" layer section with one row per command-derived signal. Identify the rows for the nine posture commands. Note: the table header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys) stay **unchanged** for this PR (no new probes added).

- [ ] **Step 2: Add a single footnote anchor to the Transcripts header**

In the Part 1 Transcripts layer section header line, add a footnote marker (e.g., `[^partition]`) immediately after "Transcripts".

- [ ] **Step 3: Add the footnote definition at the end of Part 1**

Append at the end of the Part 1 section:

```markdown
[^partition]:
    As of PR #N (spec 2026-05-31), the nine posture commands
    listed below (`color`, `voice`, `focus`, `btw`, `clear`, `compact`,
    `simplify`, `rewind`, `fewer-permission-prompts`) are counted from
    transcripts only when `classifySessionKind` returns `interactive_cli`
    or `unknown`. Observer and SDK-orchestrated sessions still echo the
    primary session's `<command-name>` markup but no longer inflate
    posture counters. The five volume commands (`loop`, `schedule`,
    `babysit`, `go`, `batch`) remain counted across every scanned
    session kind. See `scripts/_usage-data.mjs` `POSTURE_COMMANDS` /
    `VOLUME_COMMANDS` for the canonical partition.
```

(Replace `PR #N` with the actual PR number after `/ship` opens the PR; this can be a follow-up edit on the same branch.)

- [ ] **Step 4: Run the tracker-counts test to confirm no count drift**

Run: `npx vitest run scripts/__tests__/tracker-counts.test.mjs`
Expected: 5/5 PASS. The five machine-enforced header counts are unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "$(cat <<'EOF'
docs(probe-tracker): annotate Transcripts layer with partition footnote

The nine posture-command rows now honor the session-kind partition
introduced in PR #N. No new probes, catalog entries, or signalsSummary
keys — the five machine-enforced header counts are unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: CLAUDE.md "Known limitation" rewrite

**Files:**

- Modify: `/Users/theo/Projects/claude-extensions/CLAUDE.md` (search for "Command counting has the same posture-vs-volume split")

- [ ] **Step 1: Locate the paragraph**

Run: `grep -n "Command counting has the same posture-vs-volume split" CLAUDE.md`

This is in the Hard rules section. The current text (roughly lines 158-178) describes the deferred fix as a Known Limitation.

- [ ] **Step 2: Rewrite the paragraph**

Replace the entire bullet (the one starting with `**Command counting has the same posture-vs-volume split as ratio universes — don't blanket-exclude session kinds.**`) with:

```markdown
- **Command counting honors the posture-vs-volume partition** —
  `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in
  [/Users/theo/Projects/claude-extensions/scripts/\_usage-data.mjs](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs)
  are the canonical source of truth. Posture commands (`/color`,
  `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`,
  `/rewind`, `/fewer-permission-prompts`) are counted from transcripts
  only when `classifySessionKind` returns `interactive_cli` or
  `"unknown"` (the conservative fallback). Volume commands (`/loop`,
  `/schedule`, `/babysit`, `/go`, `/batch`) are counted across every
  scanned session kind — autonomous-workflow signal is real regardless
  of which session emitted it. A fail-loud `assertCommandPartition`
  runs at module load and catches drift (disjointness, missing
  classification, dead classification). **Historical context (do not
  delete — future readers triaging similar regressions need it):**
  v0.9.17 originally attempted a blanket "exclude observer/sdk/subagent
  from `scanTranscriptInvocations`" fix and regressed `scheduled` 75→63
  by deleting genuine autonomous-workflow signal. It was reverted; the
  per-command partition (PR #N) is the correct shape — posture is
  filtered, volume is preserved. **Operational note:** if
  `npm run assess` exits non-zero with no `assessment.json` written,
  check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition
  errors from the boundary assertion before assuming an environmental
  issue.
```

(Replace `PR #N` with the actual PR number after `/ship` opens the PR; this can be a follow-up edit on the same branch.)

- [ ] **Step 3: Verify the file still reads cleanly**

Run: `grep -A 3 "Command counting honors" CLAUDE.md`
Expected: shows the new paragraph header and first three lines, no stray duplicated text.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(memory): resolve Known limitation — per-command partition shipped

Rewrite the CLAUDE.md hard rule that documented the
posture-vs-volume split as a deferred follow-up. The partition
now lives in scripts/_usage-data.mjs as POSTURE_COMMANDS /
VOLUME_COMMANDS, enforced at module load by assertCommandPartition.
The historical v0.9.17 regression context is preserved as a
"do not delete" note for future readers triaging similar
"blanket exclusion regressed volume signal" bugs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Live verification — capture pre/post deltas

**Files:**

- Read-only: `/Users/theo/Projects/claude-extensions/app/data/assessment.json` (gitignored, written by `npm run assess`)

- [ ] **Step 1: Snapshot the pre-PR baseline**

The branch was created from a known-good main (PR #108 merged at `6de3da9`). Before this branch's changes land in production, `npm run assess` against current `~/.claude` reflects the **post-partition** state. To capture the pre-PR baseline, briefly stash the working-tree changes and run:

```bash
git stash push -m "partition-task5-baseline" -- scripts/_usage-data.mjs scripts/__tests__/_usage-data.test.mjs
npm run assess --include-transcripts --insights-lookback 30 -- --print --no-slack > /tmp/partition-baseline.txt 2>&1
git stash pop
```

(If there's no actual diff vs main on `scripts/_usage-data.mjs` at this point in the plan — e.g., you've already committed Tasks 1-2 — instead checkout main into a worktree just for this measurement:
`git worktree add /tmp/partition-baseline-wt main && cd /tmp/partition-baseline-wt && npm run assess --include-transcripts --insights-lookback 30 -- --print --no-slack > /tmp/partition-baseline.txt 2>&1 && cd - && git worktree remove /tmp/partition-baseline-wt`.)

- [ ] **Step 2: Snapshot the post-PR state**

Run from the feature branch with Tasks 1-4 committed:

```bash
npm run assess --include-transcripts --insights-lookback 30 -- --print --no-slack > /tmp/partition-post.txt 2>&1
```

- [ ] **Step 3: Extract and compare `rewindCommandUses` specifically**

Run:

```bash
grep -E "rewindCommandUses|colorCommandUses|btwCommandUses|voiceCommandUses|clearCommandUses|compactCommandUses|simplifyCommandUses|focusCommandUses|fewerPermsCommandUses" /tmp/partition-baseline.txt > /tmp/partition-posture-before.txt
grep -E "rewindCommandUses|colorCommandUses|btwCommandUses|voiceCommandUses|clearCommandUses|compactCommandUses|simplifyCommandUses|focusCommandUses|fewerPermsCommandUses" /tmp/partition-post.txt > /tmp/partition-posture-after.txt
diff /tmp/partition-posture-before.txt /tmp/partition-posture-after.txt
```

Expected: posture counters trend **down or flat**. `rewindCommandUses` is the highest-risk delta (no history MAX-merge floor); confirm it stays ≥ 1 so the `rewindCommandUses >= 1` predicate stays satisfied.

- [ ] **Step 4: Extract and compare volume counters**

Run:

```bash
grep -E "loopCommandUses|scheduleCommandUses|babysitCommandUses|goCommandUses|batchCommandUses" /tmp/partition-baseline.txt > /tmp/partition-volume-before.txt
grep -E "loopCommandUses|scheduleCommandUses|babysitCommandUses|goCommandUses|batchCommandUses" /tmp/partition-post.txt > /tmp/partition-volume-after.txt
diff /tmp/partition-volume-before.txt /tmp/partition-volume-after.txt
```

Expected: **no diff**. Volume counters are unchanged by the partition.

- [ ] **Step 5: Compare the top-3 priority list**

Run:

```bash
grep -A 5 "Top 3 priority" /tmp/partition-baseline.txt > /tmp/partition-top3-before.txt
grep -A 5 "Top 3 priority" /tmp/partition-post.txt > /tmp/partition-top3-after.txt
diff /tmp/partition-top3-before.txt /tmp/partition-top3-after.txt
```

If the top-3 reorders, that's fine — note the new ordering in the PR description so the user understands the user-facing change.

- [ ] **Step 6: Save the captured deltas to the PR notes file**

```bash
cat > /tmp/partition-pr-notes.txt <<'EOF'
=== POSTURE deltas (pre → post) ===
EOF
diff /tmp/partition-posture-before.txt /tmp/partition-posture-after.txt >> /tmp/partition-pr-notes.txt
cat >> /tmp/partition-pr-notes.txt <<'EOF'

=== VOLUME (must be 0 diff) ===
EOF
diff /tmp/partition-volume-before.txt /tmp/partition-volume-after.txt >> /tmp/partition-pr-notes.txt
cat >> /tmp/partition-pr-notes.txt <<'EOF'

=== Top-3 priority list deltas ===
EOF
diff /tmp/partition-top3-before.txt /tmp/partition-top3-after.txt >> /tmp/partition-pr-notes.txt
```

(This file feeds `/ship` Stage 6 — `gh pr create --body-file /tmp/partition-pr-notes.txt`. Required because the PR body discusses partition-related strings that `block-destructive.sh` would otherwise reject if passed via heredoc.)

- [ ] **Step 7: No commit (live-verification artifacts are local-only)**

The captured `/tmp/partition-*.txt` files are not committed. The PR body file is consumed by `/ship` in Task 6.

---

## Task 6: /ship the PR

**Files:** none directly — the `/ship` chain handles staging, commit, push, PR.

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --short`
Expected: no uncommitted changes (Tasks 1-4 each committed their own changes; Task 5 wrote to `/tmp/` only).

- [ ] **Step 2: Confirm branch and base**

Run: `git branch --show-current && git log --oneline main..HEAD`
Expected: `feat/per-command-partition`; one design-spec commit (b153a68 + d1284ca squash effect) plus four feature commits from Tasks 1-4.

- [ ] **Step 3: Invoke /ship**

In Claude Code, type:

```
/ship
```

The chain handles Stages 0-7 (pre-flight, cost gate, test, verify-agent, simplify, code review, commit-skip if already committed, push, PR open, Jira transition).

- [ ] **Step 4: At Stage 6, pass the PR notes file**

When `/ship` reaches Stage 6 (push + PR), it will run `gh pr create`. The PR body must include the live-verification deltas captured in Task 5. Use:

```bash
gh pr create --base main --title "feat(scoring): per-command partition fixes observer-session false positives" --body-file /tmp/partition-pr-notes.txt
```

If `/ship` already generates a PR body, append the notes file content to it instead — do not lose the delta capture.

- [ ] **Step 5: At Stage 7 (Jira), file or update the ticket**

The brainstorm session originated from CLAUDE.md "Known limitation"; the design spec was filed without a ticket. Either:

(a) File a new CCE ticket now via the Atlassian MCP with summary "Per-command partition for observer-session false positives" and link the PR + spec + plan, then `/ship` transitions it Done.

(b) Skip Jira; the design spec + PR description carry the institutional memory.

- [ ] **Step 6: After PR merges, follow-up edit for PR #N placeholders**

The probe-tracker footnote and CLAUDE.md "Resolved in PR #N" both contain literal `#N` placeholders. After merge, edit those files on main to replace `#N` with the actual PR number, and commit as a single docs follow-up (do not include in this PR).

---

## Self-review notes

Spec coverage check completed:

- §Architecture §1 (Sets) → Task 1 Step 3
- §Architecture §2 (boundary assertion) → Task 1 Step 3 (helper) + Task 1 Step 1 (4 tests)
- §Architecture §3 (allowPosture gate) → Task 2 Step 3
- §Architecture §4 (unknown fallback) → Task 2 Step 3 (`|| sessionKind === "unknown"`) + Task 2 Step 1 Test 6
- §Tests 1-8 → Task 1 Steps 1, 4 (Test 7) + Task 2 Steps 1, 4 (Tests 1, 2, 3, 4, 5, 6, 8)
- §Error handling (fail-loud module load) → Task 1 Step 3 module-load call
- §Probe-tracker update → Task 3
- §Acceptance criterion "CLAUDE.md paragraph rewritten" → Task 4
- §Acceptance criterion "live verification captures rewindCommandUses" → Task 5

Type-consistency check: `POSTURE_COMMANDS`, `VOLUME_COMMANDS`, `TARGET_COMMANDS`, `assertCommandPartition`, `classifySessionKind`, `allowPosture`, `sessionKind` — all named identically in every task that references them. Counter property names (`colorCommandUses`, `loopCommandUses`, `focusCommandUses`, `rewindCommandUses`) match the existing `counts` object shape verified at [/Users/theo/Projects/claude-extensions/scripts/\_usage-data.mjs:314-328](/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:314).

Placeholder scan: only the literal `PR #N` placeholders for the probe-tracker footnote (Task 3 Step 3) and CLAUDE.md (Task 4 Step 2). These are intentional — they get replaced post-merge in Task 6 Step 6.
