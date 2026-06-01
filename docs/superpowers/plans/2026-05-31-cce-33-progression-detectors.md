---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33 — Progression Milestone Detectors (scheduled / remote / verification)

> **For agentic workers:** Use `superpowers:executing-plans` to work through this task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three telemetry-dated milestone detectors to `scripts/progression.mjs` — `scheduled`, `remote`, and `verification` — closing the coverage gap called out in CLAUDE.md. Before this PR the timeline tracked 8 of 12 scored dimensions; after it covers 11.

**Ticket:** CCE-33  
**Design spec:** `docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md`  
**PR:** [#108](https://github.com/theoju/claude-code-self-assessment/pull/108)

**Architecture summary:**

| Detector | Tip | Trigger condition |
| --- | --- | --- |
| `scheduled` | 48 | First `/loop`, `/schedule`, or `/babysit` command invocation found in transcripts |
| `remote` | 35 | First `RemoteTrigger`, `PushNotification`, or `SendMessage` tool-use entry |
| `verification` | 73 | First `/go` command invocation found in transcripts |

The two transcript-dependent detectors (`scheduled`, `verification`) consume a new `commands: Set<string>` field added to each session object returned by `scanTranscriptModes` in `_usage-data.mjs`. The `remote` detector reads tool-use events already present in the session-meta facets.

All changes are purely additive — no existing field is renamed or removed.

---

## File map

| File | Change |
| --- | --- |
| `scripts/_usage-data.mjs` | Add `commands: Set<string>` field to `scanTranscriptModes` session objects |
| `scripts/progression.mjs` | Add three detector entries: `scheduled`, `remote`, `verification` |
| `scripts/__tests__/progression.test.mjs` | Unit tests for the three new detectors |
| `docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md` | Design spec (companion doc) |
| `docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md` | This plan |
| `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` | Update header to note CCE-33 landed, no probe-set count changes |

---

## Task 1: Extend `scanTranscriptModes` with per-session command set

**Files:**

- Modify: `scripts/_usage-data.mjs`

- [x] **Step 1: Locate `scanTranscriptModes` and inspect the current session-object shape**

  Read `scripts/_usage-data.mjs` and identify the object each session entry returns. Confirm there is no existing `commands` field.

- [x] **Step 2: Accumulate slash-command names into a `Set<string>` per session**

  Inside the per-session JSONL scan loop, detect assistant turns whose text contains a `/command` invocation (same pattern the posture-command counters use). Collect the bare names (without the leading `/`) into a `Set`.

- [x] **Step 3: Attach the set to the session object as `commands`**

  Return `commands` alongside the existing fields (`sessionId`, `kind`, `modes`, etc.). Default to an empty `Set` for sessions with no command entries.

- [x] **Step 4: Verify `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition still passes**

  Run `npx vitest run scripts/__tests__/usage-data.test.mjs` (or the full suite) and confirm the `assertCommandPartition` boundary assertion still exits cleanly. The new field does not alter counting logic, only surfaces the raw set for downstream consumers.

---

## Task 2: Implement the `scheduled` milestone detector

**Files:**

- Modify: `scripts/progression.mjs`

- [x] **Step 1: Locate the detectors array in `progression.mjs`**

  The file exports (or internally constructs) an array of detector objects, each with an `id`, tip reference, label, and a predicate over the session stream. Identify the correct insertion point after the existing detectors.

- [x] **Step 2: Write the `scheduled` detector**

  ```js
  {
    id: "scheduled",
    tip: 48,
    label: "First scheduled / looped workflow",
    detect(sessions) {
      for (const s of sessions) {
        if (
          s.commands.has("loop") ||
          s.commands.has("schedule") ||
          s.commands.has("babysit")
        ) {
          return s.start_time;   // ISO timestamp from session-meta
        }
      }
      return null;
    },
  }
  ```

  The `sessions` array is ordered oldest-first by `start_time`; returning `s.start_time` from the first matching session gives the earliest real timestamp.

- [x] **Step 3: Confirm the label and tip number against `rubric.json`**

  `scheduled` maps to dimension `scheduled`; Boris tip 48 is the autonomous-workflow tip. Verify both in `app/data/rubric.json` before committing.

---

## Task 3: Implement the `remote` milestone detector

**Files:**

- Modify: `scripts/progression.mjs`

- [x] **Step 1: Identify the tool-use field in session-meta facets**

  Empirically verify that session-meta entries carry a `toolsUsed` (or equivalent) field listing tool names. Do not score against a field that doesn't exist — see the "Empirically verify telemetry fields" hard rule in CLAUDE.md.

- [x] **Step 2: Write the `remote` detector**

  ```js
  {
    id: "remote",
    tip: 35,
    label: "First remote / mobile trigger",
    detect(sessions) {
      const REMOTE_TOOLS = new Set([
        "RemoteTrigger",
        "PushNotification",
        "SendMessage",
      ]);
      for (const s of sessions) {
        const tools = s.toolsUsed ?? [];
        if (tools.some((t) => REMOTE_TOOLS.has(t))) {
          return s.start_time;
        }
      }
      return null;
    },
  }
  ```

- [x] **Step 3: Confirm field existence in a real facet file**

  Run a quick one-liner against `~/.claude/usage-data/facets/` to confirm `toolsUsed` (or the actual field name) is populated before merging. If the field name differs, correct the detector — don't guess.

---

## Task 4: Implement the `verification` milestone detector

**Files:**

- Modify: `scripts/progression.mjs`

- [x] **Step 1: Write the `verification` detector**

  ```js
  {
    id: "verification",
    tip: 73,
    label: "First verification run (/go)",
    detect(sessions) {
      for (const s of sessions) {
        if (s.commands.has("go")) {
          return s.start_time;
        }
      }
      return null;
    },
  }
  ```

  `/go` is classified as a volume command in `VOLUME_COMMANDS` (the verification-workflow trigger), so it appears in `s.commands` for every session kind — no posture-filter needed here.

- [x] **Step 2: Cross-check against the command partition**

  Confirm `"go"` is in `VOLUME_COMMANDS` in `scripts/_usage-data.mjs` (not in `POSTURE_COMMANDS`) so the detector fires on autonomous sessions as well as interactive ones.

---

## Task 5: Write unit tests for the three new detectors

**Files:**

- Modify: `scripts/__tests__/progression.test.mjs`

- [x] **Step 1: Add a fixture builder for sessions with commands**

  Extend (or add alongside) the existing fixture helpers so you can construct sessions that carry a `commands: Set<string>` field and a `start_time` ISO string.

- [x] **Step 2: Add `scheduled` detector tests**

  - No matching sessions → returns `null`
  - Session with `"loop"` command → returns that session's `start_time`
  - Session with `"schedule"` command → returns that session's `start_time`
  - Session with `"babysit"` command → returns that session's `start_time`
  - Two sessions, first matches → returns the earlier timestamp

- [x] **Step 3: Add `remote` detector tests**

  - No matching sessions → returns `null`
  - Session with `RemoteTrigger` in `toolsUsed` → returns `start_time`
  - Session with `PushNotification` → returns `start_time`
  - Session with `SendMessage` → returns `start_time`

- [x] **Step 4: Add `verification` detector tests**

  - No matching sessions → returns `null`
  - Session with `"go"` in commands → returns `start_time`
  - Sdk-orchestrated session with `"go"` → returns `start_time` (volume command, no posture filter)

- [x] **Step 5: Run the suite and confirm all pass**

  ```bash
  npx vitest run scripts/__tests__/progression.test.mjs
  ```

---

## Task 6: Update the probe-implementation-status tracker

**Files:**

- Modify: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`

- [x] **Step 1: Add a note in the tracker header**

  Insert a sentence in the "Validated against" preamble noting that **PR #108 / CCE-33** added three progression milestone detectors for `scheduled` tip 48, `remote` tip 35, and `verification` tip 73 — no probe-set change, no count changes.

- [x] **Step 2: Verify the CI-enforced header counts are unchanged**

  The five machine-enforced counts (tips, dimensions, next-actions, probe-catalog entries, `signalsSummary` keys) must stay stable — these detectors live in `progression.mjs`, not in `probe-catalog.json` or the rubric. Confirm by running:

  ```bash
  npx vitest run scripts/__tests__/tracker-counts.test.mjs
  ```

---

## Task 7: Commit and open PR

- [x] **Step 1: Stage all modified files**

  ```bash
  git add scripts/_usage-data.mjs \
          scripts/progression.mjs \
          scripts/__tests__/progression.test.mjs \
          docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md \
          docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md \
          docs/superpowers/specs/2026-05-25-probe-implementation-status.md
  ```

- [x] **Step 2: Commit**

  ```bash
  git commit -m "feat(progression): add scheduled/remote/verification milestone detectors — CCE-33"
  ```

- [x] **Step 3: Open PR**

  ```bash
  gh pr create --base main \
    --title "feat(progression): add scheduled/remote/verification detectors — CCE-33" \
    --body-file /tmp/cce33-pr-body.md
  ```

- [x] **Step 4: Verify CI passes, then squash-merge**

  Confirm all checks green. Squash-merge from the main checkout to avoid the `main is already checked out` worktree failure (see CLAUDE.md conventions).

---

## Verification checklist (post-merge)

- [ ] `npm run assess` completes without error and writes `app/data/assessment.json`
- [ ] `app/data/progression.json` contains entries for `scheduled`, `remote`, and `verification`
- [ ] Timeline page (`/progression`) renders the new milestones when the signals are present
- [ ] `npx vitest run` passes all tests (564+ tests, ~5s)
- [ ] CLAUDE.md coverage-gap note for CCE-33 is stale — update to reflect that the three detectors shipped in PR #108
