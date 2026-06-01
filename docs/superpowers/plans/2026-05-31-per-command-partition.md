---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command partition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate posture-command counters in `scanTranscriptInvocations` behind a per-session `allowPosture` flag so observer and SDK-orchestrated sessions can no longer inflate scores by echoing the primary session's `<command-name>` markup. Preserve volume-command counting unconditionally so autonomous-workflow signal from any session kind survives. Enforce the partition contract at module load via a fail-loud boundary assertion.

**Architecture:** Two new module-level Sets (`POSTURE_COMMANDS` / `VOLUME_COMMANDS`) replace the implicit "everything counts everywhere" assumption. An exported `assertCommandPartition` helper asserts disjointness, full `TARGET_COMMANDS` coverage, and no dead classifications — called once at module load so a mis-classified command aborts the assessment immediately. Per-session loop calls `classifySessionKind` once per file, computes `allowPosture = kind === "interactive_cli" || kind === "unknown"`, and guards every posture counter behind that flag. Volume counters are structurally unchanged.

**Design spec:** `docs/superpowers/specs/2026-05-31-per-command-partition-design.md` (shipped PR #110)

**Ticket:** CCE-71

---

## File structure

| File | Purpose |
| ---- | ------- |
| Modify: `scripts/_usage-data.mjs` | Add Sets, `assertCommandPartition` helper + module-load call, `classifySessionKind` call, `allowPosture` guards |
| Modify: `scripts/__tests__/_usage-data.test.mjs` | 11 new `it` blocks (4 assertion-helper cases + 6 partition-behavior integration cases + 1 regression guard) |
| Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Partition footnote on Part 1 Transcripts layer posture-command rows |
| Modify: `CLAUDE.md` | "Known limitation" paragraph rewritten; "Conventions" one-liner; operational note |

---

## Task 1: Add POSTURE_COMMANDS / VOLUME_COMMANDS Sets and the assertCommandPartition helper

**Files:**

- Modify: `scripts/_usage-data.mjs`
- Modify: `scripts/__tests__/_usage-data.test.mjs`

- [x] **Step 1: Read the constant block to find the insertion point**

Run:

```bash
grep -n "PLANNING_SKILL_COMMANDS\|LEARNING_SKILL_COMMANDS\|TARGET_COMMANDS" scripts/_usage-data.mjs | head -20
```

Locate the block near lines 99 and 406–418 where `TARGET_COMMANDS`, `PLANNING_SKILL_COMMANDS`, and `LEARNING_SKILL_COMMANDS` are defined. Insert the new Sets immediately after the last existing constant in that group.

- [x] **Step 2: Add the two Sets**

Using the Edit tool on `scripts/_usage-data.mjs`, insert after `LEARNING_SKILL_COMMANDS`:

```js
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
export const VOLUME_COMMANDS = new Set(["loop", "schedule", "babysit", "go", "batch"]);
```

- [x] **Step 3: Add the assertCommandPartition helper and call it at module load**

Immediately after the two Sets, insert:

```js
export function assertCommandPartition(posture, volume, target) {
  const merged = new Set([...posture, ...volume]);
  if (posture.size + volume.size !== merged.size) {
    throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
  }
  for (const cmd of target) {
    if (!merged.has(cmd)) {
      throw new Error(
        `TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`,
      );
    }
  }
  for (const cmd of merged) {
    if (!target.has(cmd)) {
      throw new Error(
        `Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`,
      );
    }
  }
}

// Enforce partition invariants at module load. Adding a new TARGET_COMMANDS
// member without classifying it, or classifying a command not in TARGET_COMMANDS,
// aborts npm run assess before any score is written. Intentional fail-loud behavior
// (see CLAUDE.md ## Hard rules "Command counting honors the posture-vs-volume
// partition").
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

- [x] **Step 4: Add unit tests for the assertCommandPartition helper**

Append a `describe("assertCommandPartition")` block to `scripts/__tests__/_usage-data.test.mjs`:

```js
describe("assertCommandPartition", () => {
  it("throws on disjointness violation", () => {
    const posture = new Set(["color", "voice"]);
    const volume  = new Set(["color", "loop"]);
    const target  = new Set(["color", "voice", "loop"]);
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      "must be disjoint",
    );
  });

  it("throws when TARGET_COMMANDS member is not classified", () => {
    const posture = new Set(["color"]);
    const volume  = new Set(["loop"]);
    const target  = new Set(["color", "loop", "unclassified"]);
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      "not classified as posture or volume",
    );
  });

  it("throws when partition member is not in TARGET_COMMANDS (dead classification)", () => {
    const posture = new Set(["color", "ghost"]);
    const volume  = new Set(["loop"]);
    const target  = new Set(["color", "loop"]);
    expect(() => assertCommandPartition(posture, volume, target)).toThrow(
      "dead classification",
    );
  });

  it("does not throw for the live Sets", () => {
    expect(() =>
      assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS),
    ).not.toThrow();
  });
});
```

- [x] **Step 5: Run the new tests**

```bash
npx vitest run scripts/__tests__/_usage-data.test.mjs -t "assertCommandPartition"
```

Expected: 4 tests pass.

- [x] **Step 6: Run the full suite to confirm no regressions**

```bash
npx vitest run
```

Expected: all pre-existing tests pass; count increases by 4.

---

## Task 2: Add classifySessionKind call and allowPosture flag to the per-session loop

**Files:**

- Modify: `scripts/_usage-data.mjs`

- [x] **Step 1: Locate the top of the per-session loop**

Run:

```bash
grep -n "for (const path of sessionFiles)" scripts/_usage-data.mjs
```

The loop body begins around line 289. The insertion goes immediately after the loop's opening brace, before any `const` declarations that read transcript content.

- [x] **Step 2: Insert the classifySessionKind call and allowPosture derivation**

Using the Edit tool, prepend inside the loop body:

```js
const sessionKind = await classifySessionKind(path);
// Posture commands are counted only when the session represents direct
// user interaction. Observer and SDK-orchestrated sessions echo the primary
// session's <command-name> markup and would double-count user commands that
// were never actually typed in that session.
// "unknown" is treated as interactive_cli: the conservative fallback —
// sessions predating entrypoint tracking are more likely interactive than not.
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
// Note: classifySessionKind can return "subagent", but the scanner reads
// projects/*/*.jsonl (exactly two levels deep). Real subagent transcripts
// live at projects/<project>/<uuid>/subagents/agent-*.jsonl (depth 4) and
// are never reached by this traversal. No explicit subagent skip is needed
// today; if traversal becomes recursive, add:
//   if (sessionKind === "subagent") continue;
```

- [x] **Step 3: Run the full suite**

```bash
npx vitest run
```

Expected: all tests still pass. The `allowPosture` variable is computed but not yet guarding any counter, so no behavioral change at this step.

---

## Task 3: Gate posture-command counters behind allowPosture

**Files:**

- Modify: `scripts/_usage-data.mjs`

- [x] **Step 1: Locate the command-counting block**

Run:

```bash
grep -n "colorCommandUses\|focusCommandUses\|rewindCommandUses" scripts/_usage-data.mjs | head -20
```

Locate the block around lines 312–329 inside the per-line loop.

- [x] **Step 2: Apply the partition gates**

Using the Edit tool, replace the flat command-counting block with the partitioned form:

```js
const uText = userMessageText(line);
if (uText) {
  const found = extractSlashCommands(uText);
  // Volume commands — counted across all session kinds the scanner sees.
  // Autonomous-workflow signal is real regardless of which session emitted it.
  if (found.has("go"))       counts.goCommandUses++;
  if (found.has("batch"))    counts.batchCommandUses++;
  if (found.has("schedule")) counts.scheduleCommandUses++;
  if (found.has("loop"))     sessionHasLoop = true;
  if (found.has("babysit"))  sessionHasBabysit = true;
  // Posture commands — counted only when allowPosture is true
  // (interactive_cli or unknown — the conservative fallback).
  if (found.has("focus")  && allowPosture) counts.focusCommandUses++;
  if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;
  if (found.has("simplify")               && allowPosture) sessionHasSimplify = true;
  if (found.has("btw")                    && allowPosture) sessionHasBtw      = true;
  if (found.has("voice")                  && allowPosture) sessionHasVoice    = true;
  if (found.has("clear")                  && allowPosture) sessionHasClear    = true;
  if (found.has("compact")                && allowPosture) sessionHasCompact  = true;
  if (found.has("color")                  && allowPosture) sessionHasColor    = true;
  if (found.has("fewer-permission-prompts") && allowPosture) sessionHasFewerPerms = true;
  // effortMax uses hasEffortMax(uText) — a regex over the full user text —
  // not extractSlashCommands. It is outside the partition by design.
  if (hasEffortMax(uText)) sessionHasEffortMax = true;
}
```

- [x] **Step 3: Run the full suite**

```bash
npx vitest run
```

Expected: all pre-existing tests pass. Existing transcript fixtures use `entrypoint: "cli"` or omit entrypoint (→ `"unknown"`); both produce `allowPosture = true`, so no existing assertions break.

---

## Task 4: Add partition-behavior integration tests

**Files:**

- Modify: `scripts/__tests__/_usage-data.test.mjs`

**Fixture markup convention:** `extractSlashCommands` matches `/<command-name>\/([\w:-]+)/g` — the regex requires a literal `/` inside the tag. Use `<command-name>/color</command-name>` (with slash), **not** `<command-name>color</command-name>`. The slash-less form is valid for `scanTranscriptModes` (a different function) but silently produces zero counts here.

Each test creates a real temporary directory with `mkdtempSync` + `writeFileSync` and cleans up with `rmSync`, matching the existing testing convention.

- [x] **Step 1: Add Test 1 — posture command in observer session does NOT count**

```js
it("posture command in observer session does not count", async () => {
  const dir  = mkdtempSync(join(tmpdir(), "udata-obs-"));
  const proj = join(dir, "projects", "obs-session");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "foo.jsonl"), [
    JSON.stringify({ entrypoint: "sdk-cli", type: "system" }),
    JSON.stringify({
      type: "human",
      message: { role: "user", content: [{ type: "text", text: "<command-name>/color</command-name>" }] },
    }),
  ].join("\n"));
  const signals = await gatherInsightsSignals({ projectsRoot: join(dir, "projects") });
  expect(signals.colorCommandUses).toBe(0);
  rmSync(dir, { recursive: true });
});
```

- [x] **Step 2: Add Test 2 — volume command in observer session DOES count**

Same fixture shape (`entrypoint: "sdk-cli"`) but `<command-name>/loop</command-name>`. Assert `loopCommandUses >= 1`.

- [x] **Step 3: Add Test 3 — posture command in SDK-orchestrated session does NOT count**

Fixture with `entrypoint: "sdk-cli"` in a project path that does NOT contain `observer-sessions/` in the name (verifying the partition applies to `sdk_orchestrated` kind, not just observer paths). Assert `colorCommandUses === 0`.

- [x] **Step 4: Add Test 4 — volume command in SDK-orchestrated session DOES count**

Same SDK-cli fixture but `<command-name>/loop</command-name>`. Assert `loopCommandUses >= 1`. Confirms the regression from v0.9.17 (which deleted this signal) does not recur.

- [x] **Step 5: Add Test 5 — posture command in interactive session DOES count**

```js
it("posture command in interactive session counts", async () => {
  const dir  = mkdtempSync(join(tmpdir(), "udata-interactive-"));
  const proj = join(dir, "projects", "interactive-session");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "normal.jsonl"), [
    JSON.stringify({ entrypoint: "cli", type: "system" }),
    JSON.stringify({
      type: "human",
      message: { role: "user", content: [{ type: "text", text: "<command-name>/color</command-name>" }] },
    }),
  ].join("\n"));
  const signals = await gatherInsightsSignals({ projectsRoot: join(dir, "projects") });
  expect(signals.colorCommandUses).toBeGreaterThanOrEqual(1);
  rmSync(dir, { recursive: true });
});
```

- [x] **Step 6: Add Test 6 — unknown entrypoint falls back to interactive**

Same fixture shape but omit the `entrypoint` field entirely from the first line. `classifySessionKind` returns `"unknown"`. Assert `colorCommandUses >= 1` (the conservative-fallback case).

- [x] **Step 7: Run all new tests**

```bash
npx vitest run scripts/__tests__/_usage-data.test.mjs
```

Expected: all pass.

- [x] **Step 8: Run the full suite and record the new count**

```bash
npx vitest run
```

Expected: baseline + 10 new `it` blocks (4 assertion-helper + 6 partition-behavior). Record the new total for the commit message.

---

## Task 5: Annotate the probe-implementation-status tracker

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

The five machine-enforced header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / signalsSummary keys) are unchanged — no new probes, no catalog additions. Only annotation footnotes on existing rows.

- [x] **Step 1: Locate posture-command rows in the Part 1 Transcripts layer**

Run:

```bash
grep -n "color\|voice\|btw\|focus\|rewind\|simplify\|compact\|clear\|fewer-permission" \
  docs/superpowers/specs/2026-05-25-probe-implementation-status.md | head -30
