---
status: implemented
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33: Progression Detectors for scheduled / remote / verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the progression-timeline coverage gap by adding three telemetry-dated milestone detectors — `scheduled` (Boris tip 48), `remote` (tip 35), `verification` (tip 73) — so `/progression` covers all 12 scored dimensions instead of 9 of 12.

**Architecture:** Append three records to the `DETECTORS` array in `scripts/progression.mjs`, matching the existing `{transcriptsRequired, detect(sessions, facets, transcripts, ctx) -> milestone | null}` shape. One supporting change extends `scanTranscriptModes` in `scripts/_usage-data.mjs` to emit a per-session `commands: Set<string>` (~5 lines, piggybacks the existing `<command-name>` scan). The page renderer at `app/progression/page.tsx` consumes the uniform milestone shape and needs no changes — new milestones drop in through the existing pipeline. Probe-tracker spec gets updated in the same PR per CLAUDE.md hard rule.

**Tech Stack:** Node.js ESM (`.mjs`), Vitest, Next.js 16, plain JSON fixtures via `mkdtempSync` + `writeFileSync` (no fixture helpers, no mocks).

---

## Source spec

`docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md` — approved 2026-06-01. Read it before starting; this plan operationalizes its decisions but does not restate the design rationale (the spec covers the "why command-first vs tool-first", "why tip 73 not tip 14", and the data-flow diagrams).

## File Structure

- **Modify:** `scripts/_usage-data.mjs` — extend `scanTranscriptModes` (line 428) with a `commands: Set<string>` field tracked alongside the existing `<command-name>` scan and added to the return object.
- **Modify:** `scripts/progression.mjs` — append three new detector records to the `DETECTORS` array (currently ends at line 191).
- **Modify:** `scripts/__tests__/progression.test.mjs` — append three positive-case tests + one regression test (existing 9 detectors still pass).
- **Modify:** `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` — Part 1 progression-detectors registry rows (3 new), Part 2 tip-coverage rows for tips 35 / 48 / 73, and re-derived header counts (machine-enforced by `scripts/__tests__/tracker-counts.test.mjs`).

No new files. No UI work. No rubric changes.

---

> **Status: Implemented — PR #108 (merged 2026-06-01).** Live verification confirmed backdated milestone timestamps: `scheduled` @ 2026-04-29, `remote` @ 2026-04-15, `verification` @ 2026-05-26. All five machine-enforced probe-tracker header counts are unchanged (75/12/48/47/71) — the new detectors are purely progression-layer additions with no new `satisfiedWhen` predicates or `probe-catalog.json` entries.

---

## Task 1: Extend `scanTranscriptModes` with `commands` Set

**Files:**

- Modify: `scripts/_usage-data.mjs:428-496`
- Test: `scripts/__tests__/progression.test.mjs` (regression — implicit via Task 5)

The change is one new local `Set`, three new lines inside the existing `<command-name>` block, and one new field on the return object. The existing `<command-name>` scan already extracts the command name into `cmd`; we just need to also stash it into the new Set.

- [x] **Step 1: Read the current implementation**

Read `scripts/_usage-data.mjs:428-496` to confirm the current shape — specifically that `COMMAND_NAME_RE` at line 422 captures the command name into `m[1]` and that the existing `<command-name>` block at lines 478-484 already iterates matches.

- [x] **Step 2: Add the `commands` local Set**

Edit `scripts/_usage-data.mjs` — inside `scanTranscriptModes`, alongside the other locals declared near line 429-444 (the `modes`, `skills`, `learningModeMatches`, `assistantTurns` locals), add:

```js
const commands = new Set();
```

Place it on a new line right after `const skills = new Set();`.

- [x] **Step 3: Populate `commands` inside the existing scan loop**

Inside the existing block at lines 478-484, add `commands.add(cmd);` as the first line of the for-loop. The block becomes:

