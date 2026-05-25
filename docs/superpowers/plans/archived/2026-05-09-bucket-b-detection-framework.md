# Bucket B Detection Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-09-bucket-b-detection-framework-design.md`

**Goal:** Close 8 detection gaps in the self-assessment rubric by adding three new signal-source classes (ship-journal reader, transcript-invocation scanner, shell-rc reader) and predicating 8 currently-unwired next-actions against the resulting signals. Detection-only — no score-formula changes.

**Architecture:** Three new gatherers slot into `gatherSignals` alongside existing reads. Each produces a flat shape forwarded through `buildSignalsSummary` and consumed by the predicate engine via the existing grammar. Pure-parser-first (TDD), then file-driven gatherers, then forwarding, then rubric.

**Tech Stack:** Node.js, vitest, JSON rubric.

**Branch:** `feat/bucket-b-detection` (worktree under `~/.config/superpowers/worktrees/` or repo `.worktrees/`). Spec already committed at `24ea4e2`.

**Empirical sampling note (mandatory before Task 4):** the spec calls out that the plan-mode marker format must be confirmed by sampling existing transcripts before locking the predicate. Step 1 of Task 4 does that sampling explicitly. This avoids the "PR #9 outputStyle field that didn't exist" failure mode flagged in CLAUDE.md.

---

## File Structure

| File                                                     | Change                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `scripts/signals.mjs`                                    | Add `parseJournalLine`, `gatherShipJournal`, `gatherShellAliases`; wire both into `gatherSignals` |
| `scripts/_usage-data.mjs`                                | Add `scanTranscriptInvocations` alongside existing `scanTranscriptModes`                          |
| `scripts/run-assessment.mjs`                             | Forward 9 new flat keys through `buildSignalsSummary`                                             |
| `app/data/rubric.json`                                   | Add `satisfiedWhen` to 8 existing actions                                                         |
| `scripts/__tests__/parse-journal-line.test.mjs`          | New: pure parser unit tests                                                                       |
| `scripts/__tests__/gather-ship-journal.test.mjs`         | New: file-driven gatherer test (temp dir)                                                         |
| `scripts/__tests__/scan-transcript-invocations.test.mjs` | New: scanner integration tests (synth fixtures)                                                   |
| `scripts/__tests__/gather-shell-aliases.test.mjs`        | New: shell-rc gatherer test (temp dir)                                                            |
| `scripts/__tests__/build-signals-summary.test.mjs`       | Extend `makeSignals` + inline snapshot + 9 forwarding tests                                       |
| `app/lib/__tests__/rubric-predicates.test.ts`            | Add 9 new keys to `ALL_SATISFIED_SIGNALS`                                                         |

---

## Task 1: Pure parser — `parseJournalLine`

**Files:**

- Modify: `scripts/signals.mjs` (new export)
- Create: `scripts/__tests__/parse-journal-line.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/__tests__/parse-journal-line.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { parseJournalLine } from "../signals.mjs";

describe("parseJournalLine", () => {
  it("returns null on empty string", () => {
    expect(parseJournalLine("")).toBeNull();
    expect(parseJournalLine("   ")).toBeNull();
  });

  it("returns null on non-JSON", () => {
    expect(parseJournalLine("not json")).toBeNull();
    expect(parseJournalLine("{ broken")).toBeNull();
  });

  it("parses a stage entry", () => {
    const line = `{"ts":"2026-05-10T02:49:41Z","stage":2,"kind":"verify","summary":"x"}`;
    expect(parseJournalLine(line)).toEqual({
      ts: "2026-05-10T02:49:41Z",
      stage: 2,
      kind: "verify",
      summary: "x",
    });
  });

  it("parses a shipped outcome entry", () => {
    const line = `{"ts":"2026-05-10T02:49:41Z","outcome":"shipped","pr":42}`;
    expect(parseJournalLine(line)).toEqual({
      ts: "2026-05-10T02:49:41Z",
      outcome: "shipped",
      pr: 42,
    });
  });

  it("returns null on JSON that isn't an object", () => {
    expect(parseJournalLine("123")).toBeNull();
    expect(parseJournalLine('"a string"')).toBeNull();
    expect(parseJournalLine("[1,2,3]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/parse-journal-line.test.mjs
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement parser**

In `scripts/signals.mjs`, add near the existing `parseMcpListOutput` export:

```js
// Parse a single JSONL line from ~/.claude/ship/journal.jsonl. Returns the
// parsed object on valid JSON object input, null on anything else (empty,
// malformed, non-object). Mirrors parseMcpListOutput's "skip silently"
// fault tolerance — the journal is append-only across all sessions and
// schema may evolve, so the reader stays tolerant.
export function parseJournalLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run scripts/__tests__/parse-journal-line.test.mjs
```

Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/parse-journal-line.test.mjs
git commit -m "feat(self-assessment): parseJournalLine pure parser for ship journal"
```

