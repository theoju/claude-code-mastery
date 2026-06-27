---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Decision: per-command partition for transcript command counting (CCE-71)

**Date:** 2026-06-01  
**PR:** [#110](https://github.com/theoju/claude-code-self-assessment/pull/110)  
**Ticket:** CCE-71  
**Files changed:** `scripts/_usage-data.mjs`, `scripts/__tests__/_usage-data.test.mjs`

## Problem

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` walked `~/.claude/projects/*/*.jsonl` without any session-kind filter. Observer sessions — which monitor a primary session's work and emit structured observations — replicate the primary session's `<command-name>cmd</command-name>` markup verbatim. So every posture command you type as an interactive user also gets counted a second (or third) time from the observer transcript. The result: `focusCommandUses` was reported as 15 when the real interactive count was 1. `simplifyCommandUses` and `rewindCommandUses` read as non-zero when every instance was purely observer-driven.

A previous release (v0.9.16) masked the problem for `/color` by accident: `colorCommandUses` is MAX-merged from `~/.claude/history.jsonl`, which only contains typed user prompts from interactive sessions. The floor from the history-derived side happened to suppress the inflated transcript count. The transcript count itself remained polluted.

v0.9.17 attempted a blanket fix — exclude `observer`, `sdk_orchestrated`, and `subagent` from `scanTranscriptInvocations` entirely — and regressed the `scheduled` dimension score from 75 to 63 by deleting genuine `/loop` and `/schedule` autonomous-workflow signal. That change was reverted.

## Decision

Introduce a **per-command partition** inside `scanTranscriptInvocations`. Commands fall into exactly one of two named sets:

- **`POSTURE_COMMANDS`** — user-posture signals: `/color`, `/voice`, `/focus`, `/btw`, `/clear`, `/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`. Counted only when `classifySessionKind` returns `interactive_cli` or `unknown`.
- **`VOLUME_COMMANDS`** — autonomous-workflow volume: `/loop`, `/schedule`, `/babysit`, `/go`, `/batch`. Counted across every session kind the scanner sees.

The distinction: posture commands reveal how you have configured your personal interaction style. An observer session echoing `/color` from the primary session's markup does not mean you invoked `/color`. Volume commands represent actual automation work dispatched to Claude — that signal is genuine regardless of whether it was emitted by an observer, an SDK-orchestrated session, or a direct interactive session.

`unknown` is treated as eligible for posture counting, not excluded. A session with no detectable `entrypoint` field in its first five lines is more likely a legitimate interactive session predating entrypoint tracking than a hostile observer transcript. The conservative fallback is to include it.

## Implementation

Three additions to `scripts/_usage-data.mjs`:

**Two module-level Sets** exported alongside `TARGET_COMMANDS`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear",
  "compact", "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

**A fail-loud boundary assertion** exported as `assertCommandPartition(posture, volume, target)` and called at module load. It enforces three invariants: the two sets are disjoint, their union covers all of `TARGET_COMMANDS`, and no partition member is absent from `TARGET_COMMANDS`. If any invariant is violated, the entire `npm run assess` invocation aborts before writing `assessment.json` — there is no silent miscounting. If you add a new command to `TARGET_COMMANDS` without classifying it, or remove a command from `TARGET_COMMANDS` while leaving it in a partition set, the assertion fires on the next run.

**A per-session kind check** at the top of the session loop:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Each posture-command counter is then gated behind `allowPosture`. Volume-command counters remain structurally unchanged. `effortMax` detection uses `hasEffortMax(uText)` — a regex over the prompt text rather than slash-command extraction — so it sits outside the partition and stays unconditional.

One operational note: `classifySessionKind` also returns `"subagent"` for paths matching `.../subagents/agent-*.jsonl`, but the scanner traversal reads `projectsRoot/*/*.jsonl` (exactly two directory levels deep). Real subagent transcripts live at depth four (`projects/<project>/<uuid>/subagents/agent-*.jsonl`) and are not reached by the current traversal. An explicit `if (sessionKind === "subagent") continue` would be dead code today; the inline comment at the partition site documents this so a future traversal change can add the guard explicitly.

## Tests

Eleven new unit tests were added to `scripts/__tests__/_usage-data.test.mjs` using real-filesystem fixtures (`mkdtempSync` + `writeFileSync`, no mocks):

- **Test 1:** posture command (`/color`) in an observer session → `colorCommandUses === 0`
- **Test 2:** volume command (`/loop`) in an observer session → `loopCommandUses === 1`
- **Test 3:** posture command (`/color`) in an SDK-orchestrated session → `colorCommandUses === 0`
- **Test 4:** volume command (`/loop`) in an SDK-orchestrated session → `loopCommandUses === 1`
- **Test 5:** posture command (`/color`) in an interactive (`entrypoint: "cli"`) session → `colorCommandUses === 1`
- **Test 6:** posture command in a session with no `entrypoint` field (falls back to `"unknown"`) → `colorCommandUses === 1`
- **Tests 7a–7d:** `assertCommandPartition` helper directly, against forged Sets, covering the disjointness violation, uncategorized-member case, dead-classification case, and happy path with the live sets

All pre-existing tests pass unchanged — their transcript fixtures use `entrypoint: "cli"` or no `entrypoint` (both map to `allowPosture = true`), so the partition is purposefully non-breaking for the existing test suite.

## Outcome

After the fix: `focusCommandUses` dropped from 15 to 1, exposing that 14 of 15 prior counts were false positives from observer markup. `simplifyCommandUses` and `rewindCommandUses` dropped to zero, confirming their non-zero values were entirely observer-driven. Volume commands (`scheduleCommandUses`, `loopCommandUses`, etc.) were unchanged. The `scheduled` dimension regression from the v0.9.17 attempt did not recur.

The MAX-merge from `~/.claude/history.jsonl` (at `run-assessment.mjs`) still runs downstream and provides a conservative floor for posture commands that appear in history. After the partition, the LHS of that merge is the clean interactive count rather than the inflated transcript count.

## Drift prevention

If `npm run assess` exits non-zero and no `assessment.json` is written, check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition errors from the boundary assertion before assuming an environmental issue. The assertion runs at module load — before any signals are gathered — so a partition-drift error surfaces as an immediate abort with a descriptive stack trace.

The canonical partition source is `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `scripts/_usage-data.mjs`. The `CLAUDE.md` hard rules section documents the same partition and references these Sets as the authoritative list.