```js
if (raw.includes("<command-name>")) {
  for (const m of raw.matchAll(COMMAND_NAME_RE)) {
    const cmd = m[1];
    commands.add(cmd);
    if (PLANNING_SKILL_COMMANDS.has(cmd)) modes.add("plan");
    if (LEARNING_SKILL_COMMANDS.has(cmd)) modes.add("learning");
  }
}
```

Why first: keeps the `commands` Set a faithful record of every command seen, independent of the planning/learning skill membership checks below. No de-dup needed (Sets handle that natively).

- [x] **Step 4: Add `commands` to the return object**

Insert `commands,` into the return object near line 486-495, between `skills,` and `learningModeMatches,`:

```js
return {
  modes,
  hasWorktreeState,
  hasAiTitle,
  skills,
  commands,
  learningModeMatches,
  assistantTurns,
  opusAssistantTurns,
  entrypoint,
};
```

- [x] **Step 5: Run the full test suite — verify no regressions**

Run: `npx vitest run`
Expected: 619/619 pass (baseline). The `commands` field is additive; no existing test asserts exact key membership on the `scanTranscriptModes` return shape (verified by grepping the test files for `toMatchObject\|toEqual.*modes` — only positive-property checks exist).

If a test fails because it asserts the return shape verbatim, that test needs to learn about the new key — update the assertion, do not skip the new field.

- [x] **Step 6: Commit**

```bash
git add scripts/_usage-data.mjs
git commit -m "$(cat <<'EOF'
feat(_usage-data): track per-session commands Set in scanTranscriptModes — CCE-33

Piggybacks the existing <command-name> scan to also collect bare command
names per session. Required by the new scheduled and verification
progression detectors (CCE-33), which fire on first-occurrence of
/loop|/schedule|/babysit and /go respectively. No semantic change to
existing modes/skills/learning-mode detection — purely additive.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scheduled detector (Boris tip 48)

**Files:**

- Modify: `scripts/progression.mjs:191` (append to `DETECTORS` array)
- Test: `scripts/__tests__/progression.test.mjs` (append new `it` block)

- [x] **Step 1: Write the failing test**

Append the following inside `describe("detectMilestones", …)` in `scripts/__tests__/progression.test.mjs` (before the closing `});` at line 241):

```js
it("emits scheduled milestone on first /loop|/schedule|/babysit invocation", async () => {
  writeMeta(dir, "no-cmd", { start_time: daysAgo(40) });
  writeMeta(dir, "babysit-day", { start_time: daysAgo(20) });
  writeMeta(dir, "later-loop", { start_time: daysAgo(10) });
  writeTranscript(dir, "p", "no-cmd", [
    { type: "user", timestamp: daysAgo(40) },
  ]);
  writeTranscript(dir, "p", "babysit-day", [
    {
      type: "assistant",
      message: { content: "<command-name>babysit</command-name>" },
    },
  ]);
  writeTranscript(dir, "p", "later-loop", [
    {
      type: "assistant",
      message: { content: "<command-name>loop</command-name>" },
    },
  ]);

  const r = await detectMilestones({
    claudeHome: dir,
    now: NOW,
    includeTranscripts: true,
  });
  const milestone = r.milestones.find((m) => m.dimension === "scheduled");
  expect(milestone).toBeDefined();
  expect(milestone.sessionId).toBe("babysit-day");
  expect(milestone.milestone).toBe("Started using scheduled workflows");
  expect(milestone.borisTip).toBe(48);
  expect(milestone.evidence).toMatch(/\/babysit/);
});
```

Note on the transcript shape: `scanTranscriptModes` uses `raw.includes("<command-name>")` + `raw.matchAll(COMMAND_NAME_RE)` on the **literal JSON line text**, so the test fixture must produce a JSON-encoded line that contains the substring `<command-name>babysit</command-name>` — which embedding the markup inside `message.content` does. The existing `<command-name>` scan in `_usage-data.mjs` is regex-based on the raw line, not on parsed `message.content`, so this fixture style works without any special escaping.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "scheduled milestone"`
Expected: FAIL — `milestone` is `undefined` because no scheduled detector exists yet.