---

## Task 2: `gatherShipJournal` file-driven gatherer

**Files:**

- Modify: `scripts/signals.mjs` (new export)
- Create: `scripts/__tests__/gather-ship-journal.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/__tests__/gather-ship-journal.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherShipJournal } from "../signals.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ship-journal-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJournal(lines) {
  writeFileSync(join(dir, "journal.jsonl"), lines.join("\n"));
}

describe("gatherShipJournal", () => {
  it("returns zeros when journal file is missing", async () => {
    const r = await gatherShipJournal({
      journalPath: join(dir, "missing.jsonl"),
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 14,
    });
    expect(r).toEqual({ stage2Count: 0, totalRuns: 0, lastRunAt: null });
  });

  it("counts stage===2 entries within lookback window", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2,"kind":"verify"}`,
      `{"ts":"2026-05-10T02:00:00Z","stage":2,"kind":"verify"}`,
      `{"ts":"2026-04-01T00:00:00Z","stage":2,"kind":"verify"}`, // outside window
      `{"ts":"2026-05-10T03:00:00Z","stage":1,"kind":"test"}`, // wrong stage
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
  });

  it("counts outcome==='shipped' entries as totalRuns", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","pr":1}`,
      `{"ts":"2026-05-10T02:00:00Z","outcome":"halted"}`,
      `{"ts":"2026-05-10T03:00:00Z","outcome":"shipped","pr":2}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.totalRuns).toBe(2);
    expect(r.lastRunAt).toBe("2026-05-10T03:00:00Z");
  });

  it("skips malformed lines without throwing", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
      `not json`,
      ``,
      `{"ts":"2026-05-10T02:00:00Z","stage":2}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/gather-ship-journal.test.mjs
```

Expected: FAIL — import error.

- [ ] **Step 3: Implement gatherer**

In `scripts/signals.mjs`, add the imports if not already present (`readFile` from `fs/promises`) and add:

```js
// Reads ~/.claude/ship/journal.jsonl line by line. Counts stage:2 entries
// (verify-agent dispatches) and outcome:"shipped" entries within the
// lookback window. Empty/missing file returns all zeros. Malformed lines
// are skipped silently — same fault tolerance as parseJournalLine.
//
// Inputs are injected (journalPath, now) so tests can drive temp files
// without monkey-patching globals.
export async function gatherShipJournal({
  journalPath = join(claudeHome(), "ship", "journal.jsonl"),
  now = new Date(),
  lookbackDays = 14,
} = {}) {
  let raw;
  try {
    raw = await readFile(journalPath, "utf8");
  } catch {
    return { stage2Count: 0, totalRuns: 0, lastRunAt: null };
  }
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  let stage2Count = 0;
  let totalRuns = 0;
  let lastRunAt = null;
  for (const line of raw.split("\n")) {
    const entry = parseJournalLine(line);
    if (!entry || typeof entry.ts !== "string") continue;
    const t = Date.parse(entry.ts);
    if (Number.isNaN(t) || t < cutoff) continue;
    if (entry.stage === 2) stage2Count++;
    if (entry.outcome === "shipped") {
      totalRuns++;
      if (!lastRunAt || entry.ts > lastRunAt) lastRunAt = entry.ts;
    }
  }
  return { stage2Count, totalRuns, lastRunAt };
}
```

If `readFile` from `fs/promises` is not yet imported at the top of `signals.mjs`, add it to the existing imports.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run scripts/__tests__/gather-ship-journal.test.mjs
```

Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/gather-ship-journal.test.mjs
git commit -m "feat(self-assessment): gatherShipJournal reads stage:2 + shipped counts"
```

---

## Task 3: `gatherShellAliases` shell-rc reader

**Files:**

- Modify: `scripts/signals.mjs` (new export)
- Create: `scripts/__tests__/gather-shell-aliases.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/__tests__/gather-shell-aliases.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherShellAliases } from "../signals.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shell-rc-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("gatherShellAliases", () => {
  it("returns 0 when no rc files exist", async () => {
    const r = await gatherShellAliases({
      rcPaths: [join(dir, "missing.zshrc"), join(dir, "missing.bashrc")],
    });
    expect(r).toEqual({ worktreeAliasCount: 0 });
  });

  it("counts za, zb, zc aliases", async () => {
    writeFileSync(
      join(dir, ".zshrc"),
      [
        "# my zshrc",
        'alias za="cd ~/repo/.worktrees/a"',
        'alias zb="cd ~/repo/.worktrees/b"',
        'alias zc="cd ~/repo/.worktrees/c"',
      ].join("\n"),
    );
    const r = await gatherShellAliases({ rcPaths: [join(dir, ".zshrc")] });
    expect(r.worktreeAliasCount).toBe(3);
  });

  it("ignores unrelated aliases", async () => {
    writeFileSync(
      join(dir, ".zshrc"),
      ['alias ll="ls -la"', 'alias za="cd a"', 'alias gst="git status"'].join(
        "\n",
      ),
    );
    const r = await gatherShellAliases({ rcPaths: [join(dir, ".zshrc")] });
    expect(r.worktreeAliasCount).toBe(1);
  });

  it("dedupes across multiple rc files (zshrc + bashrc both define za)", async () => {
    writeFileSync(join(dir, ".zshrc"), 'alias za="cd a"\nalias zb="cd b"');
    writeFileSync(join(dir, ".bashrc"), 'alias za="cd a"');
    const r = await gatherShellAliases({
      rcPaths: [join(dir, ".zshrc"), join(dir, ".bashrc")],
    });
    expect(r.worktreeAliasCount).toBe(2);
  });

  it("matches with leading whitespace and tab indentation", async () => {
    writeFileSync(
      join(dir, ".zshrc"),
      ["  alias za='cd a'", "\talias zb='cd b'"].join("\n"),
    );
    const r = await gatherShellAliases({ rcPaths: [join(dir, ".zshrc")] });
    expect(r.worktreeAliasCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/gather-shell-aliases.test.mjs
```

Expected: FAIL — import error.

- [ ] **Step 3: Implement gatherer**

In `scripts/signals.mjs`, add:

```js
// Counts distinct worktree-style aliases (za, zb, zc) across the user's
// shell rc files. Distinct = same alias name in two files counts once.
// Defaults to ~/.zshrc and ~/.bashrc; tests inject explicit paths.
const WORKTREE_ALIAS_RE = /^\s*alias\s+(za|zb|zc)=/m;
export async function gatherShellAliases({
  rcPaths = [join(homedir(), ".zshrc"), join(homedir(), ".bashrc")],
} = {}) {
  const found = new Set();
  for (const p of rcPaths) {
    let content;
    try {
      content = await readFile(p, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const m = line.match(WORKTREE_ALIAS_RE);
      if (m) found.add(m[1]);
    }
  }
  return { worktreeAliasCount: found.size };
}
```

If `homedir` from `node:os` is not imported, add it to the existing imports.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run scripts/__tests__/gather-shell-aliases.test.mjs
```

Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/gather-shell-aliases.test.mjs
git commit -m "feat(self-assessment): gatherShellAliases counts za/zb/zc worktree aliases"
```

---

## Task 4: `scanTranscriptInvocations` scanner

**Files:**

- Modify: `scripts/_usage-data.mjs` (new export)
- Create: `scripts/__tests__/scan-transcript-invocations.test.mjs`

- [ ] **Step 1: Sample real transcripts to confirm plan-mode marker format**

This is the empirical-sampling step the spec mandates. Run:

```bash
ls -t ~/.claude/projects/*/*.jsonl | head -1 | xargs -I{} grep -m 1 '"name":"ExitPlanMode"' {} | head -c 400
```

Confirm: the marker is an `assistant`-role message containing a `tool_use` block where `name === "ExitPlanMode"`. The "next 2 messages" check counts a session if any of the next 2 messages contains a tool_use with `name !== "ExitPlanMode"`. If sampling reveals a different shape (e.g. plan-exit lives in a `system` block, or the name varies), update the test fixture and the implementation in this task accordingly before proceeding.

Document the confirmed shape inline in the implementation comment.

- [ ] **Step 2: Write failing tests**

Create `scripts/__tests__/scan-transcript-invocations.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanTranscriptInvocations } from "../_usage-data.mjs";

let projectsRoot;
beforeEach(() => {
  projectsRoot = mkdtempSync(join(tmpdir(), "transcripts-"));
});
afterEach(() => {
  rmSync(projectsRoot, { recursive: true, force: true });
});

function writeSession(name, lines) {
  const dir = join(projectsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), lines.join("\n"));
}

const userText = (text, ts = "2026-05-09T12:00:00Z") =>
  JSON.stringify({
    type: "user",
    timestamp: ts,
    message: { role: "user", content: text },
  });

const assistantText = (text, ts = "2026-05-09T12:00:01Z") =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  });

const assistantToolUse = (name, ts = "2026-05-09T12:00:01Z") =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input: {} }],
    },
  });

describe("scanTranscriptInvocations", () => {
  it("returns zeros when projectsRoot is empty", async () => {
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r).toEqual({
      goCommandUses: 0,
      batchCommandUses: 0,
      focusCommandUses: 0,
      scheduleCommandUses: 0,
      babysitLoopUses: 0,
      planThenLaunchSessions: 0,
    });
  });

  it("counts /go, /batch, /focus, /schedule slash commands", async () => {
    writeSession("s1", [
      userText("/go run the tests"),
      userText("/batch update fixtures"),
      userText("/focus"),
      userText("/schedule daily"),
      userText("/go"),
      userText("hello /go inline does not count"),
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.goCommandUses).toBe(2);
    expect(r.batchCommandUses).toBe(1);
    expect(r.focusCommandUses).toBe(1);
    expect(r.scheduleCommandUses).toBe(1);
  });

  it("counts babysit-loop sessions (1 per session if both /loop and /babysit present)", async () => {
    writeSession("s1", [
      userText("/loop 30m"),
      userText("/babysit"),
      userText("/loop 30m"), // second occurrence in same session: still 1
    ]);
    writeSession("s2", [
      userText("/loop"), // no /babysit: doesn't count
    ]);
    writeSession("s3", [userText("/loop"), userText("/babysit")]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.babysitLoopUses).toBe(2);
  });

  it("detects plan-then-launch (ExitPlanMode followed by tool_use within 2 messages)", async () => {
    writeSession("s1", [
      assistantToolUse("ExitPlanMode"),
      assistantToolUse("Edit"), // immediate tool call → counts
    ]);
    writeSession("s2", [
      assistantToolUse("ExitPlanMode"),
      assistantText("let me explain the plan first..."),
      assistantText("more narration"),
      assistantToolUse("Edit"), // 3rd message → does NOT count
    ]);
    writeSession("s3", [
      assistantToolUse("ExitPlanMode"),
      assistantText("ok"),
      assistantToolUse("Bash"), // 2nd message → counts
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.planThenLaunchSessions).toBe(2);
  });

  it("respects lookback window via timestamps", async () => {
    writeSession("recent", [userText("/go", "2026-05-09T00:00:00Z")]);
    writeSession("ancient", [
      userText("/go", "2026-01-01T00:00:00Z"), // outside 30-day window from 2026-05-10
    ]);
    const r = await scanTranscriptInvocations({
      projectsRoot,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.goCommandUses).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: FAIL — import error.

- [ ] **Step 4: Implement scanner**

In `scripts/_usage-data.mjs`, add:

```js
// Walks ~/.claude/projects/*/*.jsonl transcripts within lookback. Returns
// counts of /go /batch /focus /schedule slash commands, sessions where
// /loop + /babysit both appear (1 per session), and sessions where an
// ExitPlanMode tool_use is followed by a non-plan tool_use within the
// next 2 assistant messages.
//
// Plan-then-launch detection (confirmed by transcript sampling 2026-05-09):
// the marker is `message.content[*].type === "tool_use" &&
// message.content[*].name === "ExitPlanMode"` on an assistant-role line.
// Window is "next 2 messages" — index+1 and index+2 in the per-session
// stream. Any tool_use whose name !== "ExitPlanMode" within that window
// counts the session once.

const SLASH_RE = {
  go: /^\/go(\s|$)/,
  batch: /^\/batch(\s|$)/,
  focus: /^\/focus(\s|$)/,
  schedule: /^\/schedule(\s|$)/,
  loop: /^\/loop(\s|$)/,
  babysit: /^\/babysit(\s|$)/,
};

function userMessageText(line) {
  if (line.type !== "user" || !line.message) return null;
  const c = line.message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    for (const item of c) {
      if (item?.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  return null;
}

function assistantToolUseName(line) {
  if (line.type !== "assistant" || !line.message) return null;
  const c = line.message.content;
  if (!Array.isArray(c)) return null;
  for (const item of c) {
    if (item?.type === "tool_use" && typeof item.name === "string") {
      return item.name;
    }
  }
  return null;
}

export async function scanTranscriptInvocations({
  projectsRoot,
  now = new Date(),
  lookbackDays = 30,
} = {}) {
  const counts = {
    goCommandUses: 0,
    batchCommandUses: 0,
    focusCommandUses: 0,
    scheduleCommandUses: 0,
    babysitLoopUses: 0,
    planThenLaunchSessions: 0,
  };
  let sessionFiles;
  try {
    const { readdir } = await import("node:fs/promises");
    const projectDirs = await readdir(projectsRoot, { withFileTypes: true });
    sessionFiles = [];
    for (const d of projectDirs) {
      if (!d.isDirectory()) continue;
      const inner = await readdir(join(projectsRoot, d.name));
      for (const f of inner) {
        if (f.endsWith(".jsonl")) {
          sessionFiles.push(join(projectsRoot, d.name, f));
        }
      }
    }
  } catch {
    return counts;
  }
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  for (const path of sessionFiles) {
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
      const line = lines[i];
      const ts = Date.parse(line.timestamp || "");
      if (!Number.isNaN(ts) && ts < cutoff) continue;

      const userText = userMessageText(line);
      if (userText) {
        const trimmed = userText.trimStart();
        if (SLASH_RE.go.test(trimmed)) counts.goCommandUses++;
        if (SLASH_RE.batch.test(trimmed)) counts.batchCommandUses++;
        if (SLASH_RE.focus.test(trimmed)) counts.focusCommandUses++;
        if (SLASH_RE.schedule.test(trimmed)) counts.scheduleCommandUses++;
        if (SLASH_RE.loop.test(trimmed)) sessionHasLoop = true;
        if (SLASH_RE.babysit.test(trimmed)) sessionHasBabysit = true;
      }

      const toolName = assistantToolUseName(line);
      if (toolName === "ExitPlanMode") {
        for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
          const next = assistantToolUseName(lines[j]);
          if (next && next !== "ExitPlanMode") {
            counts.planThenLaunchSessions++;
            break;
          }
        }
      }
    }

    if (sessionHasLoop && sessionHasBabysit) counts.babysitLoopUses++;
  }
  return counts;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs
```

Expected: PASS — all 5 cases.

- [ ] **Step 6: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/scan-transcript-invocations.test.mjs
git commit -m "feat(self-assessment): scanTranscriptInvocations counts slash commands + plan-then-launch"
```

---

## Task 5: Wire all three gatherers into `gatherSignals`

**Files:**

- Modify: `scripts/signals.mjs` (extend `gatherSignals` return)

- [ ] **Step 1: Read current `gatherSignals` return shape**

```bash
grep -n "return {" scripts/signals.mjs | tail -5
sed -n '340,400p' scripts/signals.mjs
```

Confirm where `mcpServers` and `hasClaudeInChrome` are returned. The new keys land in the same return object.

- [ ] **Step 2: Wire the three gatherers**

In `scripts/signals.mjs`, in `gatherSignals`, near the existing `const mcpServers = await gatherMcpServers();` line (~343), add:

```js
const mcpServers = await gatherMcpServers();
const shipJournal = await gatherShipJournal({ lookbackDays: 14 });
const shellAliases = await gatherShellAliases();
const transcriptInvocations = await scanTranscriptInvocations({
  projectsRoot: join(claudeHome(), "projects"),
  lookbackDays: 30,
});
```

Then in the `return` object, add the three new shapes alongside `mcpServers`:

```js
mcpServers,
shipJournal,
shellAliases,
transcriptInvocations,
```

Add the `scanTranscriptInvocations` import at the top of `signals.mjs`:

```js
import { scanTranscriptInvocations } from "./_usage-data.mjs";
```

(Adjust if `_usage-data.mjs` is already partially imported.)

- [ ] **Step 3: Add `process.env.VITEST` skips for the file-walking gatherers**

To prevent integration tests in `pipeline.test.mjs` and `gatherSignals.test.mjs` from accidentally walking the user's real `~/.claude/projects/`, the same VITEST guard that protects `gatherMcpServers` must guard `scanTranscriptInvocations` too. In `_usage-data.mjs`, at the top of `scanTranscriptInvocations`, add:

```js
if (process.env.VITEST && !arguments[0]?.projectsRoot) {
  return {
    goCommandUses: 0,
    batchCommandUses: 0,
    focusCommandUses: 0,
    scheduleCommandUses: 0,
    babysitLoopUses: 0,
    planThenLaunchSessions: 0,
  };
}
```

Note: when tests inject `projectsRoot` explicitly (Task 4 tests do), they bypass the guard. Only the implicit "use real ~/.claude/projects/" path is short-circuited. Same applies to `gatherShipJournal` (guard if `journalPath` not injected) and `gatherShellAliases` (guard if `rcPaths` not injected).

Add the same shape to `gatherShipJournal` and `gatherShellAliases` as appropriate.

- [ ] **Step 4: Run integration suite to confirm no regressions**

```bash
npx vitest run scripts/__tests__/pipeline.test.mjs scripts/__tests__/gatherSignals.test.mjs
```

Expected: PASS — both suites green within their 5s vitest defaults.

- [ ] **Step 5: Commit**

```bash
git add scripts/signals.mjs scripts/_usage-data.mjs
git commit -m "feat(self-assessment): wire ship-journal, shell-aliases, transcript-invocations into gatherSignals"
```

---

## Task 6: Forward 9 keys through `buildSignalsSummary` + snapshot update

**Files:**

- Modify: `scripts/run-assessment.mjs` (forwarding)
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (fixture + snapshot + forwarding tests)

- [ ] **Step 1: Extend `makeSignals` test fixture**

In `scripts/__tests__/build-signals-summary.test.mjs`, extend `makeSignals` to include the new gatherer outputs:

```js
function makeSignals(overrides = {}) {
  return {
    settings: {
      /* existing */
    },
    plugins: [
      /* existing */
    ],
    mcpServers: [
      /* existing */
    ],
    shipJournal: {
      stage2Count: 3,
      totalRuns: 5,
      lastRunAt: "2026-05-09T12:00:00Z",
    },
    shellAliases: { worktreeAliasCount: 3 },
    transcriptInvocations: {
      goCommandUses: 4,
      batchCommandUses: 2,
      focusCommandUses: 1,
      scheduleCommandUses: 1,
      babysitLoopUses: 1,
      planThenLaunchSessions: 2,
    },
    /* rest of existing fields */
    ...overrides,
  };
}
```

- [ ] **Step 2: Forward keys in `buildSignalsSummary`**

In `scripts/run-assessment.mjs`, in `buildSignalsSummary`, add (next to existing `hasMcpServers`):

```js
shipVerifyStageRecent: signals.shipJournal?.stage2Count ?? 0,
shipsRecent: signals.shipJournal?.totalRuns ?? 0,
worktreeAliasCount: signals.shellAliases?.worktreeAliasCount ?? 0,
goCommandUses: signals.transcriptInvocations?.goCommandUses ?? 0,
batchCommandUses: signals.transcriptInvocations?.batchCommandUses ?? 0,
focusCommandUses: signals.transcriptInvocations?.focusCommandUses ?? 0,
scheduleCommandUses: signals.transcriptInvocations?.scheduleCommandUses ?? 0,
babysitLoopUses: signals.transcriptInvocations?.babysitLoopUses ?? 0,
planThenLaunchSessions: signals.transcriptInvocations?.planThenLaunchSessions ?? 0,
```

That's 9 new flat keys.

- [ ] **Step 3: Add forwarding tests**

In `scripts/__tests__/build-signals-summary.test.mjs`, add a new test block:

```js
it("forwards ship-journal counts", () => {
  const r = buildSignalsSummary(makeSignals());
  expect(r.shipVerifyStageRecent).toBe(3);
  expect(r.shipsRecent).toBe(5);
});

it("forwards shell-alias count", () => {
  expect(buildSignalsSummary(makeSignals()).worktreeAliasCount).toBe(3);
});

it("forwards transcript invocation counts", () => {
  const r = buildSignalsSummary(makeSignals());
  expect(r.goCommandUses).toBe(4);
  expect(r.batchCommandUses).toBe(2);
  expect(r.focusCommandUses).toBe(1);
  expect(r.scheduleCommandUses).toBe(1);
  expect(r.babysitLoopUses).toBe(1);
  expect(r.planThenLaunchSessions).toBe(2);
});

it("defaults missing gatherer outputs to 0", () => {
  const r = buildSignalsSummary(
    makeSignals({
      shipJournal: undefined,
      shellAliases: undefined,
      transcriptInvocations: undefined,
    }),
  );
  expect(r.shipVerifyStageRecent).toBe(0);
  expect(r.shipsRecent).toBe(0);
  expect(r.worktreeAliasCount).toBe(0);
  expect(r.goCommandUses).toBe(0);
  expect(r.planThenLaunchSessions).toBe(0);
});
```

- [ ] **Step 4: Update inline snapshot**

The sortedKeys snapshot at the bottom of the file must include the 9 new keys in alphabetical order. Run:

```bash
npx vitest run scripts/__tests__/build-signals-summary.test.mjs
```

Expected: the snapshot test will fail with a diff. Run with `-u` to update:

```bash
npx vitest run scripts/__tests__/build-signals-summary.test.mjs -u
```

Then visually confirm the diff added exactly these 9 keys, in alphabetical order:
`babysitLoopUses, batchCommandUses, focusCommandUses, goCommandUses, planThenLaunchSessions, scheduleCommandUses, shipVerifyStageRecent, shipsRecent, worktreeAliasCount`.

- [ ] **Step 5: Run full suite**

```bash
npx vitest run scripts/__tests__/build-signals-summary.test.mjs
```

Expected: PASS — fixture + 4 new forwarding tests + updated snapshot.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-assessment.mjs scripts/__tests__/build-signals-summary.test.mjs
git commit -m "feat(self-assessment): forward 9 new flat signals through buildSignalsSummary"
```

---

## Task 7: Wire 8 predicates in rubric + sweep guard

**Files:**

- Modify: `app/data/rubric.json` (8 actions)
- Modify: `app/lib/__tests__/rubric-predicates.test.ts` (fixture)

- [ ] **Step 1: Extend ALL_SATISFIED_SIGNALS fixture**

In `app/lib/__tests__/rubric-predicates.test.ts`, add the new keys to `ALL_SATISFIED_SIGNALS`:

```ts
// bucket b
shipVerifyStageRecent: 5,
shipsRecent: 8,
worktreeAliasCount: 3,
goCommandUses: 4,
batchCommandUses: 2,
focusCommandUses: 1,
scheduleCommandUses: 1,
babysitLoopUses: 1,
planThenLaunchSessions: 2,
```

- [ ] **Step 2: Add `satisfiedWhen` to 8 actions in rubric.json**

Edit `app/data/rubric.json`. Add the `satisfiedWhen` field to each action below — find each by `id`:

```
verification/branch-diff   → "shipVerifyStageRecent>=1"
planning/plan-then-launch  → "planThenLaunchSessions>=1"
verification/go-reflex     → "goCommandUses>=3"
parallel/batch-sweep       → "batchCommandUses>=1"
customization/focus-mode   → "focusCommandUses>=1"
scheduled/babysit-loop     → "babysitLoopUses>=1"
scheduled/promote-routine  → "scheduleCommandUses>=1"
parallel/worktree-aliases  → "worktreeAliasCount>=3"
```

For example, the `verification/branch-diff` entry becomes:

```json
{
  "id": "branch-diff",
  "action": "Ask Claude to diff behavior between main and the feature branch after any non-trivial change — Boris tip 10",
  "effort": "5min",
  "satisfiedWhen": "shipVerifyStageRecent>=1"
}
```

Apply the analogous edit to the other seven actions. Threshold of `>=3` for `goCommandUses` reflects "reflex, not sample"; the others use `>=1`.

- [ ] **Step 3: Run predicate sweep guard**

```bash
npx vitest run app/lib/__tests__/rubric-predicates.test.ts
```

Expected: PASS — both "all-satisfied → true" and "empty → false" assertions hold for all 8 new predicates.

- [ ] **Step 4: Run full suite**

```bash
npx vitest run
```

Expected: PASS across all 230+ tests.

- [ ] **Step 5: Commit**

```bash
git add app/data/rubric.json app/lib/__tests__/rubric-predicates.test.ts
git commit -m "feat(self-assessment): predicate 8 Bucket B actions against new signals"
```

---

## Task 8: End-to-end verification against real environment

**Files:** none — verification only.

- [ ] **Step 1: Run real-environment assessment**

```bash
npm run assess -- --insights-lookback 30 --include-transcripts 2>&1 | tee /tmp/bucket-b-after.log
```

- [ ] **Step 2: Confirm at least 3 of the 8 newly-predicated actions are now satisfied**

```bash
grep -E "(branch-diff|plan-then-launch|go-reflex|batch-sweep|focus-mode|babysit-loop|promote-routine|worktree-aliases)" /tmp/bucket-b-after.log
```

Expected: at least 3 of these no longer appear in priority lists. The user's environment has recent `/ship` activity (so `branch-diff` should satisfy via `shipVerifyStageRecent>=1`) and likely shell aliases. If 0 satisfy, the wiring is broken — re-investigate.

- [ ] **Step 3: Confirm Platform Setup and Execution scores are unchanged**

Compare to the most recent pre-PR assessment (look at `app/data/assessment-history.json`). Both axes should match within ±1 point — predicates affect TODO visibility, not score formulas. If a score moved more than that, something accidentally collapsed scoring with predicate state — investigate before merging.

- [ ] **Step 4: No commit**

Verification only. Move to PR creation in /ship.

---

## Self-Review

**Spec coverage:**

- 3 new signal sources: `gatherShipJournal` (Task 2), `scanTranscriptInvocations` (Task 4), `gatherShellAliases` (Task 3). ✓
- 8 predicates: all 8 covered in Task 7. ✓
- Empirical sampling for plan-mode marker: Task 4, Step 1. ✓
- Detection-only architecture: no `score.mjs` edits anywhere in plan. ✓
- Subprocess skip pattern: Task 5, Step 3. ✓
- Sweep guard: Task 7, Step 1. ✓

**Placeholders:** None — every step has concrete code or commands.

**Type consistency:**

- `shipJournal` (signals.mjs return) → `signals.shipJournal?.stage2Count` (run-assessment.mjs forward) → `shipVerifyStageRecent` (predicate key). Consistent.
- `transcriptInvocations` (signals.mjs return) → `signals.transcriptInvocations?.goCommandUses` (forward) → `goCommandUses` (predicate). Consistent.
- `shellAliases` (signals.mjs return) → `signals.shellAliases?.worktreeAliasCount` (forward) → `worktreeAliasCount` (predicate). Consistent.

**Open questions deferred (per spec, intentional):**

- Plan-mode marker variant beyond `ExitPlanMode` tool_use. Task 4 Step 1 tests the assumption empirically; if violated, fix in-task.
- Stricter `/loop /babysit` composite detection. Punted unless false positives.
- `shipsRecent` as a milestone trigger. Out of scope.

## Out of scope

Per spec:

- Score-formula changes
- Bucket A items (separate PR)
- Bucket C items (product decision)
- Refactoring `scanTranscriptModes`
- /ship journal schema versioning
