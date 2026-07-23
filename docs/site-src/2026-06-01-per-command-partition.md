---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/110
synthesized_into: []
doc_kind: decision
---

# Per-command partition for observer/SDK session noise

PR #110 (CCE-71) changes how `scanTranscriptInvocations` in
`scripts/_usage-data.mjs` counts slash-command usage from
`~/.claude/projects/*/*.jsonl` transcripts. It replaces a blunt
session-kind exclusion with a **per-command partition**: some commands
are counted only from sessions where the user actually set the posture
themselves, others are counted everywhere.

## The problem

`scanTranscriptInvocations` walks every transcript it can find and counts
`<command-name>/cmd</command-name>` markup. Observer sessions — the ones
that watch a primary session's work and emit structured observations —
echo that primary session's markup verbatim. So a single real `/color`
invocation in an interactive session could get counted twice: once from
the interactive transcript, once from the observer transcript watching
it. SDK-orchestrated sessions carry the same risk. Left unfiltered, this
inflates any posture-style counter that depends on `<command-name>`
detection.

A prior cycle (v0.9.17) tried the obvious fix: exclude `observer`,
`sdk_orchestrated`, and `subagent` session kinds from the scan entirely.
That regressed the `scheduled` dimension score from 75 to 63, because it
also deleted genuine `/loop` and `/schedule` signal — autonomous-workflow
commands that are just as real when an SDK-orchestrated session fires
them as when a human types them interactively. The blanket exclusion was
reverted.

## The fix: partition by command, not by session

PR #110 introduces two module-level `Set`s in `scripts/_usage-data.mjs`:

```js
export const POSTURE_COMMANDS = new Set([
  "color", "voice", "focus", "btw", "clear", "compact",
  "simplify", "rewind", "fewer-permission-prompts",
]);
export const VOLUME_COMMANDS = new Set([
  "loop", "schedule", "babysit", "go", "batch",
]);
```

**Posture commands** describe how a user has configured their working
posture — output style, permission prompts, plan review, memory
hygiene. Whether or not the user actually invoked one of these is only
meaningful from a session where the user was actually driving. So
posture-command counters are gated: they only increment when the
originating session's kind, as returned by `classifySessionKind`, is
`interactive_cli` or `unknown` (the conservative fallback for
transcripts where no recognizable `entrypoint` field turned up in the
first five lines).

**Volume commands** represent autonomous-workflow activity — `/loop`,
`/schedule`, `/babysit`, `/go`, `/batch`. This signal is real regardless
of which session kind fired it, so these counters stay unconditional,
counted across every session kind the scanner reaches.

Inside the per-session loop, each transcript is classified once via
`classifySessionKind`, and the resulting `allowPosture` flag gates the
nine posture counters while leaving the five volume counters untouched:

```js
const sessionKind = await classifySessionKind(path);
const allowPosture =
  sessionKind === "interactive_cli" || sessionKind === "unknown";
```

Two commands sit outside the partition entirely and are unaffected:
`effortMax` (detected via a regex over prompt text, not
`<command-name>` markup) and `planThenLaunch` (a structural
`ExitPlanMode`-lookahead pattern, not a slash-command name at all).

## The guardrail: `assertCommandPartition`

Because `POSTURE_COMMANDS` and `VOLUME_COMMANDS` are independently
maintained lists, drift between them and the canonical scanned set
(`TARGET_COMMANDS`) is a real risk — add a new command to
`TARGET_COMMANDS` and forget to classify it, and it silently falls
through the partition unfiltered. PR #110 closes that gap with a
fail-loud check that runs at module load:

```js
assertCommandPartition(POSTURE_COMMANDS, VOLUME_COMMANDS, TARGET_COMMANDS);
```

`assertCommandPartition` (exported so it's testable against forged Sets
without import-cache tricks) throws on three distinct drift shapes:

1. `POSTURE_COMMANDS` and `VOLUME_COMMANDS` overlap (a command classified
   as both).
2. A `TARGET_COMMANDS` member isn't classified as either posture or
   volume.
3. A partition member isn't in `TARGET_COMMANDS` at all (dead
   classification — a command being filtered that the scanner never
   actually looks for).

Because the assertion runs at import time, a drift bug aborts the entire
`npm run assess` invocation before any score gets written — no
half-correct `assessment.json`, no silent miscount. If a scheduled run
ever exits non-zero with nothing written, check stderr for a
`POSTURE_COMMANDS` / `VOLUME_COMMANDS` partition error before assuming
an environmental problem.

## Why `unknown` counts as posture-eligible

`classifySessionKind` returns `"unknown"` when a transcript's first five
lines carry no recognizable `entrypoint` field — which includes older
transcripts predating entrypoint tracking. Treating `unknown` as
posture-eligible (alongside `interactive_cli`) is a deliberate
conservative choice: a session with no detectable entrypoint is more
likely to be a legitimate pre-tracking interactive session than a
hostile observer transcript, so it shouldn't be penalized by exclusion.

## What didn't change

The `Math.max(transcriptCount, historyCount)` merge in
`run-assessment.mjs` that already floors some posture counters (like
`/color`) against `~/.claude/history.jsonl` is untouched — this PR only
cleans up the transcript-side count that feeds into that merge. Scoring
rules in `score.mjs`, the rubric's `satisfiedWhen` predicates, and the
probe catalog are all unchanged: no new probes or `signalsSummary` keys
were added, so the machine-enforced tracker header counts stayed the
same.

## Net effect

Expect posture-command counts (`color`, `btw`, `voice`, `clear`,
`compact`, `simplify`, `fewer-permission-prompts`, `focus`, `rewind`) to
trend down or stay flat wherever observer-session echo was previously
inflating them, since real double-counted invocations get filtered out.
Volume-command counts (`loop`, `schedule`, `babysit`, `go`, `batch`) stay
exactly as they were — no regression risk to the `scheduled` dimension
this time, because the fix filters by command semantics rather than by
session kind wholesale.