```

- [x] **Step 2: Add a partition footnote to each posture-command row**

For each of `color`, `voice`, `btw`, `focus`, `rewind`, `simplify`, `compact`, `clear`, `fewer-permission-prompts` in the Part 1 Transcripts layer, append `¹` to the row's description column and add a footnote at the bottom of that table section:

```
¹ Counted only when `classifySessionKind` returns `"interactive_cli"` or `"unknown"`. Observer and SDK-orchestrated sessions are excluded (`POSTURE_COMMANDS` partition, PR #110).
```

Volume-command rows (`loop`, `schedule`, `babysit`, `go`, `batch`) are left unannotated.

- [x] **Step 3: Run tracker CI check**

```bash
npx vitest run scripts/__tests__/tracker-counts.test.mjs
```

Expected: all pass. The five header counts are unchanged — no new probes, no new catalog entries.

---

## Task 6: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

Three targeted edits. The v0.9.17 story must be **preserved**, not deleted — future contributors triaging similar regressions need the historical context.

- [x] **Step 1: Rewrite the "Known limitation / deferred follow-up" paragraph**

Find the block that begins with "Command counting has the same posture-vs-volume split" (or similar — search for "posture-vs-volume split" if the opener has drifted). Replace it with:

- Opening sentence: "**Resolved in PR #110** — the per-command partition is now implemented and enforced."
- One-paragraph summary of the v0.9.17 regression: blanket exclusion of observer/sdk/subagent from `scanTranscriptInvocations` accidentally discarded genuine `/loop`/`/schedule` autonomous-workflow signal, regressing `scheduled` 75→63. Reverted. The per-command partition is the correct surgical fix.
- Pointer: "`POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the canonical source of truth."

- [x] **Step 2: Add a "Conventions" one-liner**

Under `## Hard rules` (or wherever command-counting conventions live), add:

> **Command counting honors the posture-vs-volume partition** — `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` are the canonical source of truth. Posture commands count only from `interactive_cli` or `"unknown"` sessions; volume commands count across all session kinds. A fail-loud `assertCommandPartition` runs at module load and catches drift (disjointness, missing classification, dead classification).

- [x] **Step 3: Add an operational note**

In the same block or a short paragraph after, add:

> **Operational note:** if `npm run assess` exits non-zero with no `assessment.json` written, check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition errors from the boundary assertion before assuming an environmental issue.

- [x] **Step 4: Verify no test regressions**

```bash
npx vitest run
```

Expected: count unchanged (CLAUDE.md edits have no effect on test fixtures).

---

## Task 7: Live delta verification

**Files:** none (live run — verification only)

- [x] **Step 1: Capture pre-partition baseline**

```bash
npm run assess -- --include-transcripts --insights-lookback 30 --no-slack --print \
  2>&1 | tee /tmp/pre-partition-assess.txt
```

Record the following values from the output:
- `rewindCommandUses` (target: the pre-partition count; at-risk because `/rewind` has no history MAX-merge floor)
- `scheduled` dimension score (must remain ≥ 75 after the fix lands)
- Top-3 priority next-actions

- [x] **Step 2: Smoke-test the boundary assertion with synthetic drift**

Temporarily add a spurious command to `POSTURE_COMMANDS` that isn't in `TARGET_COMMANDS`:

```js
const POSTURE_COMMANDS = new Set([
  // existing members …
  "synthetic-drift-test",  // intentional bad entry
]);
```

Run `npm run assess --no-slack`. Expect abort with stack trace containing "dead classification". Revert the edit before continuing.

- [x] **Step 3: Run the post-partition assessment**

```bash
npm run assess -- --include-transcripts --insights-lookback 30 --no-slack --print \
  2>&1 | tee /tmp/post-partition-assess.txt
```

- [x] **Step 4: Diff the two outputs and verify**

```bash
diff /tmp/pre-partition-assess.txt /tmp/post-partition-assess.txt
```

Expected:
- Posture-command counts trend **down or flat** (color, btw, voice, clear, compact, simplify, fewer-perms, focus, rewind).
- Volume-command counts **unchanged** (schedule, go, batch, loop, babysit).
- `rewindCommandUses` post ≥ 1 (the `>= 1` satisfiedWhen threshold must still be met).
- `scheduled` dimension score stays ≥ 75 (the exact regression that v0.9.17 introduced must not recur).

If `rewindCommandUses` drops to 0, investigate: either there are no real interactive `/rewind` invocations in the lookback window, or the `"unknown"` fallback is misfiring on a legitimate session. Do not ship until this is ≥ 1 or the threshold predicate is adjusted.

- [x] **Step 5: No commit** (verification only)

---

## Task 8: Ship the PR

**Files:**

- Commit: all changes across Tasks 1–6

- [x] **Step 1: Stage all modified files**

```bash
git add scripts/_usage-data.mjs \
        scripts/__tests__/_usage-data.test.mjs \
        docs/superpowers/specs/2026-05-25-probe-implementation-status.md \
        CLAUDE.md
```

Also stage the plan and spec docs if not already committed:

```bash
git add docs/superpowers/specs/2026-05-31-per-command-partition-design.md \
        docs/superpowers/plans/2026-05-31-per-command-partition.md
```

- [x] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(transcripts): per-command posture-vs-volume partition — CCE-71

Introduce POSTURE_COMMANDS / VOLUME_COMMANDS Sets in _usage-data.mjs
and gate posture-command counters behind allowPosture (interactive_cli
or unknown). Volume commands remain unconditional across all session
kinds. A fail-loud assertCommandPartition boundary assertion enforces
disjointness, full TARGET_COMMANDS coverage, and no dead classifications
at module load.

Root cause: observer sessions echo the primary session's <command-name>
markup, inflating posture counters. The v0.9.17 blanket-exclusion fix
regressed scheduled 75→63 by discarding real /loop /schedule signal.
Per-command partition is the surgical fix.

- 11 new unit tests (4 assertCommandPartition helper + 6 partition-behavior
  integration + 1 regression guard confirming volume signal preserved)
- probe-implementation-status tracker annotated for posture rows
- CLAUDE.md updated: "Conventions" partition contract, operational failsafe
  note, v0.9.17 historical context preserved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Step 3: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --base main \
  --title "feat(transcripts): per-command posture-vs-volume partition — CCE-71" \
  --body-file /tmp/pr-body-per-command-partition.md
```

Write the PR body to `/tmp/pr-body-per-command-partition.md` with the Write tool before running. Body should summarize: root cause (observer echo), v0.9.17 regression story, fix shape (two Sets + assertion + allowPosture gate), test additions, and the `scheduled` regression prevention.

- [x] **Step 4: Run /ship and confirm**

Follow the `/ship` workflow. Verify:
- Stage 0 pre-flight passes
- Verify-agent confirms behavioral correctness (partition gates, assertion behavior, volume preservation)
- Code review approves
- Squash-merge from the main checkout (not from inside a worktree — per CLAUDE.md conventions)

---

## Self-review

### Design spec coverage

| Spec section | Plan task(s) |
| --- | --- |
| Two module-level Sets (POSTURE / VOLUME) | Task 1 Step 2 |
| `assertCommandPartition` helper + module-load call | Task 1 Step 3 |
| Helper unit tests (4 cases) | Task 1 Step 4 |
| `classifySessionKind` call + `allowPosture` flag | Task 2 Step 2 |
| Posture counters gated behind `allowPosture` | Task 3 Step 2 |
| Volume counters unchanged | Task 3 Step 2 (volume block is structurally unchanged) |
| `effortMax` stays outside partition by design | Task 3 Step 2 (inline comment) |
| Fallback semantics: `"unknown"` → interactive | Task 2 Step 2 (inline comment); Test 6 |
| Subagent traversal-vs-classifier mismatch note | Task 2 Step 2 (inline comment) |
| Integration tests (Tests 1–6) | Task 4 Steps 1–6 |
| Probe-tracker annotation | Task 5 |
| CLAUDE.md rewrite + conventions + operational note | Task 6 |
| Live delta verification + `/rewind` regression risk | Task 7 |
| Ship | Task 8 |

No gaps.

### Placeholder scan

Searched for "TBD", "TODO", "implement later", "fill in". None present. All Edit anchor contexts are described with enough surrounding code that an implementer can locate them unambiguously. All test bodies are complete JS. Commit message is verbatim heredoc.

### Identifier consistency

- `POSTURE_COMMANDS` — defined Task 1, called-in-assertion Task 1, guarding counters Task 3, tested Tasks 1 and 4
- `VOLUME_COMMANDS` — same pattern
- `assertCommandPartition` — defined and exported Task 1, called at module load Task 1, tested Task 1 (pure helper tests); the export allows test imports without dynamic-import cache games
- `allowPosture` — computed Task 2, consumed Task 3; local to the per-session loop scope; never referenced outside it
- `sessionKind` — computed Task 2, read by `allowPosture` expression

No drift between tasks.

### Risks acknowledged

- **`/rewind` has no history MAX-merge floor.** Task 7 Step 4 explicitly requires `rewindCommandUses` post ≥ 1; do not ship if this drops to 0 until the threshold predicate is adjusted or investigated.
- **Module-load assertion causes total assessment blackout.** Intentional fail-loud behavior. Task 7 Step 2 smoke-tests it. CLAUDE.md operational note (Task 6 Step 3) tells operators to check stderr before assuming an environmental issue.
- **Future recursive traversal could silently reintroduce subagent noise.** Task 2 Step 2 inline comment flags the `"subagent"` path and the guard to add if traversal depth ever changes.
- **Score deltas at first run after the fix.** Expected: posture counts drop where observer markup was inflating. Task 7 Step 3–4 captures pre/post for at-risk counters. The MAX-merge history floor on most posture commands means dashboard impact is modest.
