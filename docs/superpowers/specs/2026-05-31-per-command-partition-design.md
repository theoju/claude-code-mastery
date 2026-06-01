# Per-command partition for observer-session false positives

**Status:** Design approved 2026-05-31 (pending three-agent verification + user review)
**Ticket:** To be filed as a new CCE-X issue; brainstorm session originated from CLAUDE.md "Known limitation / deferred follow-up"
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
if (sessionKind === "subagent") continue;
const allowPosture = sessionKind === "interactive_cli";
```

Then guard each posture-command counter behind `if (allowPosture && found.has(...))`. Volume-command counters stay structurally unchanged.

The full updated block from `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:312-329`:

```js
const uText = userMessageText(line);
if (uText) {
  const found = extractSlashCommands(uText);
  // Volume commands — counted across all non-subagent kinds
  if (found.has("go")) counts.goCommandUses++;
  if (found.has("batch")) counts.batchCommandUses++;
  if (found.has("focus") && allowPosture) counts.focusCommandUses++;
  if (found.has("schedule")) counts.scheduleCommandUses++;
  if (found.has("rewind") && allowPosture) counts.rewindCommandUses++;
  if (found.has("loop")) sessionHasLoop = true;
  if (found.has("babysit")) sessionHasBabysit = true;
  // Posture commands — counted only for interactive_cli sessions
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

Note that `focus` and `rewind` are listed in POSTURE_COMMANDS — both are user-posture commands (`/focus` toggles focus mode, `/rewind` rolls back the conversation). Putting them under `allowPosture` is consistent with the partition definition even though their existing per-invocation behavior was already noise-free in practice.

`effortMax` stays unconditional because its detection uses `hasEffortMax(uText)` rather than `found.has(...)`, and the partition asserts only over `_PARTITIONED_COMMANDS`. Documented inline as a special case.

### 4. Fallback semantics for unknown session kinds

`classifySessionKind` (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:504`) reads up to the first 5 lines of a transcript looking for an `entrypoint` field. If no recognized entrypoint appears in the first 5 lines, the function falls through past the loop without an explicit return — JavaScript returns `undefined`.

**Design choice:** treat `undefined` as `interactive_cli` for the purposes of `allowPosture`. The reasoning: conservative fallback — a session with no detectable entrypoint is more likely to be a legitimate interactive session predating entrypoint tracking than a hostile observer transcript. Document this inline at the partition site.

Equivalently in code:

```js
const sessionKind = await classifySessionKind(path);
if (sessionKind === "subagent") continue;
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === undefined;
```

Subagent exclusion stays strict — subagent transcripts never reflect user-typed commands, even with the fallback liberty.

## Data flow

```
~/.claude/projects/*/*.jsonl
        │
        ▼
classifySessionKind(path)
   "interactive_cli" | "sdk_orchestrated" | "observer" | "subagent" | undefined
        │
        ▼
scanTranscriptInvocations
   (subagent → skip session entirely;
    interactive_cli | undefined → count posture + volume;
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
- **Subagent exclusion (new).** ~5% of session files live under `/subagents/agent-…` paths. Skipping them entirely may modestly drop some VOLUME counts that previously double-counted subagent inheritance. Acceptable per design — subagents aren't user-typed.
- **Posture count drop.** Wherever observer noise was inflating, posture counts will drop. The MAX-merge keeps the history-derived floor, so most posture scorers stay stable. `/color` is the documented case where history is already authoritative (PR #96).
- **Score deltas in practice.** Expected: small posture-command count drops (`color`, `btw`, `voice`, `clear`, `compact`, `simplify`, `fewer-perms`) wherever observer markup was inflating; no change to scheduled / `/go` / `/batch`; possibly modest drops in scheduled / loop / babysit if subagent transcripts were carrying inheritance. The assessment scoring layer absorbs these via either MAX-merge or below-threshold rounding.

## Tests

Net-new tests in `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs` (file already exists; append new `it` blocks). Each test uses `mkdtempSync` + `writeFileSync` real-filesystem fixtures, no mocks, matching the existing testing convention.

**Fixture markup convention:** `extractSlashCommands` uses `COMMAND_NAME_TAG_RE = /<command-name>\/([\w:-]+)/g` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:131` — the regex requires a literal `/` _inside_ the markup. Test fixtures must use `<command-name>/color</command-name>` (with slash), NOT `<command-name>color</command-name>` (no slash). The slash-less form is what `scanTranscriptModes` accepts (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:422`) — a different code path for a different purpose, easy to confuse. Pinning this here so the implementer doesn't replicate the slip the design author caught in self-review.

### Test 1: posture command in observer session does NOT count

Fixture: one session under `~/projects/observer-sessions/foo.jsonl` with `entrypoint: "sdk-cli"` in the first line and a user message containing `<command-name>/color</command-name>`. Assert `colorCommandUses === 0`.

### Test 2: volume command in observer session DOES count

Fixture: same observer-session shape but with `<command-name>/loop</command-name>`. Assert `loopCommandUses === 1`.

### Test 3: posture command in subagent session does NOT count

Fixture: one session under `~/projects/foo/subagents/agent-xyz.jsonl` with `<command-name>/color</command-name>`. Assert `colorCommandUses === 0`.

### Test 4: volume command in subagent session does NOT count

Fixture: same subagent path with `<command-name>/loop</command-name>`. Assert `loopCommandUses === 0` (subagents excluded entirely).

### Test 5: posture command in interactive session DOES count

Fixture: regular session under `~/projects/foo/normal.jsonl` with `entrypoint: "cli"` and `<command-name>/color</command-name>`. Assert `colorCommandUses === 1`.

### Test 6: undetectable entrypoint falls back to interactive

Fixture: session with no `entrypoint` field in the first 5 lines, containing `<command-name>/color</command-name>`. Assert `colorCommandUses === 1` (the conservative-fallback case).

### Test 7: boundary assertion catches drift

Import the module in a test where `POSTURE_COMMANDS` is monkeypatched to overlap with `VOLUME_COMMANDS`. Assert the module throws at load. (May require fresh module import via vitest dynamic-import mechanics; if not feasible cleanly, replace with a static unit test that runs the assertion logic against forged Sets.)

### Test 8: regression — existing 622 tests still pass

The partition shouldn't change interactive-only fixture behavior. The existing test suite's transcript fixtures are all `entrypoint: "cli"` or `undefined` — both fall into `allowPosture = true`, preserving current expectations.

## Error handling

- `classifySessionKind` already handles malformed transcripts gracefully via its inline try/catch on `JSON.parse(raw)` (`/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:516`-520). If the file has no parseable lines, it falls through to `undefined`, which the partition treats as `interactive_cli`.
- The boundary assertion runs at module load, before any signal-gathering work begins. A drift error surfaces immediately, with a clear message naming the offending Set state.
- `await classifySessionKind(path)` adds one extra I/O round-trip per session inside the existing async iteration; no change to the function's overall failure model (the outer `try { … } catch { return counts; }` at `/Users/theo/Projects/claude-extensions/scripts/_usage-data.mjs:263`-278 still catches `readdir` failures, but per-file errors during classification surface as caught exceptions inside `classifySessionKind` itself).

## Probe-tracker update (mandatory per CLAUDE.md)

No new probes, catalog entries, or `signalsSummary` keys are added — so the five machine-enforced header counts (75 tips / 12 dimensions / 48 next-actions / 47 probe-catalog entries / 71 signalsSummary keys) remain unchanged. The probe-tracker spec at `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-25-probe-implementation-status.md` should be updated in the same PR with:

- **Part 1 Transcripts layer:** annotate posture-command rows (color, voice, btw, etc.) with a footnote indicating they now honor the session-kind partition (`interactive_cli` only, plus the `undefined` fallback). Volume-command rows stay unannotated.
- **Part 2 tip coverage:** no status-marker changes; the partition is an accuracy refinement of existing probes, not new coverage.

## Acceptance criteria

- [ ] Two new module-level Sets in `scripts/_usage-data.mjs` (POSTURE_COMMANDS / VOLUME_COMMANDS) with the documented contents.
- [ ] Boundary assertion at module load fails the import if the Sets overlap.
- [ ] Per-session loop calls `classifySessionKind(path)` once and skips subagent sessions entirely.
- [ ] Posture-command counters gated behind `allowPosture` (i.e., interactive_cli or undefined).
- [ ] Volume-command counters unchanged.
- [ ] Net-new unit tests cover all eight cases in §Tests.
- [ ] All 622 existing tests still pass (the partition is purposefully non-breaking for interactive fixtures).
- [ ] `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` annotated with the partition footnote.
- [ ] Live `npm run assess --include-transcripts --insights-lookback 30` produces a console-printable score table; **posture commands trend down or stay flat**; volume commands stay flat. No catastrophic score regression on `/color`, which is already authoritative via history MAX-merge.

## Out of scope

- Restructuring `scanTranscriptInvocations` return shape to bucket counts by session kind (deferred — only adds value if we later want per-kind debugging surfaces in the dashboard).
- Universe declarations in `scripts/score.mjs::withGates` — those operate on session-meta `session_type` (multi_task etc.), not on the scanner's per-session-kind classification. Orthogonal concern; if a future scorer needs the partition's session-kind classification at the scoring layer, that's a separate design pass.
- Sub-feature commands (splitting `/clear` from `/compact`, breaking `/voice` into per-language variants).
- Changing `classifySessionKind`'s fallback semantics — it stays unchanged; the partition only adds an interpretation rule on top.
- Changing the existing `effortMaxCommandUses` or `planThenLaunchSessions` behavior — both are detected by structural patterns (regex, lookahead) rather than slash-command extraction, and stay outside the partition.

## Risks and mitigations

- **Risk:** Drift between the documented posture/volume command lists in CLAUDE.md and the actual `POSTURE_COMMANDS` / `VOLUME_COMMANDS` Sets. **Mitigation:** the boundary assertion catches Set-disjoint violations; CLAUDE.md's "Known limitation" paragraph should be updated in the same PR to point at the actual Sets as canonical source.
- **Risk:** A real interactive session with `entrypoint: "sdk-cli"` (e.g., a future tool that uses the SDK as a transport but represents user posture) would have posture commands suppressed. **Mitigation:** the `entrypoint` distinction is the documented kind boundary today; if such a hybrid kind emerges, the classification function itself should grow a new kind, not the partition.
- **Risk:** Score regression at first run after the fix lands, surprising the user. **Mitigation:** the live-verification step in acceptance criteria runs the assessment and surfaces deltas. CLAUDE.md should grow a one-liner noting "v0.9.X tightened posture-command counting; expect modest count drops on `/color`, `/btw`, etc.".
- **Risk:** A subagent transcript carrying parent's `/loop` markup was contributing to the loop count in the wild, and removing it drops `scheduled` from 75 to something noticeably lower. **Mitigation:** known acceptable — the v0.9.17 cycle exposed exactly this concern and the partition specifically isolates volume commands from the subagent exclusion's collateral. Live verification will quantify.

## Implementation order (preview for the writing-plans handoff)

1. Add the two Sets and the boundary assertion to `scripts/_usage-data.mjs` with a no-op test (assertion passes against current Sets).
2. Add `classifySessionKind` call + `sessionKind === "subagent" → continue` + `allowPosture` flag at the top of the per-session loop.
3. Gate each posture-command counter behind `allowPosture`.
4. Append the eight new tests to `/Users/theo/Projects/claude-extensions/scripts/__tests__/_usage-data.test.mjs`.
5. Update `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` with the partition footnote.
6. Update CLAUDE.md "Known limitation / deferred follow-up" paragraph to point at the canonical Sets.
7. Live `npm run assess` for delta verification.
8. `/ship` the PR.
