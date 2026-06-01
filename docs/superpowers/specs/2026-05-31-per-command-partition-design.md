---
status: shipped
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
---

# Per-command partition for observer-session false positives

**Status:** Shipped — PR #110 (2026-05-31)
**Ticket:** CCE-71
**Related cycles:** v0.9.16 (`/color` from `history.jsonl` — `/Users/theo/Projects/claude-extensions/CLAUDE.md:160`-ish, PR #96), v0.9.17 (the blanket-fix that regressed `scheduled` 75→63 and was reverted)

## Goal

Stop posture-command counters in `scanTranscriptInvocations` from inflating when an observer session quotes the primary session's `<command-name>` markup. Preserve broad volume-command counting so autonomous-workflow signal (`/loop`, `/schedule`, `/babysit`) survives when fired from SDK-orchestrated or observer-context sessions.

The fix is structurally small (~15 lines added to one function) but conceptually meaningful: it codifies the documented "posture vs volume" partition that lives in CLAUDE.md as a deferred follow-up. After this lands, the partition is no longer a latent constraint a future contributor might violate — it's enforced at the scanner boundary with a fail-loud assertion.

## Context

`scripts/_usage-data.mjs::scanTranscriptInvocations` (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:236`) walks `~/.claude/projects/*/*.jsonl` and counts slash-command occurrences per session. Today the function applies **no session-kind filter** — it counts every transcript including observer sessions (which monitor a primary session's work and emit structured observations) and subagent sessions (mechanical spawned work). Observer sessions in particular replicate the primary session's `<command-name>cmd</command-name>` markup, which double-counts every command that was actually a single user invocation.

The v0.9.16 release fixed `/color` for the wrong reason by accident: `colorCommandUses` is now MAX-merged from `~/.claude/history.jsonl` (`/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:150` via the `maxProbe` helper), which only contains _typed_ user prompts from interactive sessions. The merge masks the false-positive bug for `/color` and similar history-listed commands — but only by being conservative on the right (history) side. The transcript count itself remains polluted.

The v0.9.17 cycle attempted a blanket fix (exclude `observer`, `sdk_orchestrated`, and `subagent` from `scanTranscriptInvocations` entirely) and regressed `scheduled` from 75 to 63 by deleting genuine `/loop` / `/schedule` autonomous-workflow signal. CLAUDE.md (`/Users/theo/Projects/claude-extensions/CLAUDE.md:163`-ish, search for "Command counting has the same posture-vs-volume split") names the correct shape: a **per-command partition** that excludes non-interactive sessions only for **posture** commands while leaving **volume** commands counting broadly.

## Architecture

Single localized change in `scripts/_usage-data.mjs` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:236-330`. Three additions:

### 1. Two named module-level Sets

Inserted near the existing `PLANNING_SKILL_COMMANDS` / `LEARNING_SKILL_COMMANDS` constants at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:406`-418:

```js
const POSTURE_COMMANDS = new Set([
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
const VOLUME_COMMANDS = new Set(["loop", "schedule", "babysit", "go", "batch"]);
```

### 2. Boundary assertion at module load

At the bottom of the constant block, assert three invariants at module load: the two Sets are disjoint, their union equals `TARGET_COMMANDS` (the canonical scanned set at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:99`), and no partition member is missing from `TARGET_COMMANDS` (catches the inverse drift case):

```js
const _PARTITIONED_COMMANDS = new Set([
  ...POSTURE_COMMANDS,
  ...VOLUME_COMMANDS,
]);
if (
  POSTURE_COMMANDS.size + VOLUME_COMMANDS.size !==
  _PARTITIONED_COMMANDS.size
) {
  throw new Error("POSTURE_COMMANDS and VOLUME_COMMANDS must be disjoint");
}
for (const cmd of TARGET_COMMANDS) {
  if (!_PARTITIONED_COMMANDS.has(cmd)) {
    throw new Error(
      `TARGET_COMMANDS member "${cmd}" is not classified as posture or volume`,
    );
  }
}
for (const cmd of _PARTITIONED_COMMANDS) {
  if (!TARGET_COMMANDS.has(cmd)) {
    throw new Error(
      `Partition member "${cmd}" is not in TARGET_COMMANDS — dead classification`,
    );
  }
}
```

This is a fail-loud guard at module load — adding a new command to `TARGET_COMMANDS` without classifying it (or classifying a command not in `TARGET_COMMANDS`) crashes the assessment before any score is written. Pinned to the canonical scanned set so future drift between `TARGET_COMMANDS` and the partition surfaces immediately.

**Note on `effortMax` and `planThenLaunch`:** these are NOT in either Set because they aren't slash-command names matched by `extractSlashCommands`. `effortMax` uses `hasEffortMax(uText)` (a regex over the user prompt) and `planThenLaunch` is a structural pattern detected via lookahead from `ExitPlanMode` tool_use events. They sit outside the partition by design; the assertion doesn't apply to them.

### 3. Per-session kind classification + posture gate

At the top of the `for (const path of sessionFiles)` loop at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:289`:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Then guard each posture-command counter behind `if (allowPosture && found.has(...))`. Volume-command counters stay structurally unchanged.

**Note on subagent sessions:** `classifySessionKind` returns `"subagent"` when the path matches `/subagents/agent-` (verified at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:508`). However, the existing scanner traversal at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:263-278` reads `projectsRoot/*/*.jsonl` — exactly two levels deep. Real subagent transcripts live three levels deeper at `projects/<project>/<session-uuid>/subagents/agent-*.jsonl` (verified against live `~/.claude/projects/` data: depth-4 path components). So the scanner never sees subagent files in practice, and an explicit `if (sessionKind === "subagent") continue` would be dead code today. Omit it; document the traversal-vs-classifier mismatch inline so a future traversal change can add the guard explicitly without inheriting silent assumptions.

The full updated block from `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:312-329`:

```js
const uText = userMessageText(line);
if (uText) {
  const found = extractSlashCommands(uText);
  // Volume commands — counted across all session kinds the scanner sees
  if (found.has("go")) counts.goCommandUses++;
  if (found.has("batch")) counts.batchCommandUses++;
  if (found.has("schedule")) counts.scheduleCommandUses++;
  if (found.has("loop")) sessionHasLoop = true;
  if (found.has("babysit")) sessionHasBabysit = true;
  // Posture commands — counted only when allowPosture is true
  // (interactive_cli or unknown — the conservative fallback)
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
  if (hasEffortMax(uText)) sessionHasEffortMax = true;
}
```

The grouping comments cleanly separate the two halves of the partition. `focus` and `rewind` sit under POSTURE because they're user-posture commands (`/focus` toggles focus mode; `/rewind` rolls back the conversation) — both per CLAUDE.md's documented posture list.

`effortMax` stays unconditional because its detection uses `hasEffortMax(uText)` rather than `found.has(...)`, and the partition asserts only over `_PARTITIONED_COMMANDS`. Documented inline as a special case.

### 4. Fallback semantics for unknown session kinds

`classifySessionKind` (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:507`) reads up to the first 5 lines of a transcript looking for an `entrypoint` field. If no recognized entrypoint appears in the first 5 lines, the function falls through past the loop and explicitly `return "unknown"` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:536` (an existing test at `scripts/__tests__/_usage-data.test.mjs` asserts `toBe("unknown")` — verify before editing).

**Design choice:** treat `"unknown"` as eligible for posture counting (alongside `interactive_cli`). The reasoning: conservative fallback — a session with no detectable entrypoint is more likely to be a legitimate interactive session predating entrypoint tracking than a hostile observer transcript. Document this inline at the partition site.

Equivalently in code:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

There is no subagent-skip line here — see the §3 note above about the scanner-traversal vs classifier-guard mismatch.

## Data flow

```
~/.claude/projects/*/*.jsonl
   (scanner reads exactly this depth: no recursion;
    subagent files at projects/<project>/<uuid>/subagents/agent-*.jsonl
    are NOT in the traversal set today.)
        │
        ▼
classifySessionKind(path)
   "interactive_cli" | "sdk_orchestrated" | "observer" | "unknown"
   ("subagent" exists in the classifier but is unreachable from
    this scanner's traversal — see §Architecture §3 note.)
        │
        ▼
scanTranscriptInvocations
   (interactive_cli | unknown → count posture + volume;
    sdk_orchestrated | observer → count volume only)
        │
        ▼
buildSignalsSummary  (unchanged — Math.max(transcript, history.jsonl) preserved)
        │
        ▼
score.mjs rubric predicates  (unchanged)
```

The projection layer at `/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:56-200+` stays byte-identical. The history MAX-merge (`maxProbe` at `/Users/theo/Projects/claude-extensions/scripts/run-assessment.mjs:134` and similar lines) keeps its conservative semantics — the LHS of `max(transcript_count, history_count)` becomes the clean interactive count for posture commands, but everything downstream is unchanged.

## Cost & blast radius

- **I/O.** Calling `classifySessionKind` once per session reads ~5 extra lines per file. ~1311 session files (current snapshot) ≈ 6.5K extra line reads — negligible against the ~150K-line full transcript scan the function already performs.
- **No subagent-related delta.** The classifier's `subagent` return value exists but is unreachable via this scanner's traversal (see §Architecture §3). No volume-count drop from "subagent inheritance" — there was never any in the first place.
- **Posture count drop.** Wherever observer noise was inflating, posture counts will drop. The MAX-merge keeps the history-derived floor, so most posture scorers stay stable. `/color` is the documented case where history is already authoritative (PR #96).
- **Score deltas in practice.** Expected: small posture-command count drops (`color`, `btw`, `voice`, `clear`, `compact`, `simplify`, `fewer-perms`, `focus`, `rewind`) wherever observer markup was inflating; no change to volume commands (`schedule`, `/go`, `/batch`, `/loop`, `/babysit`). The assessment scoring layer absorbs these via either MAX-merge or below-threshold rounding. **`/rewind` is the one posture command with no history floor** (it's a keyboard shortcut, not in `HISTORY_COMMAND_LIST`) — current `rewindCommandUses` is ~7, observer false-positives account for ~4, so post-partition expected ~3, still above the `>=1` threshold. The live-verification step in §Acceptance criteria explicitly captures this number.

## Tests

Net-new tests in `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs` (file already exists; append new `it` blocks). Each test uses `mkdtempSync` + `writeFileSync` real-filesystem fixtures, no mocks, matching the existing testing convention.

**Fixture markup convention:** `extractSlashCommands` uses `COMMAND_NAME_TAG_RE = /<command-name>\/([\w:-]+)/g` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:131` — the regex requires a literal `/` _inside_ the markup. Test fixtures must use `<command-name>/color</command-name>` (with slash), NOT `<command-name>color</command-name>` (no slash). The slash-less form is what `scanTranscriptModes` accepts (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:422`) — a different code path for a different purpose, easy to confuse. Pinning this here so the implementer doesn't replicate the slip the design author caught in self-review.

### Test 1: posture command in observer session does NOT count

Fixture: one session under `~/projects/observer-sessions/foo.jsonl` with `entrypoint: "sdk-cli"` in the first line and a user message containing `<command-name>/color</command-name>`. Assert `colorCommandUses === 0`.

### Test 2: volume command in observer session DOES count

Fixture: same observer-session shape but with `<command-name>/loop</command-name>`. Assert `loopCommandUses === 1`.

### Test 3: posture command in SDK-orchestrated session does NOT count

Fixture: one session under `~/projects/sdk-foo/bar.jsonl` (NOT under `observer-sessions/`) with `entrypoint: "sdk-cli"` and `<command-name>/color</command-name>`. Assert `colorCommandUses === 0`. Verifies the partition correctly excludes `sdk_orchestrated` kind, not just observer.

### Test 4: volume command in SDK-orchestrated session DOES count

Fixture: same SDK-cli shape but with `<command-name>/loop</command-name>`. Assert `loopCommandUses === 1`. Confirms the partition recovery — volume signal from SDK sessions is preserved.

### Test 5: posture command in interactive session DOES count

Fixture: regular session under `~/projects/foo/normal.jsonl` with `entrypoint: "cli"` and `<command-name>/color</command-name>`. Assert `colorCommandUses === 1`.

### Test 6: unknown entrypoint falls back to interactive

Fixture: session with no `entrypoint` field in the first 5 lines, containing `<command-name>/color</command-name>`. `classifySessionKind` returns `"unknown"`; assert `colorCommandUses === 1` (the conservative-fallback case).

### Test 7: boundary assertion catches drift (pure-function test)

`POSTURE_COMMANDS` and `VOLUME_COMMANDS` are top-level `new Set(...)` constants — they cannot be monkeypatched after import without import-cache games that risk vitest cross-test contamination. Instead, factor the assertion body into a small exported helper (`assertCommandPartition(posture, volume, target)`) and unit-test that helper directly against forged Sets:

- Disjointness violation → throws "must be disjoint"
- TARGET_COMMANDS member missing from partition → throws "not classified"
- Partition member missing from TARGET_COMMANDS → throws "dead classification"
- Happy path (current live Sets) → no throw

This is the implementer's primary path; the dynamic-import alternative is explicitly NOT recommended.

### Test 8: regression — pre-existing tests still pass

The partition shouldn't change interactive-only fixture behavior. The existing test suite's transcript fixtures are all `entrypoint: "cli"` or unset (→ `"unknown"`) — both fall into `allowPosture = true`, preserving current expectations. (Current baseline is 622 tests across 44 files; after this change, +5 new `it` blocks across the partition file plus +4 for the assertion helper = 631 expected. Numbers are illustrative; verify actual baseline at implementation time and adjust.)

## Error handling

- `classifySessionKind` handles malformed transcripts gracefully via its inline try/catch on `JSON.parse(raw)` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:519-522`. If the file has no parseable lines, it falls through to `return "unknown"` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:536`, which the partition treats as `interactive_cli`.
- **The boundary assertion is fail-loud at module load.** The `throw new Error(...)` runs the first time any module imports `_usage-data.mjs`, which happens at the top of `gatherSignals` in the assessment chain. If the assertion fires, the entire `npm run assess` invocation aborts with a stack trace — no `assessment.json` written, no Slack post, no dashboard update. This is intentional (fail loudly on contributor drift, never silently miscount), but operators running the LaunchAgent/cron should know that a missing `assessment.json` after a dependency bump may indicate a partition-drift error in stderr rather than an environmental issue. The CLAUDE.md update from Implementation Order step 6 should call this out explicitly.
- `await classifySessionKind(path)` adds one extra I/O round-trip per session inside the existing async iteration; no change to the function's overall failure model (the outer `try { … } catch { return counts; }` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:263-278` still catches `readdir` failures, and per-file errors during classification are caught by `classifySessionKind`'s own try/catch).

## Probe-tracker update (mandatory per CLAUDE.md)

No new probes, catalog entries, or `signalsSummary` keys are added — so the five machine-enforced header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys) remain unchanged. The probe-tracker spec at `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md` should be updated in the same PR with:

- **Part 1 Transcripts layer:** annotate posture-command rows (color, voice, btw, etc.) with a footnote indicating they now honor the session-kind partition (`interactive_cli` or `"unknown"` only). Volume-command rows stay unannotated.
- **Part 2 tip coverage:** no status-marker changes; the partition is an accuracy refinement of existing probes, not new coverage.

## Acceptance criteria

- [x] Two new module-level Sets in `scripts/_usage-data.mjs` (POSTURE_COMMANDS / VOLUME_COMMANDS) with the documented contents.
- [x] Boundary assertion factored into an exported helper (`assertCommandPartition`) and called at module load; runs the three checks from §Architecture §2.
- [x] Per-session loop calls `classifySessionKind(path)` once and computes `allowPosture = sessionKind === "interactive_cli" || sessionKind === "unknown"` (NOT `=== undefined` — the function returns the literal string).
- [x] Posture-command counters gated behind `allowPosture`.
- [x] Volume-command counters unchanged.
- [x] Net-new unit tests cover all seven cases in §Tests (Tests 1, 2, 3, 4, 5, 6, 8) plus the four `assertCommandPartition` cases in Test 7.
- [x] All pre-existing tests still pass (the partition is purposefully non-breaking for interactive fixtures — current baseline is 622 tests across 44 files; recount at implementation time).
- [x] `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` annotated with the partition footnote.
- [x] CLAUDE.md "Known limitation / deferred follow-up" paragraph rewritten per Implementation Order step 6.
- [x] Live `npm run assess --include-transcripts --insights-lookback 30` produces a console-printable score table; **posture commands trend down or stay flat**; volume commands stay flat. Capture the live `rewindCommandUses` value pre- and post-change for confidence on the `/rewind` regression-risk path.

## Out of scope

- Restructuring `scanTranscriptInvocations` return shape to bucket counts by session kind (deferred — only adds value if we later want per-kind debugging surfaces in the dashboard).
- Universe declarations in `scripts/score.mjs::withGates` — those operate on session-meta `session_type` (multi_task etc.), not on the scanner's per-session-kind classification. Orthogonal concern; if a future scorer needs the partition's session-kind classification at the scoring layer, that's a separate design pass.
- Sub-feature commands (splitting `/clear` from `/compact`, breaking `/voice` into per-language variants).
- Changing `classifySessionKind`'s fallback semantics — it stays unchanged; the partition only adds an interpretation rule on top.
- Changing the existing `effortMaxCommandUses` or `planThenLaunchSessions` behavior — both are detected by structural patterns (regex, lookahead) rather than slash-command extraction, and stay outside the partition.

## Risks and mitigations

- **Risk:** Drift between the documented posture/volume command lists in CLAUDE.md and the actual `POSTURE_COMMANDS` / `VOLUME_COMMANDS` Sets. **Mitigation:** the boundary assertion catches all three drift cases (disjointness, TARGET ⊇ partition, partition ⊆ TARGET). CLAUDE.md's "Known limitation" paragraph gets rewritten in the same PR (see Implementation Order step 6).
- **Risk:** A real interactive session with `entrypoint: "sdk-cli"` (e.g., a future tool that uses the SDK as a transport but represents user posture) would have posture commands suppressed. **Mitigation:** the `entrypoint` distinction is the documented kind boundary today; if such a hybrid kind emerges, the classification function itself should grow a new kind, not the partition.
- **Risk:** Score regression at first run after the fix lands, surprising the user. **Mitigation:** the live-verification step in acceptance criteria runs the assessment and captures pre/post values for at-risk counters. The CLAUDE.md update from step 6 explicitly tells future readers "expect modest count drops on `/color`, `/btw`, `/rewind`, etc. in the run immediately following the partition's first deployment."
- **Risk:** `/rewind` has no history MAX-merge floor and could theoretically drop to 0 for a user with very few real interactive `/rewind` invocations, crossing the `rewindCommandUses >= 1` threshold downward. **Mitigation:** the live-verification capture in acceptance criteria explicitly records `rewindCommandUses` pre/post. Current author-snapshot: pre ≈ 7, post ≈ 3 (4 observer false-positives subtracted), still above threshold.
- **Risk:** Module-load failure of the assertion causes total assessment blackout (no `assessment.json` written) rather than degraded output. **Mitigation:** This is intentional fail-loud behavior. The CLAUDE.md update explicitly tells operators to check stderr for `POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition errors before assuming an environmental issue.
- **Risk:** Future contributor adds a recursive directory walk to `scanTranscriptInvocations` (e.g., to include subagent transcripts), and the absence of a `subagent` skip silently reintroduces inheritance noise. **Mitigation:** the §Architecture §3 inline note flags this; a future PR that adds traversal recursion must add the skip explicitly.

## Implementation order (preview for the writing-plans handoff)

1. Add the two Sets and the `assertCommandPartition` helper to `scripts/_usage-data.mjs`; call the helper at module load. Add the Test-7 unit tests for the helper.
2. Add `classifySessionKind` call + `allowPosture = sessionKind === "interactive_cli" || sessionKind === "unknown"` flag at the top of the per-session loop. (No subagent skip — dead code under current traversal.)
3. Gate each posture-command counter behind `allowPosture`.
4. Append Tests 1-6 and Test 8 to `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs`.
5. Update `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md` with the partition footnote on Part 1 Transcripts layer for posture-command rows.
6. Rewrite the CLAUDE.md "Known limitation / deferred follow-up" paragraph (currently at `/Users/theo/Projects/claude-extensions/CLAUDE.md`, search for "Command counting has the same posture-vs-volume split"). Replace with a "Resolved in PR #110" pointer to the partition implementation that retains the historical v0.9.17 context as a one-paragraph summary (do NOT delete the v0.9.17 story — future readers triaging similar regressions need it). Add a one-liner under "Conventions" noting that `POSTURE_COMMANDS` / `VOLUME_COMMANDS` in `_usage-data.mjs` are the canonical partition source. Add an operational note: "If the LaunchAgent/cron `npm run assess` exits non-zero and no `assessment.json` is written, check stderr for partition-drift errors from the boundary assertion."
7. Live `npm run assess --include-transcripts --insights-lookback 30` for delta verification; capture `rewindCommandUses` and the top-3 priority list before and after the PR.
8. `/ship` the PR.