- [x] **Step 3: Add the detector**

Edit `scripts/progression.mjs` — append the following inside the `DETECTORS` array, after the existing "Stopped using bypass" detector (which currently ends at line 190 with `},`). Insert before the closing `];` at line 191:

```js
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const scheduledCommands = ["loop", "schedule", "babysit"];
      const m = sessions.find((s) => {
        const cmds = transcripts.get(s.session_id)?.commands;
        return cmds && scheduledCommands.some((c) => cmds.has(c));
      });
      if (!m) return null;
      const cmds = transcripts.get(m.session_id).commands;
      const cmd = scheduledCommands.find((c) => cmds.has(c));
      return {
        timestamp: m.start_time,
        dimension: "scheduled",
        milestone: "Started using scheduled workflows",
        borisTip: 48,
        evidence: `First session invoking /${cmd}`,
        sessionId: m.session_id,
      };
    },
  },
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "scheduled milestone"`
Expected: PASS.

- [x] **Step 5: Run the full progression test file to verify no regressions**

Run: `npx vitest run scripts/__tests__/progression.test.mjs`
Expected: all existing `detectMilestones` tests still pass (the new detector ignores sessions lacking the transcript commands Set, so it can't false-positive existing fixtures).

- [x] **Step 6: Commit**

```bash
git add scripts/progression.mjs scripts/__tests__/progression.test.mjs
git commit -m "$(cat <<'EOF'
feat(progression): scheduled detector — first /loop|/schedule|/babysit — CCE-33

Closes the scheduled-dim coverage gap on the progression timeline.
Fires on the first session that invokes any of the three autonomous-
scheduling commands. Transcripts-required (the user's standard
--include-transcripts workflow already enables this). Boris tip 48.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remote detector (Boris tip 35)

**Files:**

- Modify: `scripts/progression.mjs` (append to `DETECTORS` array, after Task 2's detector)
- Test: `scripts/__tests__/progression.test.mjs`

- [x] **Step 1: Write the failing test**

Append inside `describe("detectMilestones", …)`:

```js
it("emits remote milestone on first RemoteTrigger|PushNotification|SendMessage tool fire", async () => {
  writeMeta(dir, "no-remote", { start_time: daysAgo(30) });
  writeMeta(dir, "push-day", {
    start_time: daysAgo(15),
    tool_counts: { PushNotification: 2 },
  });
  writeMeta(dir, "later-trigger", {
    start_time: daysAgo(5),
    tool_counts: { RemoteTrigger: 1 },
  });

  const r = await detectMilestones({ claudeHome: dir, now: NOW });
  const milestone = r.milestones.find((m) => m.dimension === "remote");
  expect(milestone).toBeDefined();
  expect(milestone.sessionId).toBe("push-day");
  expect(milestone.milestone).toBe("First remote-tool invocation");
  expect(milestone.borisTip).toBe(35);
  expect(milestone.evidence).toMatch(/PushNotification \(2 calls\)/);
});
```

This detector is facets-only (no transcripts), so the test does **not** pass `includeTranscripts: true`. That also confirms the detector fires when transcripts are off — important because not every user runs assess with `--include-transcripts`.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "remote milestone"`
Expected: FAIL — `milestone` is `undefined`.

- [x] **Step 3: Add the detector**

Edit `scripts/progression.mjs` — append inside the `DETECTORS` array, after the scheduled detector added in Task 2:

```js
  {
    transcriptsRequired: false,
    detect(sessions) {
      const remoteTools = ["RemoteTrigger", "PushNotification", "SendMessage"];
      const m = sessions.find((s) =>
        remoteTools.some((t) => (s.tool_counts?.[t] ?? 0) > 0),
      );
      if (!m) return null;
      const tool = remoteTools.find((t) => (m.tool_counts?.[t] ?? 0) > 0);
      const count = m.tool_counts[tool];
      return {
        timestamp: m.start_time,
        dimension: "remote",
        milestone: "First remote-tool invocation",
        borisTip: 35,
        evidence: `First session firing ${tool} (${count} call${count === 1 ? "" : "s"})`,
        sessionId: m.session_id,
      };
    },
  },
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "remote milestone"`
Expected: PASS.

- [x] **Step 5: Run the full progression test file**

Run: `npx vitest run scripts/__tests__/progression.test.mjs`
Expected: all existing tests still pass.

- [x] **Step 6: Commit**

```bash
git add scripts/progression.mjs scripts/__tests__/progression.test.mjs
git commit -m "$(cat <<'EOF'
feat(progression): remote detector — first RemoteTrigger|Push|SendMessage — CCE-33

Closes the remote-dim coverage gap on the progression timeline. Facets-
only (tool_counts) so it fires regardless of --include-transcripts.
Boris tip 35 (Remote Control) is the umbrella tip; per-sub-feature
breakdown (Chrome / iOS / mobile push) is out of scope.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verification detector (Boris tip 73)

**Files:**

- Modify: `scripts/progression.mjs` (append to `DETECTORS` array, after Task 3's detector)
- Test: `scripts/__tests__/progression.test.mjs`

- [x] **Step 1: Write the failing test**

Append inside `describe("detectMilestones", …)`:

```js
it("emits verification milestone on first /go invocation", async () => {
  writeMeta(dir, "no-go", { start_time: daysAgo(30) });
  writeMeta(dir, "go-day", { start_time: daysAgo(12) });
  writeMeta(dir, "later-go", { start_time: daysAgo(3) });
  writeTranscript(dir, "p", "no-go", [
    { type: "user", timestamp: daysAgo(30) },
  ]);
  writeTranscript(dir, "p", "go-day", [
    {
      type: "assistant",
      message: { content: "<command-name>go</command-name>" },
    },
  ]);
  writeTranscript(dir, "p", "later-go", [
    {
      type: "assistant",
      message: { content: "<command-name>go</command-name>" },
    },
  ]);

  const r = await detectMilestones({
    claudeHome: dir,
    now: NOW,
    includeTranscripts: true,
  });
  const milestone = r.milestones.find((m) => m.dimension === "verification");
  expect(milestone).toBeDefined();
  expect(milestone.sessionId).toBe("go-day");
  expect(milestone.milestone).toBe("First /go composite invocation");
  expect(milestone.borisTip).toBe(73);
  expect(milestone.evidence).toMatch(/\/go/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "verification milestone"`
Expected: FAIL.

- [x] **Step 3: Add the detector**

Edit `scripts/progression.mjs` — append inside the `DETECTORS` array, after the remote detector added in Task 3:

```js
  {
    transcriptsRequired: true,
    detect(sessions, _facets, transcripts) {
      const m = sessions.find((s) =>
        transcripts.get(s.session_id)?.commands?.has("go"),
      );
      if (!m) return null;
      return {
        timestamp: m.start_time,
        dimension: "verification",
        milestone: "First /go composite invocation",
        borisTip: 73,
        evidence: "First session invoking /go (the post-work review reflex)",
        sessionId: m.session_id,
      };
    },
  },
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/progression.test.mjs -t "verification milestone"`
Expected: PASS.

- [x] **Step 5: Run the full test suite to verify no regressions across the project**

Run: `npx vitest run`
Expected: baseline + 3 new tests pass (so 622/622 if baseline was 619; recount from actual baseline at start of work — `npx vitest run --reporter=verbose 2>&1 | tail -3` gives the live count).

- [x] **Step 6: Commit**

```bash
git add scripts/progression.mjs scripts/__tests__/progression.test.mjs
git commit -m "$(cat <<'EOF'
feat(progression): verification detector — first /go invocation — CCE-33

Closes the verification-dim coverage gap on the progression timeline.
Cites Boris tip 73 (/go composite skill), not tip 14 (verification
generally) — tip 73 is the specific actionable signal the user
adopts, matching the existing detector cadence.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update probe-tracker spec

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

The CLAUDE.md hard rule: any probe-set change must update the tracker in the same PR. The new detectors don't add `satisfiedWhen` predicates or `probe-catalog.json` entries, but they DO add three new entries to the "Progression detectors / `scripts/progression.mjs`" registry layer in Part 1, and they shift the tracking status for Boris tips 35 / 48 / 73 in Part 2.

- [x] **Step 1: Locate the Part 1 progression-detectors section**

Run: `grep -n "progression" docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
Open the file to the matching section. If a "Progression detectors" / `scripts/progression.mjs` layer heading already exists in Part 1, append three rows under it. If it does not exist (the spec may have been written before progression had a registry section), create the layer heading with the three rows.

- [x] **Step 2: Add the three Part 1 registry rows**

Insert under the "Progression detectors" / `scripts/progression.mjs` layer:

```markdown
| `scheduled` first /loop\|/schedule\|/babysit | scheduled | First session invoking /loop, /schedule, or /babysit | tip 48 | P\* |
| `remote` first RemoteTrigger\|Push\|SendMessage | remote | First session firing a remote tool | tip 35 | E |
| `verification` first /go | verification | First session invoking /go | tip 73 | P\* |
```

Axis labels: `scheduled` and `verification` are transcripts-driven user-action signals → P\* (Platform behavior). `remote` is a tool-fire facet signal that feeds a milestone derived from `tool_counts` → E (Execution-flavor evidence). Match the existing column layout already in the file — column order may be (probe-field, dim, evidence, tip, axis) or similar; conform to whatever is already there.

- [x] **Step 3: Update Part 2 tip-coverage rows for tips 35, 48, 73**

Locate the Part 2 section listing every Boris tip and its tracking status (`✅` / `📊` / `🗣` / `❌`). For each of:

- **Tip 35 (Remote Control)** — bump remote-dim row's progression-detector column from empty → `✅` (or whatever the existing convention marks for "covered by a progression detector"). If the row was previously `🗣` (coaching-only) overall, re-evaluate whether `✅` is now appropriate given the new milestone.
- **Tip 48 (/loop & /schedule)** — same for scheduled dim.
- **Tip 73 (/go composite skill)** — same for verification dim.

If the Part 2 table has a per-tip ✅/📊/🗣/❌ tally row at the top or bottom, recount it after editing.

- [x] **Step 4: Re-derive the header counts**

The CLAUDE.md hard rule mandates re-deriving five counts in the header rather than guessing. From the project root, run:

```bash
node -e '
import("./app/data/boris-tip-index.json", { assert: { type: "json" } }).then(m => console.log("tips:", Object.keys(m.default).length));
import("./app/data/rubric.json", { assert: { type: "json" } }).then(m => {
  console.log("dimensions:", m.default.dimensions.length);
  console.log("next-actions:", m.default.dimensions.flatMap(d => d.nextActions || []).length);
});
import("./app/data/probe-catalog.json", { assert: { type: "json" } }).then(m => console.log("probe-catalog entries:", Object.keys(m.default).filter(k => k !== "_meta").length));
import("./scripts/run-assessment.mjs").then(m => {
  // Need a representative signals object — easiest is loading the live snapshot.
  import("./app/data/assessment.json", { assert: { type: "json" } }).then(a => {
    const summary = m.buildSignalsSummary({});
    console.log("signalsSummary keys (empty signals):", Object.keys(summary).length);
  });
});
'
```

If the import-assert syntax errors on your Node version, fall back to:

```bash
node --experimental-vm-modules -e '
const fs = await import("node:fs");
const tips = JSON.parse(fs.readFileSync("app/data/boris-tip-index.json", "utf8"));
console.log("tips:", Object.keys(tips).length);
const rubric = JSON.parse(fs.readFileSync("app/data/rubric.json", "utf8"));
console.log("dimensions:", rubric.dimensions.length);
console.log("next-actions:", rubric.dimensions.flatMap(d => d.nextActions || []).length);
const catalog = JSON.parse(fs.readFileSync("app/data/probe-catalog.json", "utf8"));
console.log("probe-catalog entries:", Object.keys(catalog).filter(k => k !== "_meta").length);
const { buildSignalsSummary } = await import("./scripts/run-assessment.mjs");
const summary = buildSignalsSummary({});
console.log("signalsSummary keys:", Object.keys(summary).length);
'
```

The signalsSummary key count is the one most easily miscounted (per CLAUDE.md: a regex over the function body silently under-counts shorthand properties, e.g. `hookEvents,` — which is how a wrong `65` briefly landed in this header). **Always derive by invoking, never by parsing.**

Update the header counts in the tracker file to whatever the script reports.

- [x] **Step 5: Verify with the tracker-counts machine-enforced test**

Run: `npx vitest run scripts/__tests__/tracker-counts.test.mjs`
Expected: PASS. The test asserts the five header counts match the live source. A stale count fails CI.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-probe-implementation-status.md
git commit -m "$(cat <<'EOF'
docs(tracker): record new progression detectors for scheduled/remote/verification — CCE-33

Per CLAUDE.md hard rule, every probe-set change must sync the tracker
in the same PR. Adds three rows to the Progression detectors / Part 1
registry, updates Part 2 tip-coverage status for tips 35/48/73, and
re-derives the five machine-enforced header counts via the live sources
(not regex-over-source — per the documented counting caveat).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Live verification + ship

**Files:**

- Modify: `app/data/progression.json` (overwritten by `npm run assess`)
- Modify: `app/data/assessment.json` (overwritten)

This task is half human-in-the-loop: it verifies on the user's real `~/.claude/usage-data` that the detectors fire against real signal availability, not just fixtures.

- [x] **Step 1: Run a full assessment with transcripts on**

```bash
npm run assess -- --include-transcripts --insights-lookback 30
```

Expected: exits 0, writes `app/data/assessment.json` and `app/data/progression.json`.

- [x] **Step 2: Inspect `progression.json` for the three new milestones**

```bash
node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync("app/data/progression.json", "utf8"));
const targets = ["scheduled", "remote", "verification"];
for (const t of targets) {
  const m = (p.milestones || []).find(x => x.dimension === t);
  console.log(t, m ? `✅ ${m.milestone} @ ${m.timestamp}` : "❌ no milestone");
}
'
```

Expected: all three print ✅ with a real ISO timestamp (the date the user first invoked /loop, fired a remote tool, or ran /go — typically a backdated date well before 2026-05-09's tracking-start wall).

If any prints ❌, the user has truly never adopted that workflow in their real data — that's a true-negative, not a bug. Skip Step 3 for that dim and report it in the PR description so a reviewer can validate.

- [x] **Step 3: Verify the timeline UI renders the milestones**

```bash
npm run dev
```

Open http://localhost:3737/progression and confirm the three new milestones appear at their telemetry-dated timestamps (NOT at "today"). Backdated milestones should appear in chronological order with the existing 9.

Use Cmd+C to kill the dev server when done.

- [x] **Step 4: Switch to ship**

The branch this work lives on is `docs/cce-33-spec` (the spec was committed there pre-implementation). Spec + plan + implementation + tracker update all ship as one PR.

Run: `/ship`

The chain handles test, verify-agent, simplify, code review, commit, push, PR open, and Jira transition. Halt rules per `~/.claude/skills/ship/spokes/halt-rules.md` if any stage objects.

Specifically expect:

- Stage 1 (test) — should land 622/622 if baseline was 619 + 3 new tests (recount from the actual baseline observed in Task 1 Step 5).
- Stage 4 (code review) — reviewer will read the design spec referenced in the plan; surface any "is this is the right behavior?" judgement calls to the user, don't override.
- Stage 7 (Jira) — auto-mode authorization is scoped per-action per CLAUDE.md, so the `transitionJiraIssue` call needs explicit user confirmation.

If `/ship` halts at Stage 0 because a PR already exists for the branch (e.g., if someone pushed `docs/cce-33-spec` early), dispatch the review agents manually per the documented `/ship` halt-recovery pattern.

---

## Self-review

**1. Spec coverage:** Walked through the spec section-by-section against the plan tasks:

- "Three new detector records" → Tasks 2, 3, 4 each add one ✅
- "scanTranscriptModes extension" → Task 1 ✅
- "Per-detector spec" (3 detectors with exact code) → Tasks 2, 3, 4 use the spec's code verbatim ✅
- "Tests" (one per detector + regression) → Tasks 2, 3, 4 each ship a positive test; regression covered by Task 1 Step 5 + Tasks 2-4 Step 5 each running the full progression file ✅
- "Probe-tracker update" → Task 5 ✅
- "Acceptance criteria" — all eight items map: three detectors (T2/3/4), commands Set (T1), unit tests (T2/3/4), regression (T1 Step 5 + T2-4 Step 5), tracker update (T5), green tests (T4 Step 5 + T6 Step 1), live assess populates milestones (T6 Step 2), UI shows milestones (T6 Step 3) ✅
- "Out of scope" — plan explicitly does NOT add multiple detectors per dim, does NOT back-date config milestones, does NOT add sub-feature breakdowns ✅
- "Risks and mitigations" — `scanTranscriptModes` return shape change is exercised by Task 1 Step 5 full test run; tracker drift is caught by Task 5 Step 5 tracker-counts test; Boris tip refs verified against rubric.json in the design ✅

**2. Placeholder scan:** No TBDs, no "appropriate error handling", no "similar to Task N". Every code block is complete and standalone. Every command has expected output. No "fill in" anywhere.

**3. Type consistency:** Detector record shape is identical in Tasks 2, 3, 4: `{transcriptsRequired, detect}`. Return-object shape is identical: `{timestamp, dimension, milestone, borisTip, evidence, sessionId}` — matches the existing 9 detectors in `progression.mjs:42-50`. Test helper names (`writeMeta`, `writeFacet`, `writeTranscript`, `daysAgo`, `NOW`) match the existing test file. Boris tip numbers (35, 48, 73) match both the rubric `borisTips` arrays and the design spec.

No issues found. Plan ready.

---

## Execution handoff

**Completed.** All six tasks shipped in PR #108 (merged 2026-06-01). The implementation followed the inline-execution path in a single session.

**Outcome summary:**

- `scanTranscriptModes` now emits a `commands: Set<string>` field on every session result (Task 1).
- Three detectors appended to `DETECTORS` in `scripts/progression.mjs`: `scheduled` (tip 48, transcripts-required), `remote` (tip 35, facets-only), `verification` (tip 73, transcripts-required) (Tasks 2–4).
- Three positive-case unit tests added to `scripts/__tests__/progression.test.mjs`; full suite green (Task 4 Step 5).
- Probe-tracker spec updated with three new Part 1 registry rows and Part 2 tip-coverage entries for tips 35/48/73; `tracker-counts.test.mjs` passes with unchanged header counts (Task 5).
- Live assessment against `~/.claude/usage-data/` produced backdated milestones: `scheduled` @ 2026-04-29, `remote` @ 2026-04-15, `verification` @ 2026-05-26. All three visible in the timeline UI at `http://localhost:3737/progression` (Task 6).
