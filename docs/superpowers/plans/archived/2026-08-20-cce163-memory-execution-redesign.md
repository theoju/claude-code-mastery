# Plan — Memory Execution scorer redesign (CCE-163)

**Spec:** `docs/superpowers/specs/2026-08-20-cce163-memory-execution-redesign-design.md`
**Decision:** (A) auto-compact is evidence only — resolved 2026-08-20.

Target shape: `numerator = | interactive_cli ∪ unknown sessions showing /clear ∪
/compact ∪ graphify ∪ claude-mem tool_use |`, over
`interactiveOrUnknownSessionsAnalyzed`. One counter class, one window, one
denominator.

## Task 1 — memory-tool session detection in `_usage-data.mjs`

Add a `MEMORY_TOOLS` detector to the transcript scanner, alongside the existing
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition.

- Detect per session, deduped to coverage (a session counts once regardless of
  invocation count) — this is what makes the signal the same counter class as
  the posture commands.
- Match on **parsed `tool_use` entries**, never raw text: iterate
  `message.content[]`, require `type === "tool_use"`, then match `name`. Text
  matching is wrong here — the MCP tool listing appears in every session's system
  prompt (1,513 false-positive sessions vs 15 real; see spec).
- Detectors: `name.includes("claude-mem")`; `name === "Skill"` with a graphify
  skill arg; `name === "Bash"` with a `graphify` command.
- Gate to `interactive_cli ∪ unknown`, matching posture-command treatment. A
  tooling session outside that universe must not enter the numerator, or the
  ratio can exceed 100% (PR #97 failure mode).

**Verify:** unit test that a session containing only an MCP tool *listing*
(no `tool_use` entry) contributes 0; a session with 40 graphify calls
contributes 1.

## Task 2 — expose the signal

- Add `memoryToolSessionCount` to the insights signals and `buildSignalsSummary`.
- Add a `probe-catalog.json` entry describing source and path.

**Verify:** `buildSignalsSummary(makeSignals())` returns the new key; re-derive
the count by **invoking** it, never by parsing the function source.

## Task 3 — union numerator in `score.mjs`

Replace the `clear + compact` sum in the `memory` scorer with union coverage.
Union, not sum: a session using three mechanisms counts once.

Evidence line must state the union and its parts, plus the auto-compact
setting per decision (A), plus the existing cumulative `/btw` sentence.

**Verify:** fixture tests asserting union semantics (one session using
`/clear` + graphify + claude-mem contributes exactly 1) and that an all-tooling
session set scores ≤ 100%.

## Task 4 — re-derive the rubric target

Run the real pipeline against live telemetry and read the gated union coverage.
Set `target` from that measurement. Do **not** carry over 60, and do not tune the
target to make a number look good — that is what CCE-79 did.

Record the derivation in the spec so the next reader knows where it came from.

**Verify:** `npm run assess` produces a memory Execution score whose arithmetic
reproduces by hand from the evidence line.

## Task 5 — source-level gate test

Add a test against `gatherInsightsSignals` (not fixture-fed) asserting the
tooling numerator is gated to `interactive_cli ∪ unknown`, so a future
gate-drop at the counting layer fails CI. The PR #97 lesson: fixture-fed scorer
tests alone did not catch a gate mismatch.

## Task 6 — probe tracker sync

Update `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` in the
**same PR**: Part 1 registry row for the touched layer, Part 2 tip-coverage row
and ✅/📊/🗣/❌ tally if a tip's status changed, and re-derive the five header
counts (they are machine-enforced by `scripts/__tests__/tracker-counts.test.mjs`).

## Task 7 — full gate

`npm run lint` · `npx tsc --noEmit` · `npm test` · `npm run build`, then confirm
CI green on the PR. Note the dashboard's own dimension explainer
(`app/lib/dimension-explainer.ts`) may need copy updates if it describes the old
numerator.

## Risks

- **Target derivation is judgement, not arithmetic.** Task 4 should surface the
  measured number for review rather than silently picking one.
- **Session-kind gating is the historical failure point** — CCE-76, PR #97, and
  PR #110 all involved gate mismatches. Task 5 exists specifically for that.
- **Scope creep into other dimensions.** `customization` has the same
  two-command shape and the same weakness. Out of scope here; file separately if
  the union model proves out.
